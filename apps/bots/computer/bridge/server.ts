// The computer's bridge, on one container port (spec section 7). Only the user's computer object reaches it, and every
// request carries the token the container was started with. It runs knightcode-env as each bot's OS user (one frame
// per WebSocket message), carries each bot's VNC display, drives each bot's Chrome and desktop, exports and imports
// the workspace, and runs the owner's setup script.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { hostsBlock, netguardConfig } from "../../src/computer/abuse.ts";
import { browserAction, type BrowserRequest, quiesceBrowsers } from "./browser.ts";
import { BOT_USER, desktopAction, type DesktopRequest, ensureSession, knownSessions, run, RUNUSER } from "./desktop.ts";

const PORT = 8080;
const TOKEN = process.env.BRIDGE_TOKEN ?? "";
const MARKER_PREFIX = "PI-ENV ";
const MAX_FRAME = 16 * 1024 * 1024;

/** Paths left out of saves: caches, dependencies, build output, logs, and Chrome's transient files. */
const EXCLUDES = [
	".cache",
	"node_modules",
	".venv",
	"__pycache__",
	".npm",
	"*.log",
	"Cache",
	"Code Cache",
	"GPUCache",
	"ShaderCache",
	"GrShaderCache",
	"CacheStorage",
	"SingletonLock",
	"SingletonSocket",
	"SingletonCookie",
];

/** The abuse rules, shared folder and group, written once at start. */
function prepare(): void {
	writeFileSync("/etc/netguard.conf", netguardConfig());
	const hosts = readFileSync("/etc/hosts", "utf8");
	if (!hosts.includes("# knightcode-bots blocklist")) appendFileSync("/etc/hosts", `\n# knightcode-bots blocklist\n${hostsBlock()}`);
	mkdirSync("/home/shared", { recursive: true });
}

function authorized(request: Request): boolean {
	const given = new TextEncoder().encode(request.headers.get("x-bridge-token") ?? "");
	const wanted = new TextEncoder().encode(TOKEN);
	return TOKEN.length > 0 && given.length === wanted.length && timingSafeEqual(given, wanted);
}

type SocketData =
	| { kind: "env"; user: string; child?: ReturnType<typeof Bun.spawn>; queued: Uint8Array[] }
	| { kind: "vnc"; user: string; tcp?: Awaited<ReturnType<typeof Bun.connect>>; queued: Uint8Array[] };

/** Splits the daemon's stdout into whole frames after its marker line, and sends each as one message. */
function relayFrames(stdout: ReadableStream<Uint8Array>, marker: Uint8Array, send: (frame: Uint8Array) => void, fail: () => void) {
	let buffer = new Uint8Array(0);
	let synced = false;
	void (async () => {
		for await (const chunk of stdout) {
			const joined = new Uint8Array(buffer.length + chunk.length);
			joined.set(buffer);
			joined.set(chunk, buffer.length);
			buffer = joined;
			if (!synced) {
				const at = indexOf(buffer, marker);
				if (at < 0) continue;
				buffer = buffer.slice(at + marker.length);
				synced = true;
			}
			while (buffer.length >= 4) {
				const length = new DataView(buffer.buffer, buffer.byteOffset).getUint32(0);
				if (length < 9 || length > MAX_FRAME) return fail();
				if (buffer.length < 4 + length) break;
				send(buffer.slice(0, 4 + length));
				buffer = buffer.slice(4 + length);
			}
		}
		fail();
	})();
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
	outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
		for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
		return i;
	}
	return -1;
}

/** Owners and modes after an import: each bot's home its own and 700; shared group-writable. */
async function fixPermissions(): Promise<void> {
	for (const name of readdirSync("/home")) {
		if (BOT_USER.test(name)) {
			await ensureSession(name).catch(() => undefined);
			await run(["chown", "-R", `${name}:${name}`, `/home/${name}`]);
			chmodSync(`/home/${name}`, 0o700);
		}
	}
	await run(["chgrp", "-R", "botshare", "/home/shared"]);
	await run(["chmod", "-R", "g+rwX", "/home/shared"]);
	await run(["chmod", "2775", "/home/shared"]);
}

