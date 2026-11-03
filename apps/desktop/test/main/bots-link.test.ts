import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type AddressInfo, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
	ComputerLink,
	connectComputerLink,
	handleExec,
	type LinkSocket,
	LocalComputerPolicy,
	runInShell,
} from "../../src/main/bots/computer-link.ts";
import { connectProviders, providerRules } from "../../src/main/bots/connect.ts";
import { egressAllowed, routeFor } from "../../src/main/bots/egress-proxy.ts";
import { createPasskeyRelay } from "../../src/main/bots/passkey-relay.ts";
import { BotsSession } from "../../src/main/bots/session.ts";

let dir: string | undefined;
afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
	dir = undefined;
});

test("connecting providers to the cloud leaves the local credential store byte-identical", async () => {
	dir = mkdtempSync(join(tmpdir(), "kc-bots-link-"));
	const local = join(dir, "auth.json");
	writeFileSync(
		local,
		JSON.stringify({
			anthropic: { type: "oauth", access: "local-access", refresh: "local-refresh", expires: 1 },
			openai: { type: "api_key", key: "sk-local" },
		}),
	);
	const before = readFileSync(local);
	const uploads: { token: string; credential: unknown }[] = [];
	const results = await connectProviders(
		[
			{ id: "anthropic", kind: "oauth" },
			{ id: "openai", kind: "api_key" },
			{ id: "github-copilot", kind: "oauth" },
			{ id: "xai-broken", kind: "oauth" },
		],
		providerRules(),
		{
			login: async (sink, providerId) => {
				if (providerId === "xai-broken") throw new Error("cancelled in the browser");
				const credential = { type: "oauth", access: "cloud-access", refresh: "cloud-refresh", expires: 2 } as never;
				await sink.modify(providerId, async () => credential);
				return credential;
			},
			enroll: async (providerId) => ({ token: `enroll-${providerId}` }),
			upload: async (token, credential) => void uploads.push({ token, credential }),
			localApiKey: async (providerId) =>
				(JSON.parse(readFileSync(local, "utf8")) as Record<string, { key?: string }>)[providerId]?.key,
		},
	);
	expect(readFileSync(local).equals(before)).toBe(true);
	expect(results).toEqual([
		{ provider: "anthropic", status: "connected" },
		{ provider: "openai", status: "connected" },
		{ provider: "github-copilot", status: "disabled" },
		{ provider: "xai-broken", status: "failed", error: "cancelled in the browser" },
	]);
	// The cloud got fresh sign-in tokens, never the local ones; the API key went as it is.
	expect(JSON.stringify(uploads)).not.toContain("local-access");
	expect(uploads.map((upload) => upload.token)).toEqual(["enroll-anthropic", "enroll-openai"]);
	expect(providerRules().find((rule) => rule.id === "anthropic")!.note).toMatch(/extra usage/);
	expect(
		providerRules()
			.filter((rule) => rule.enabled)
			.map((rule) => rule.id),
	).toEqual(["anthropic"]);
});

test("the egress proxy reaches public hosts only, unless a private host is authorized", () => {
	const policy = { authorizedHosts: [] };
	expect(egressAllowed("127.0.0.1", 80, [], policy)).toBe(false);
	expect(egressAllowed("192.168.1.10", 80, [], policy)).toBe(false);
	expect(egressAllowed("169.254.169.254", 80, [], policy)).toBe(false);
	expect(egressAllowed("rebind.example", 443, ["93.184.216.34", "10.0.0.5"], policy)).toBe(false);
	expect(egressAllowed("localhost", 443, ["93.184.216.34"], policy)).toBe(false);
	expect(egressAllowed("example.com", 443, ["93.184.216.34"], policy)).toBe(true);
	expect(egressAllowed("nas.home", 5000, ["192.168.1.10"], { authorizedHosts: ["nas.home:5000"] })).toBe(true);
});

test("with fail-closed set, a dropped link stops traffic instead of falling back", () => {
	expect(routeFor({ homeRouting: true, linkUp: true, failClosed: true })).toBe("home");
	expect(routeFor({ homeRouting: true, linkUp: false, failClosed: true })).toBe("blocked");
	expect(routeFor({ homeRouting: true, linkUp: false, failClosed: false })).toBe("direct");
	expect(routeFor({ homeRouting: false, linkUp: false, failClosed: true })).toBe("direct");
});

