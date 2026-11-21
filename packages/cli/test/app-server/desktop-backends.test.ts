/** Real jiti backends and protocol envelopes; renderer phase acknowledgements are simulated, not Electron E2E. */
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { DesktopExtensionPhase, type DesktopActivationBinding } from "@knightcode/app-server-protocol";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { afterEach, expect, it, vi } from "vitest";
import { createAppServerContext } from "../../src/app-server/context.ts";
import { DesktopExtensionManager } from "../../src/app-server/desktop-extensions/manager.ts";
import { DesktopBackend } from "../../src/app-server/desktop-extensions/backend.ts";
import { desktopExtensionHandlers } from "../../src/app-server/desktop-extensions/handlers.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";
import { ProjectTrustStore } from "../../src/core/trust-manager.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
const checkPhase = Compile(DesktopExtensionPhase);
async function fixture(start = true) {
	const agentDir = mkdtempSync(join(tmpdir(), "kc-backend-wire-"));
	cleanups.push(() => rmSync(agentDir, { recursive: true, force: true }));
	const source = join(agentDir, "desktop-extensions", "example");
	mkdirSync(source, { recursive: true });
	writeFileSync(
		join(source, "package.json"),
		JSON.stringify({ knightcode: { desktop: { frontend: "./app.js", backend: "./server.js" } } }),
	);
	writeFileSync(join(source, "app.js"), "export default {apiVersion:1,experimental_setup(){}};");
	const starts = join(agentDir, "starts.txt");
	const version = (type: "Number" | "String") =>
		writeFileSync(
			join(source, "server.js"),
			`
import { experimental_defineDesktopBackend } from "@knightcodeai/cli/desktop-backend";
import { Type } from "typebox";
import { appendFileSync } from "node:fs";
export default experimental_defineDesktopBackend(app => {
 app.experimental_onActivate(() => { appendFileSync(${JSON.stringify(starts)}, "start\\n"); });
 const count = app.experimental_storage({ id: "count", schema: Type.Number() });
 const change = app.experimental_event({ id: "change", schema: Type.Number() });
 app.experimental_registerRpc({ id:"countRead", kind:"read", params:Type.Null(), result:Type.Number(), experimental_handle: () => count.experimental_get() ?? 0 });
 app.experimental_registerRpc({ id:"echo", kind:"read", params:Type.${type}(), result:Type.${type}(), experimental_handle: value => value });
 app.experimental_registerRpc({ id:"increment", kind:"write", params:Type.Number(), result:Type.Number(), experimental_handle: value => { const next = (count.experimental_get() ?? 0) + value; count.experimental_set(next); change.experimental_emit(next); return next; } });
 app.experimental_registerRpc({ id:"wait", kind:"write", params:Type.Number(), result:Type.Number(), experimental_handle: async ms => { await new Promise(resolve => setTimeout(resolve, ms)); const next = (count.experimental_get() ?? 0) + 1; count.experimental_set(next); return next; } });
 app.experimental_registerRpc({ id:"scopedIncrement", kind:"write", params:Type.Object({ selector:Type.Unknown(), amount:Type.Number() }), result:Type.Number(), experimental_handle: async ({selector, amount}, signal) => { const context = await app.experimental_context(selector, signal); const next = (count.experimental_get(context) ?? 0) + amount; count.experimental_set(next, context); return next; } });
});`,
		);
	version("Number");
	// Users opt into the preview switch before approving native code (off by default).
	new DesktopExtensionManager(agentDir).setPreview(true);
	const ctx = await createAppServerContext({ agentDir, credentials: new InMemoryCredentialStore(), modelsPath: null });
	cleanups.push(() => ctx.dispose());
	const client = createInProcessClient({ handlers: desktopExtensionHandlers(ctx), version: "test", mode: "desktop" });
	cleanups.push(() => client.close());
	await client.initialize();
	const { owner } = (await client.request("desktopExtension/list", {})).extensions[0]!;
	await client.request("desktopExtension/set", {
		owner,
		source,
		approve: true,
		kinds: ["frontend", "backend"],
		dev: true,
	});
	const bindings = new Map<number, DesktopActivationBinding>();
	const initialReady = Promise.withResolvers<void>();
	const events: unknown[] = [];
	const preparations: { windowId: number; starts: number }[] = [];
	let failPublication = 0;
	let failPreparation = false;
	let withholdDiscard = false;
	client.onNotification((method, params) => {
		if (method === "desktopExtension/event") events.push(params);
		if (method !== "desktopExtension/phase" || !checkPhase.Check(params)) return;
		if (params.phase === "prepare")
			preparations.push({
				windowId: params.windowId,
				starts: existsSync(starts) ? readFileSync(starts, "utf8").trim().split("\n").length : 0,
			});
		if (params.phase === "ready") {
			bindings.set(params.windowId, params.binding);
			if (bindings.size === 2) initialReady.resolve();
			return;
		}
		if (params.phase === "revoke") {
			bindings.delete(params.windowId);
			return;
		}
		if (params.phase === "discard" && params.windowId === 2 && withholdDiscard) return;
		void client
			.request("desktopExtension/ack", {
				windowId: params.windowId,
				lifetime: params.lifetime,
				id: params.id,
				binding: params.binding,
				...(params.phase === "prepare" && params.windowId === 2 && failPreparation
					? { error: "" }
					: params.phase === "publish" && params.windowId === failPublication
						? { error: "mount failed" }
						: {}),
			})
			.catch(() => {});
	});
	for (const windowId of [1, 2])
		await client.request("desktopExtension/window/connect", { windowId, lifetime: `window-${windowId}` });
	if (start) {
		await client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
		// Reconciliation may be superseded by a newer discovery; only ready establishes callable bindings.
		await initialReady.promise;
	}
	return {
		client,
		ctx,
		agentDir,
		owner,
		bindings,
		events,
		version,
		starts,
		preparations,
		ignoreDiscard: () => {
			withholdDiscard = true;
		},
		breakSource: () => writeFileSync(join(source, "server.js"), "export default ("),
		failPrepare: () => {
			failPreparation = true;
		},
		failWindow: (id: number) => {
			failPublication = id;
		},
	};
}