/** Starts what a new socket carries: the bot user's knightcode-env, or its VNC display. */
async function openSocket(socket: import("bun").ServerWebSocket<SocketData>): Promise<void> {
	const data = socket.data;
		if (data.kind === "env") {
			const token = crypto.randomUUID().replace(/-/g, "");
			const session = await ensureSession(data.user);
			const child = Bun.spawn([RUNUSER, "-u", data.user, "--", "/usr/local/bin/knightcode-env", "serve", "--token", token], {
				stdin: "pipe",
				stdout: "pipe",
				stderr: "ignore",
				cwd: `/home/${data.user}`,
				env: {
					HOME: `/home/${data.user}`,
					USER: data.user,
					LOGNAME: data.user,
					SHELL: "/bin/bash",
					DISPLAY: `:${session.display}`,
					XAUTHORITY: `/home/${data.user}/.Xauthority`,
					PATH: "/home/" + data.user + "/.local/bin:/usr/local/bin:/usr/bin:/bin",
					LANG: "C.UTF-8",
				},
			});
			data.child = child;
			relayFrames(
				child.stdout,
				new TextEncoder().encode(`${MARKER_PREFIX}${token}\n`),
				(frame) => socket.sendBinary(frame),
				() => socket.close(1011, "knightcode-env ended"),
			);
			void child.exited.then(() => socket.close(1011, "knightcode-env ended"));
			for (const queued of data.queued.splice(0)) {
				child.stdin.write(queued);
				void child.stdin.flush();
			}
			return;
		}
		const session = await ensureSession(data.user);
		data.tcp = await Bun.connect({
			hostname: "127.0.0.1",
			port: session.vncPort,
			socket: {
				data: (_tcp, chunk) => void socket.sendBinary(chunk),
				close: () => socket.close(1000, "screen closed"),
				error: () => socket.close(1011, "screen failed"),
			},
		});
		for (const queued of data.queued.splice(0)) data.tcp.write(queued);
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

prepare();

Bun.serve<SocketData, never>({
	port: PORT,
	idleTimeout: 0,
	async fetch(request, server) {
		const url = new URL(request.url);
		if (url.pathname === "/health") return new Response("ok");
		if (!authorized(request)) return new Response("forbidden", { status: 403 });
		const user = url.searchParams.get("user") ?? "";
		const needsUser = ["/env", "/vnc", "/browser", "/desktop"].includes(url.pathname);
		if (needsUser && !BOT_USER.test(user)) return new Response("bad user", { status: 400 });

		if (url.pathname === "/env" || url.pathname === "/vnc") {
			await ensureSession(user);
			const data: SocketData = url.pathname === "/env" ? { kind: "env", user, queued: [] } : { kind: "vnc", user, queued: [] };
			return server.upgrade(request, { data }) ? undefined : new Response("upgrade failed", { status: 400 });
		}
		if (url.pathname === "/browser" && request.method === "POST") {
			try {
				return json(await browserAction(user, (await request.json()) as BrowserRequest));
			} catch (error) {
				return json({ error: error instanceof Error ? error.message : String(error) });
			}
		}
		if (url.pathname === "/desktop" && request.method === "POST") {
			try {
				return json(await desktopAction(user, (await request.json()) as DesktopRequest));
			} catch (error) {
				return json({ error: error instanceof Error ? error.message : String(error) });
			}
		}
		if (url.pathname === "/export" && request.method === "POST") {
			await quiesceBrowsers(knownSessions());
			const tar = Bun.spawn(["tar", "-czf", "-", "-C", "/home", ...EXCLUDES.map((pattern) => `--exclude=${pattern}`), "."], {
				stdout: "pipe",
				stderr: "ignore",
			});
			return new Response(tar.stdout, { headers: { "content-type": "application/gzip" } });
		}
		if (url.pathname === "/import" && request.method === "POST") {
			const tar = Bun.spawn(["tar", "-xzf", "-", "-C", "/home"], { stdin: request, stdout: "ignore", stderr: "pipe" });
			const [code, stderr] = await Promise.all([tar.exited, new Response(tar.stderr).text()]);
			if (code !== 0) return new Response(stderr.slice(-2_000), { status: 500 });
			await fixPermissions();
			return new Response("ok");
		}
		if (url.pathname === "/setup" && request.method === "POST") {
			const path = `/root/setup-${Date.now()}.sh`;
			writeFileSync(path, await request.text(), { mode: 0o700 });
			const result = await run(["/opt/computer/setup.sh", path]);
			return json({ code: result.code, output: `${result.stdout}${result.stderr}`.slice(-8_000) });
		}
		return new Response("not found", { status: 404 });
	},
	websocket: {
		maxPayloadLength: MAX_FRAME + 4,
		async open(socket) {
			try {
				await openSocket(socket);
			} catch (error) {
				// One failed shell or screen must not take the bridge down.
				console.error("socket open failed", error);
				socket.close(1011, "could not start");
			}
		},
		message(socket, message) {
			const bytes = typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
			const data = socket.data;
			if (data.kind === "env") {
				const stdin = data.child?.stdin;
				if (stdin && typeof stdin !== "number") {
					stdin.write(bytes);
					void stdin.flush();
				} else data.queued.push(bytes);
			} else if (data.tcp) data.tcp.write(bytes);
			else data.queued.push(bytes);
		},
		close(socket) {
			const data = socket.data;
			if (data.kind === "env") data.child?.kill();
			else data.tcp?.end();
		},
	},
});

if (!existsSync("/var/lib/kb")) mkdirSync("/var/lib/kb", { recursive: true });
console.log(`bridge listening on ${PORT}`);