test("a command asks once per session, then runs under Allow on this computer", async () => {
	const policy = new LocalComputerPolicy();
	const asked: string[] = [];
	const ran: string[] = [];
	let answer: "allow" | "allow-on-this-computer" | "deny" = "deny";
	const deps = {
		ask: async ({ command }: { command: string }) => (asked.push(command), answer),
		run: async (command: string) => (ran.push(command), { output: "ok", exitCode: 0 }),
	};
	const exec = (id: string, session: string, command: string) =>
		handleExec({ id, botId: "b", session, command }, policy, deps);
	expect(await exec("1", "s1", "rm -rf ~")).toEqual({ kind: "exec-result", id: "1", refused: true });
	answer = "allow-on-this-computer";
	expect(await exec("2", "s1", "ls")).toEqual({ kind: "exec-result", id: "2", output: "ok", exitCode: 0 });
	expect(await exec("3", "s2", "pwd")).toMatchObject({ output: "ok" });
	expect(asked).toEqual(["rm -rf ~", "ls"]);
	expect(ran).toEqual(["ls", "pwd"]);
	policy.reset();
	await exec("4", "s3", "whoami");
	expect(asked).toHaveLength(3);
});

test("computer access is off by default, needs the native confirmation, and closes the socket when revoked", async () => {
	let settings = { enabled: false };
	let confirm = false;
	const sockets: { closed: boolean }[] = [];
	const link = new ComputerLink({
		settings: { read: () => settings, write: (next) => void (settings = next) },
		confirm: async (message) => (expect(message).toMatch(/full access/), confirm),
		open: async () => {
			const socket = { closed: false, close: () => void (socket.closed = true) };
			sockets.push(socket);
			return socket;
		},
	});
	await link.start();
	expect(sockets).toHaveLength(0);
	expect(await link.enable()).toBe(false);
	expect(link.enabled).toBe(false);
	confirm = true;
	expect(await link.enable()).toBe(true);
	link.disable();
	expect(link.enabled).toBe(false);
	expect(sockets[0]!.closed).toBe(true);
});

test("the session is kept only through the keychain, and passkeys relay on Windows only", async () => {
	const root = mkdtempSync(join(tmpdir(), "kc-bots-session-"));
	dir = root;
	const keychain = (available: boolean) => ({
		isEncryptionAvailable: () => available,
		encryptString: (text: string) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x5a)),
		decryptString: (data: Buffer) => Buffer.from([...data].map((byte) => byte ^ 0x5a)).toString(),
	});
	expect(() => new BotsSession({ path: join(root, "no", "session"), keychain: keychain(false) }).save("tok")).toThrow(
		/keychain/,
	);
	const session = new BotsSession({
		path: join(root, "session"),
		keychain: keychain(true),
		fetch: (async (_url: string, init: RequestInit) =>
			Response.json({ ticket: `t-for-${new Headers(init.headers).get("authorization")}`, expiresAt: 1 })) as never,
	});
	session.save("session-token");
	expect(readFileSync(join(root, "session")).toString()).not.toContain("session-token");
	expect(await session.ticket("socket")).toEqual({ ticket: "t-for-Bearer session-token", expiresAt: 1 });
	expect(createPasskeyRelay("win32", { authenticate: async () => "assertion" }).available).toBe(true);
	expect(await createPasskeyRelay("darwin", { authenticate: async () => "assertion" }).authenticate({})).toEqual({
		ok: false,
		reason: "unavailable",
	});
});

test("signs in to KnightCode Bots through the browser, keeping the session encrypted and handing out tickets", async () => {
	const { DesktopBots } = await import("../../src/main/bots/desktop-bots.ts");
	const root = mkdtempSync(join(tmpdir(), "kc-bots-desktop-"));
	dir = root;
	const opened: string[] = [];
	const calls: { url: string; authorization: string | null; body: string }[] = [];
	const fakeFetch = (async (url: string, init: RequestInit) => {
		calls.push({ url, authorization: new Headers(init.headers).get("authorization"), body: String(init.body ?? "") });
		if (url.endsWith("/auth/desktop/exchange")) return Response.json({ token: "desktop-session", accountId: "acc-1" });
		return Response.json({ ticket: "api-ticket", expiresAt: 1 });
	}) as never;
	const keychain = {
		isEncryptionAvailable: () => true,
		encryptString: (text: string) => Buffer.from([...Buffer.from(text)].map((byte) => byte ^ 0x2a)),
		decryptString: (data: Buffer) => Buffer.from([...data].map((byte) => byte ^ 0x2a)).toString(),
	};
	const bots = new DesktopBots({
		dir: root,
		keychain,
		openExternal: async (url) => void opened.push(url),
		fetch: fakeFetch,
	});
	expect(bots.status().signedIn).toBe(false);
	const signedIn = bots.signIn();
	const state = new URL(opened[0]!).searchParams.get("state")!;
	expect(opened[0]).toMatch(/\/auth\/desktop\?state=/);
	// A link for another sign-in is ignored.
	await bots.complete("knightcode://bots-signin?code=stolen&state=not-ours");
	expect(calls).toEqual([]);
	await bots.complete(`knightcode://bots-signin?code=good&state=${state}`);
	expect(await signedIn).toMatchObject({ signedIn: true, accountId: "acc-1" });
	expect(readFileSync(join(root, "bots-session")).toString()).not.toContain("desktop-session");
	expect(await bots.ticket("api")).toEqual({ ticket: "api-ticket", expiresAt: 1 });
	expect(calls.at(-1)).toMatchObject({
		authorization: "Bearer desktop-session",
		body: JSON.stringify({ scope: "api" }),
	});
	bots.signOut();
	expect(bots.status().signedIn).toBe(false);
});