it("routes explicit project data through the real loader and never infers a window's selection", async () => {
	const { client, bindings, ctx, agentDir } = await fixture();
	const a = join(agentDir, "A");
	const b = join(agentDir, "B");
	mkdirSync(a);
	mkdirSync(b);
	const trust = new ProjectTrustStore(ctx.agentDir);
	trust.set(a, true);
	trust.set(b, true);
	let requestId = 0;
	const call = (windowId: number, cwd: string, amount: number) =>
		client.request("desktopExtension/call", {
			windowId,
			lifetime: `window-${windowId}`,
			binding: bindings.get(windowId)!,
			requestId: ++requestId,
			method: "scopedIncrement",
			args: { selector: { scope: "project", cwd }, amount },
		});
	expect(await call(1, a, 2)).toEqual({ status: "ok", value: 2 });
	expect(await call(2, b, 3)).toEqual({ status: "ok", value: 3 });
	expect(await call(2, a, 0)).toEqual({ status: "ok", value: 2 });
	trust.set(a, false);
	expect(await call(1, a, 7)).toEqual({ status: "error", message: expect.stringMatching(/trusted/i) });
});

it("binds incompatible schemas, subscriptions and responses to their original window epoch", async () => {
	const { client, bindings, events, version, owner } = await fixture();
	const old = bindings.get(1)!;
	expect(old).toBeDefined();
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: old,
			requestId: 1,
			method: "echo",
			args: 12,
		}),
	).toEqual({ status: "ok", value: 12 });
	await client.request("desktopExtension/subscribe", {
		windowId: 1,
		lifetime: "window-1",
		binding: old,
		id: "changes",
		event: "change",
	});
	await client.request("desktopExtension/call", {
		windowId: 1,
		lifetime: "window-1",
		binding: old,
		requestId: 2,
		method: "increment",
		args: 1,
	});
	expect(events).toHaveLength(1);
	version("String");
	await client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	const next = bindings.get(1)!;
	expect(next.epoch).not.toBe(old.epoch);
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: old,
			requestId: 3,
			method: "echo",
			args: 12,
		}),
	).toEqual({ status: "disconnected" });
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: next,
			requestId: 4,
			method: "echo",
			args: "v2",
		}),
	).toEqual({ status: "ok", value: "v2" });
	expect(
		await client.request("desktopExtension/call", {
			windowId: 2,
			lifetime: "window-2",
			binding: next,
			requestId: 5,
			method: "echo",
			args: "wrong window",
		}),
	).toEqual({ status: "disconnected" });
	await client.request("desktopExtension/call", {
		windowId: 1,
		lifetime: "window-1",
		binding: next,
		requestId: 6,
		method: "increment",
		args: 1,
	});
	expect(events).toHaveLength(1);
	expect(next.owner).toBe(owner);
});

