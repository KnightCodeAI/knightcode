// Per-bot OS users and desktops: each bot gets its own user (home 700, in the botshare group), display, VNC port and
// Chrome debugging port. Ports on loopback are registered with netguard, so only their own bot user (and root) can
// connect to them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const BOT_USER = /^bot_[0-9a-f]{16}$/;
/** Absolute: commands run with the bot user's PATH, which has no sbin. */
export const RUNUSER = "/usr/sbin/runuser";
const SESSIONS = "/var/lib/kb/sessions.json";
const PORTS = "/etc/netguard-ports";

export interface Session {
	user: string;
	uid: number;
	display: number;
	vncPort: number;
	debugPort: number;
}

/** Runs a command to the end; resolves with its exit code and output. */
export async function run(command: string[], options: { input?: string; env?: Record<string, string> } = {}) {
	const child = Bun.spawn(command, {
		stdin: options.input === undefined ? "ignore" : new TextEncoder().encode(options.input),
		stdout: "pipe",
		stderr: "pipe",
		env: { ...process.env, ...options.env },
	});
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	return { code, stdout, stderr };
}

/** The same, with bytes out (screenshots). */
export async function runBytes(command: string[], env: Record<string, string> = {}) {
	const child = Bun.spawn(command, { stdout: "pipe", stderr: "ignore", env: { ...process.env, ...env } });
	const [bytes, code] = await Promise.all([new Response(child.stdout).arrayBuffer(), child.exited]);
	return { code, bytes: new Uint8Array(bytes) };
}

function readSessions(): Record<string, number> {
	try {
		return JSON.parse(readFileSync(SESSIONS, "utf8")) as Record<string, number>;
	} catch {
		return {};
	}
}

const sessions = new Map<string, Session>();
const starting = new Map<string, Promise<Session>>();

/** Creates the bot's OS user if needed: home 700, member of botshare, so `/home/shared` is writable. */
async function ensureUser(user: string): Promise<number> {
	if (!BOT_USER.test(user)) throw new Error("not a bot user");
	if ((await run(["id", "-u", user])).code !== 0) {
		const added = await run(["useradd", "--create-home", "--shell", "/bin/bash", "--groups", "botshare", user]);
		if (added.code !== 0 && !added.stderr.includes("already exists")) throw new Error(`useradd failed: ${added.stderr}`);
	}
	await run(["chmod", "700", `/home/${user}`]);
	return Number((await run(["id", "-u", user])).stdout.trim());
}

/** The bot's numbers, allocated once and kept, so a restored workspace finds the same profile and ports. */
function allocate(user: string): number {
	const all = readSessions();
	if (all[user] === undefined) {
		all[user] = Math.max(0, ...Object.values(all)) + 1;
		mkdirSync("/var/lib/kb", { recursive: true });
		writeFileSync(SESSIONS, JSON.stringify(all));
	}
	return all[user]!;
}

function registerPorts(session: Session): void {
	const lines = existsSync(PORTS) ? readFileSync(PORTS, "utf8").split("\n").filter(Boolean) : [];
	const wanted = [`${session.vncPort} ${session.uid}`, `${session.debugPort} ${session.uid}`];
	const kept = lines.filter((line) => !wanted.some((entry) => entry.split(" ")[0] === line.split(" ")[0]));
	writeFileSync(PORTS, [...kept, ...wanted].join("\n") + "\n");
}

/** The bot's user and desktop, started if they are not running. */
export function ensureSession(user: string): Promise<Session> {
	const existing = sessions.get(user);
	if (existing && existsSync(`/tmp/.X11-unix/X${existing.display}`)) return Promise.resolve(existing);
	const pending = starting.get(user);
	if (pending) return pending;
	const start = (async () => {
		const uid = await ensureUser(user);
		const n = allocate(user);
		const session: Session = { user, uid, display: 10 + n, vncPort: 5900 + n, debugPort: 9222 + n };
		registerPorts(session);
		if (!existsSync(`/tmp/.X11-unix/X${session.display}`)) {
			Bun.spawn([RUNUSER, "-u", user, "--", "/opt/computer/desktop/session.sh", String(session.display), String(session.vncPort)], {
				stdio: ["ignore", "ignore", "ignore"],
				env: { HOME: `/home/${user}`, USER: user, PATH: process.env.PATH ?? "/usr/bin:/bin" },
			});
			for (let i = 0; i < 100 && !existsSync(`/tmp/.X11-unix/X${session.display}`); i++) await Bun.sleep(100);
		}
		sessions.set(user, session);
		return session;
	})();
	starting.set(user, start);
	return start.finally(() => starting.delete(user));
}

export function knownSessions(): Session[] {
	return [...sessions.values()];
}

export type DesktopRequest =
	| { action: "screenshot" }
	| { action: "click" | "double_click" | "move"; x: number; y: number }
	| { action: "type"; text: string }
	| { action: "key"; keys: string[] }
	| { action: "scroll"; x: number; y: number; dy: number };

/** Screenshots and input on the bot's display, as the bot's user. */
export async function desktopAction(user: string, request: DesktopRequest) {
	const session = await ensureSession(user);
	const env = { DISPLAY: `:${session.display}` };
	const as = (command: string[]) => [RUNUSER, "-u", user, "--", ...command];
	const xdotool = (...args: string[]) => run(as(["xdotool", ...args]), { env });
	switch (request.action) {
		case "screenshot": {
			const shot = await runBytes(as(["import", "-window", "root", "png:-"]), env);
			if (shot.code !== 0) return { error: "The screenshot failed." };
			return { image: { data: Buffer.from(shot.bytes).toString("base64"), mimeType: "image/png" } };
		}
		case "click":
		case "double_click":
		case "move":
			await xdotool("mousemove", String(Math.round(request.x)), String(Math.round(request.y)));
			if (request.action !== "move") await xdotool("click", "--repeat", request.action === "double_click" ? "2" : "1", "1");
			return {};
		case "type":
			await xdotool("type", "--delay", "15", "--", request.text);
			return {};
		case "key":
			await xdotool("key", "--", ...request.keys);
			return {};
		case "scroll":
			await xdotool("mousemove", String(Math.round(request.x)), String(Math.round(request.y)));
			await xdotool("click", "--repeat", String(Math.min(20, Math.abs(Math.round(request.dy)))), request.dy < 0 ? "4" : "5");
			return {};
	}
}