test("the computer link signs in with a socket ticket, asks once per session, then runs commands in the shell", async () => {
	const sent: unknown[] = [];
	const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
	let opened = "";
	const socket: LinkSocket = {
		send: (data) => void sent.push(JSON.parse(data)),
		close: () => {},
		addEventListener: (type: string, listener: (event: { data: unknown }) => void) =>
			void (listeners[type] ??= []).push(listener),
	};
	const asked: string[] = [];
	await connectComputerLink({
		origin: "https://bots.example",
		accountId: "acct 1",
		// A slow ticket, and a socket that opens at once: the auth frame must still go out.
		ticket: () => new Promise((resolve) => setTimeout(() => resolve("tk-1"), 30)),
		policy: new LocalComputerPolicy(),
		ask: async ({ command }) => (asked.push(command), "allow"),
		run: (command) => runInShell(command, { cwd: tmpdir() }),
		socket: (url) => {
			opened = url;
			queueMicrotask(() => {
				for (const listener of listeners.open ?? []) listener({ data: undefined });
			});
			return socket;
		},
	});
	expect(opened).toBe("wss://bots.example/api/desktop/acct%201/link");
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(sent).toEqual([{ kind: "auth", ticket: "tk-1" }]);
	const exec = async (id: string, command: string) => {
		for (const listener of listeners.message ?? [])
			listener({ data: JSON.stringify({ kind: "exec", id, botId: "b1", session: "s1", command }) });
		const deadline = Date.now() + 10_000;
		while (!sent.some((frame) => (frame as { id?: string }).id === id) && Date.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 20));
		return sent.find((frame) => (frame as { id?: string }).id === id) as { output: string; exitCode: number };
	};
	expect(await exec("x1", "echo first")).toMatchObject({
		kind: "exec-result",
		exitCode: 0,
		output: expect.stringContaining("first"),
	});
	expect(await exec("x2", "echo second")).toMatchObject({ exitCode: 0, output: expect.stringContaining("second") });
	// One question for the session.
	expect(asked).toEqual(["echo first"]);
});

test("home routing: the link makes a connection only to an allowed destination and carries its bytes both ways", async () => {
	const server = createServer((connection) => connection.on("data", (chunk) => connection.end(`echo:${chunk}`)));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	const sent: { kind: string; id?: string; data?: string; reason?: string }[] = [];
	const listeners: Record<string, ((event: { data: unknown }) => void)[]> = {};
	let authorized: string[] = [];
	const link = await connectComputerLink({
		origin: "https://bots.example",
		accountId: "a1",
		ticket: async () => "tk",
		policy: new LocalComputerPolicy(),
		ask: async () => "deny",
		run: async () => ({ output: "", exitCode: 0 }),
		socket: () => ({
			send: (data) => void sent.push(JSON.parse(data)),
			close: () => {},
			addEventListener: (type: string, listener: (event: { data: unknown }) => void) =>
				void (listeners[type] ??= []).push(listener),
		}),
		egress: { policy: async () => ({ authorizedHosts: authorized }) },
	});
	const frame = (value: unknown) => {
		for (const listener of listeners.message ?? []) listener({ data: JSON.stringify(value) });
	};
	const waitFor = async (check: () => boolean) => {
		const deadline = Date.now() + 5_000;
		while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
	};
	try {
		// A private address the owner did not allow: refused.
		frame({ kind: "proxy-open", id: "t1", host: "127.0.0.1", port });
		await waitFor(() => sent.some((entry) => entry.id === "t1"));
		expect(sent.find((entry) => entry.id === "t1")).toMatchObject({
			kind: "proxy-close",
			reason: expect.stringContaining("refused"),
		});
		// Allowed by the owner: the bytes go through, and the answer comes back.
		authorized = [`127.0.0.1:${port}`];
		frame({ kind: "proxy-open", id: "t2", host: "127.0.0.1", port });
		frame({ kind: "proxy-data", id: "t2", data: Buffer.from("hi").toString("base64") });
		await waitFor(() => sent.some((entry) => entry.id === "t2" && entry.kind === "proxy-close"));
		const back = sent
			.filter((entry) => entry.id === "t2" && entry.kind === "proxy-data")
			.map((entry) => Buffer.from(entry.data!, "base64").toString())
			.join("");
		expect(back).toBe("echo:hi");
		expect(sent.find((entry) => entry.id === "t2" && entry.kind === "proxy-close")?.reason).toBe("end");
	} finally {
		link.close();
		server.close();
	}
});