it("an older staged reconciliation cannot roll a newer committed revision back", async () => {
	const { client, bindings, version } = await fixture();
	let captured!: () => void;
	let release!: () => void;
	const ready = new Promise<void>((resolve) => {
		captured = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const original = DesktopExtensionManager.prototype.candidates;
	vi.spyOn(DesktopExtensionManager.prototype, "candidates").mockImplementationOnce(async function (
		this: DesktopExtensionManager,
		cwd,
	) {
		const snapshot = await original.call(this, cwd);
		captured();
		await blocked;
		return snapshot;
	});
	const older = client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	await ready;
	version("String");
	await client.request("desktopExtension/reconcile", { windowId: 2, lifetime: "window-2" });
	const current = bindings.get(1)!;
	release();
	await older;
	expect(bindings.get(1)).toEqual(current);
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: current,
			requestId: 1,
			method: "echo",
			args: "new",
		}),
	).toEqual({ status: "ok", value: "new" });
});

it("a source returning during retirement waits for disposal before activating a fresh owner", async () => {
	const { client, bindings } = await fixture();
	const paused = Promise.withResolvers<void>();
	const release = Promise.withResolvers<void>();
	const staged = Promise.withResolvers<void>();
	const pause = DesktopBackend.prototype.pause;
	vi.spyOn(DesktopBackend.prototype, "pause").mockImplementationOnce(async function (this: DesktopBackend) {
		paused.resolve();
		await release.promise;
		await pause.call(this);
	});
	const candidates = DesktopExtensionManager.prototype.candidates;
	vi.spyOn(DesktopExtensionManager.prototype, "candidates")
		.mockResolvedValueOnce({ artifacts: [], enabled: new Set<string>() })
		.mockImplementationOnce(async function (this: DesktopExtensionManager, cwd) {
			const snapshot = await candidates.call(this, cwd);
			staged.resolve();
			return snapshot;
		});
	const removing = client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	await paused.promise;
	const returning = client.request("desktopExtension/reconcile", { windowId: 2, lifetime: "window-2" });
	await staged.promise;
	await new Promise<void>((resolve) => setImmediate(resolve));
	release.resolve();
	await Promise.all([removing, returning]);
	expect(bindings.size).toBe(2);
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: bindings.get(1)!,
			requestId: 1,
			method: "echo",
			args: 7,
		}),
	).toEqual({ status: "ok", value: 7 });
});

it("concurrent initial reconciliations prepare every connected window before starting the backend once", async () => {
	const { client, preparations, starts } = await fixture(false);
	await Promise.all(
		[1, 2].map((windowId) =>
			client.request("desktopExtension/reconcile", { windowId, lifetime: `window-${windowId}` }),
		),
	);
	expect(preparations.filter((entry) => entry.starts !== 0)).toEqual([]);
	expect(new Set(preparations.map((entry) => entry.windowId))).toEqual(new Set([1, 2]));
	expect(readFileSync(starts, "utf8")).toBe("start\n");
});

it("an explicitly failed preparation, even with an empty error, retains both old bindings", async () => {
	const { client, bindings, version, failPrepare } = await fixture();
	const old = bindings.get(1)!;
	failPrepare();
	version("String");
	await client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	expect(bindings.get(1)!.epoch).toBe(old.epoch);
	expect(bindings.get(2)!.epoch).toBe(old.epoch);
});

