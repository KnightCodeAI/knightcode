/** Native window tokens target phases and preserve typed transport-loss outcomes without replay. */
import { afterEach, expect, test, vi } from "vitest";
import { Type } from "typebox";
import { DesktopExtensionWindows } from "../../src/main/desktop-extension-runtime.ts";
import { ServerConnection } from "../../src/main/server.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
afterEach(() => vi.restoreAllMocks());
async function fixture() {
	const server = new ServerConnection({
		command: { command: "not-started", args: [] },
		env: {},
		logsDir: "unused",
		clientVersion: "0",
		onMessage() {},
		onState() {},
		onExit() {},
	});
	server.state = "ready";
	const request = vi.spyOn(server, "request").mockResolvedValue({});
	const gateway = new DesktopExtensionWindows(server);
	const first = vi.fn();
	const second = vi.fn();
	gateway.attach(1, first);
	gateway.attach(2, second);
	await gateway.connect(1);
	const identity = request.mock.calls[0]![1] as { windowId: number; lifetime: string };
	const binding = {
		owner: "example",
		revision: "a".repeat(64),
		epoch: "epoch-1",
		window: "server:1",
		mount: "mount-1",
	};
	gateway.receive({
		method: "desktopExtension/phase",
		params: {
			...identity,
			id: "ready",
			phase: "ready",
			binding,
			artifact: {
				owner: "example",
				revision: binding.revision,
				root: "unused",
				frontend: "app.js",
				styles: [],
				files: ["app.js"],
			},
			contracts: {
				methods: {
					read: { kind: "read", params: Type.Null(), result: Type.Null() },
					write: { kind: "write", params: Type.Null(), result: Type.Null() },
				},
				events: {},
			},
		},
	});
	return { server, request, gateway, first, second, identity, binding };
}

test("retiring an old binding keeps the prepared artifact until its publication", async () => {
	const { gateway, identity, binding } = await fixture();
	const next = { ...binding, epoch: "epoch-2", revision: "b".repeat(64) };
	const artifact = {
		owner: next.owner,
		revision: next.revision,
		root: "unused",
		frontend: "app.js",
		styles: [],
		files: ["app.js"],
	};
	gateway.receive({
		method: "desktopExtension/phase",
		params: {
			...identity,
			id: "prepare",
			phase: "prepare",
			binding: next,
			artifact,
			contracts: { methods: {}, events: {} },
		},
	});
	gateway.receive({
		method: "desktopExtension/phase",
		params: { ...identity, id: "revoke", phase: "revoke", binding },
	});
	expect(gateway.artifact(1, next.owner, next.revision)).toEqual(artifact);
	gateway.receive({
		method: "desktopExtension/phase",
		params: { ...identity, id: "retire", phase: "retire", binding },
	});
	expect(gateway.artifact(1, next.owner, next.revision)).toBeUndefined();
});

test("phase delivery is targeted, and an old port cannot grant a replacement port's binding", async () => {
	const { gateway, first, second, identity, binding } = await fixture();
	expect(first).toHaveBeenCalledOnce();
	expect(second).not.toHaveBeenCalled();
	const replacement = vi.fn();
	gateway.attach(1, replacement);
	gateway.receive({ method: "desktopExtension/phase", params: { ...identity, id: "late", phase: "revoke", binding } });
	expect(replacement).not.toHaveBeenCalled();
	expect(await gateway.call(1, 10, { binding, call: "late", method: "write", args: null })).toEqual({
		status: "disconnected",
	});
});

test("closing a window settles an admitted write as unknown, sends its real sequence, and never replays", async () => {
	const { gateway, request, binding } = await fixture();
	const result = deferred<unknown>();
	request.mockImplementation(async (method) => (method === "desktopExtension/call" ? result.promise : {}));
	const pending = gateway.call(1, 10, { binding, call: "write", method: "write", args: null });
	expect(request).toHaveBeenLastCalledWith("desktopExtension/call", expect.objectContaining({ requestId: 10 }));
	gateway.detach(1);
	expect(await pending).toEqual({ status: "outcome-unknown" });
	result.resolve({ status: "ok", value: null });
	await Promise.resolve();
	expect(request.mock.calls.filter(([method]) => method === "desktopExtension/call")).toHaveLength(1);
});

test("closing during a pending handshake disconnects that server peer without granting the replacement port", async () => {
	const { gateway, request } = await fixture();
	gateway.attach(1, vi.fn());
	request.mockClear();
	const handshake = deferred<unknown>();
	request.mockImplementation(async (method) => (method === "desktopExtension/window/connect" ? handshake.promise : {}));
	const connected = gateway.connect(1);
	const identity = request.mock.calls[0]![1];
	gateway.detach(1);
	expect(request).toHaveBeenLastCalledWith("desktopExtension/window/disconnect", identity);
	handshake.resolve({});
	await connected;
});

test("server loss disconnects reads and requires a new handshake", async () => {
	const { gateway, request, binding } = await fixture();
	const result = deferred<unknown>();
	request.mockImplementation(async (method) => (method === "desktopExtension/call" ? result.promise : {}));
	const pending = gateway.call(1, 11, { binding, call: "read", method: "read", args: null });
	gateway.serverRestarted();
	expect(await pending).toEqual({ status: "disconnected" });
	expect(await gateway.call(1, 12, { binding, call: "stale", method: "write", args: null })).toEqual({
		status: "disconnected",
	});
	result.resolve({ status: "ok", value: null });
});