it("discarding inert frontend preparation does not wait for an unresponsive candidate cleanup", async () => {
	const { client, bindings, version, failPrepare, ignoreDiscard } = await fixture();
	const old = bindings.get(1)!;
	failPrepare();
	ignoreDiscard();
	version("String");
	const result = await Promise.race([
		client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" }).then(() => "retained"),
		new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 1_000)),
	]);
	expect(result).toBe("retained");
	expect(bindings.get(1)!.epoch).toBe(old.epoch);
});

it("simultaneous refreshes do not retry the same rejected candidate", async () => {
	const { client, preparations, version, failPrepare } = await fixture();
	failPrepare();
	version("String");
	await Promise.all(
		[1, 2].map((windowId) =>
			client.request("desktopExtension/reconcile", { windowId, lifetime: `window-${windowId}` }),
		),
	);
	expect(preparations).toHaveLength(4);
});

it("cancellation and window replacement never replay a completed write or restart the shared backend", async () => {
	const { client, bindings, starts } = await fixture();
	const old = bindings.get(1)!;
	const write = client.request("desktopExtension/call", {
		windowId: 1,
		lifetime: "window-1",
		binding: old,
		requestId: 1,
		method: "wait",
		args: 50,
	});
	await client.request("desktopExtension/cancel", { windowId: 1, lifetime: "window-1", binding: old, requestId: 1 });
	expect(await write).toEqual({ status: "outcome-unknown" });
	await client.request("desktopExtension/window/connect", { windowId: 1, lifetime: "replacement" });
	const current = bindings.get(1)!;
	expect(current.mount).not.toBe(old.mount);
	expect(current.epoch).toBe(old.epoch);
	await new Promise((resolve) => setTimeout(resolve, 80));
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "replacement",
			binding: current,
			requestId: 2,
			method: "countRead",
			args: null,
		}),
	).toEqual({ status: "ok", value: 1 });
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: old,
			requestId: 3,
			method: "countRead",
			args: null,
		}),
	).toEqual({ status: "disconnected" });
	expect(readFileSync(starts, "utf8")).toBe("start\n");
});

it("a malformed changed graph is a preparation failure, not an instruction to retire the live owner", async () => {
	const { client, bindings, breakSource } = await fixture();
	const binding = bindings.get(1)!;
	breakSource();
	expect((await client.request("desktopExtension/list", {})).extensions[0]!.error).toMatch(
		/unexpected|expected|parse/i,
	);
	await client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding,
			requestId: 1,
			method: "echo",
			args: 7,
		}),
	).toEqual({ status: "ok", value: 7 });
});

it("a cancelled real write remains in drain accounting and only an explicit reload retries the rejected revision", async () => {
	const { client, bindings, version, preparations } = await fixture();
	const old = bindings.get(1)!;
	const write = client.request("desktopExtension/call", {
		windowId: 1,
		lifetime: "window-1",
		binding: old,
		requestId: 1,
		method: "wait",
		args: 10_000,
	});
	await client.request("desktopExtension/cancel", { windowId: 1, lifetime: "window-1", binding: old, requestId: 1 });
	expect(await write).toEqual({ status: "outcome-unknown" });
	version("String");
	await client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	expect(bindings.get(1)!.epoch).toBe(old.epoch);
	expect(bindings.get(2)!.epoch).toBe(old.epoch);
	await new Promise((resolve) => setTimeout(resolve, 5_100));
	await client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	expect(bindings.get(1)!.epoch).toBe(old.epoch);
	expect(preparations).toHaveLength(4);
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: old,
			requestId: 2,
			method: "countRead",
			args: null,
		}),
	).toEqual({ status: "ok", value: 1 });
	await client.request("desktopExtension/reload", {});
	const current = bindings.get(1)!;
	expect(current.epoch).not.toBe(old.epoch);
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: current,
			requestId: 3,
			method: "countRead",
			args: null,
		}),
	).toEqual({ status: "ok", value: 1 });
});

it("a late render failure revokes only its original window binding", async () => {
	const { client, bindings } = await fixture();
	const first = bindings.get(1)!;
	const second = bindings.get(2)!;
	await client.request("desktopExtension/fail", {
		windowId: 2,
		lifetime: "window-2",
		binding: first,
		message: "foreign",
	});
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: first,
			requestId: 1,
			method: "countRead",
			args: null,
		}),
	).toEqual({ status: "ok", value: 0 });
	await client.request("desktopExtension/fail", {
		windowId: 1,
		lifetime: "window-1",
		binding: first,
		message: "render failed",
	});
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: first,
			requestId: 2,
			method: "countRead",
			args: null,
		}),
	).toEqual({ status: "disconnected" });
	expect(
		await client.request("desktopExtension/call", {
			windowId: 2,
			lifetime: "window-2",
			binding: second,
			requestId: 1,
			method: "countRead",
			args: null,
		}),
	).toEqual({ status: "ok", value: 0 });
});

it("revokes only a failed publisher and refuses a closed window's late call", async () => {
	const { client, bindings, version, failWindow } = await fixture();
	const closed = bindings.get(2)!;
	failWindow(2);
	version("String");
	await client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	expect(bindings.has(1)).toBe(true);
	expect(bindings.has(2)).toBe(false);
	await client.request("desktopExtension/window/disconnect", { windowId: 2, lifetime: "window-2" });
	expect(
		await client.request("desktopExtension/call", {
			windowId: 2,
			lifetime: "window-2",
			binding: closed,
			requestId: 1,
			method: "echo",
			args: 1,
		}),
	).toEqual({ status: "disconnected" });
});

// Windows fs.watch reports nothing when the watched source folder itself is renamed or deleted, so the next
// inventory read is the first sign the package is gone.
it("an inventory refresh that no longer finds a running source retires it in every window", async () => {
	const { client, agentDir, bindings, starts } = await fixture();
	const old = bindings.get(1)!;
	const before = readFileSync(starts, "utf8");
	rmSync(join(agentDir, "desktop-extensions", "example"), { recursive: true, force: true });
	const list = await client.request("desktopExtension/list", {});
	expect(list.extensions).toEqual([]);
	await vi.waitFor(() => expect(bindings.size).toBe(0));
	expect(
		await client.request("desktopExtension/call", {
			windowId: 1,
			lifetime: "window-1",
			binding: old,
			requestId: 1,
			method: "echo",
			args: 3,
		}),
	).toEqual({ status: "disconnected" });
	expect(readFileSync(starts, "utf8")).toBe(before);
});

it("turning the preview off retires the live backend in every window; on activates a fresh epoch", async () => {
	const { client, bindings, starts } = await fixture();
	const old = bindings.get(1)!;
	const call = (windowId: number, binding: DesktopActivationBinding, requestId: number) =>
		client.request("desktopExtension/call", {
			windowId,
			lifetime: `window-${windowId}`,
			binding,
			requestId,
			method: "echo",
			args: 3,
		});
	expect(await call(1, old, 1)).toEqual({ status: "ok", value: 3 });
	await client.request("desktopExtension/preview/set", { enabled: false });
	expect(bindings.size).toBe(0);
	expect(await call(1, old, 2)).toEqual({ status: "disconnected" });
	const list = await client.request("desktopExtension/list", {});
	expect(list.preview).toBe(false);
	expect(list.extensions[0]!.artifact).toBeUndefined();
	await client.request("desktopExtension/reload", {});
	expect(bindings.size).toBe(0);
	const before = readFileSync(starts, "utf8").trim().split("\n").length;
	await client.request("desktopExtension/preview/set", { enabled: true });
	await vi.waitFor(() => expect(bindings.size).toBe(2));
	expect(bindings.get(1)!.epoch).not.toBe(old.epoch);
	expect(readFileSync(starts, "utf8").trim().split("\n").length).toBe(before + 1);
	expect(await call(1, bindings.get(1)!, 3)).toEqual({ status: "ok", value: 3 });
});
