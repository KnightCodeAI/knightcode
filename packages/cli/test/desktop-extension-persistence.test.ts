/** Explicit backend data contexts never follow the renderer's selected project or thread. */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Type, type TSchema } from "typebox";
import { createAppServerContext, type AppServerContext } from "../src/app-server/context.ts";
import { DesktopBackend } from "../src/app-server/desktop-extensions/backend.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { ProjectTrustStore } from "../src/core/trust-manager.ts";
import {
	experimental_defineDesktopBackend,
	type experimental_DesktopBackendApp,
	type experimental_BackendDataSelector,
	type experimental_BackendDataContext,
} from "../src/desktop-backend.ts";

const roots: string[] = [];
const contexts: AppServerContext[] = [];
afterEach(() => {
	for (const ctx of contexts.splice(0)) ctx.dispose();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function fixture() {
	const root = mkdtempSync(join(tmpdir(), "kc-backend-context-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	const a = join(root, "A");
	const b = join(root, "B");
	mkdirSync(a);
	mkdirSync(b);
	const ctx = await createAppServerContext({
		agentDir,
		sessionDir: join(agentDir, "sessions", "test"),
		modelsPath: null,
	});
	contexts.push(ctx);
	const trust = new ProjectTrustStore(agentDir);
	trust.set(a, true);
	trust.set(b, true);
	const session = SessionManager.create(a, ctx.sessionDir);
	session.appendMessage({ role: "user", content: "metadata only", timestamp: 1 });
	const threadId = session.getSessionId();
	const transcript = session.getSessionFile()!;
	session.close();
	const before = readFileSync(transcript, "utf8");
	const data = join(root, "data");
	return { root, ctx, trust, a, b, threadId, transcript, before, data };
}
const signal = () => new AbortController().signal;
function backend(data: string, ctx: AppServerContext, owner = "example", schema: TSchema = Type.Number()) {
	let app!: experimental_DesktopBackendApp;
	let count!: ReturnType<experimental_DesktopBackendApp["experimental_storage"]>;
	let greeting!: ReturnType<experimental_DesktopBackendApp["experimental_setting"]>;
	const host = new DesktopBackend(
		owner,
		data,
		experimental_defineDesktopBackend((value) => {
			app = value;
			count = app.experimental_storage({ id: "count", schema });
			greeting = app.experimental_setting({ id: "greeting", schema: Type.String(), default: "default" });
			app.experimental_setting({ id: "token", schema: Type.String(), default: "private", secret: true });
		}),
		() => {},
		ctx,
	);
	return {
		host,
		get app() {
			return app;
		},
		get count() {
			return count;
		},
		get greeting() {
			return greeting;
		},
	};
}

it("keeps the accepted settings after an atomic replacement fails", async () => {
	const f = await fixture();
	const h = backend(f.data, f.ctx);
	await h.host.activate();
	h.greeting.experimental_set("accepted");
	const path = join(f.data, "example.json");
	const accepted = readFileSync(path, "utf8");
	rmSync(path);
	mkdirSync(path);
	expect(() => h.greeting.experimental_set("rejected")).toThrow();
	expect(h.greeting.experimental_get()).toBe("accepted");
	rmSync(path, { recursive: true });
	writeFileSync(path, accepted);
	h.count.experimental_set(4);
	await h.host.dispose();
	const next = backend(f.data, f.ctx);
	await next.host.activate();
	expect(next.greeting.experimental_get()).toBe("accepted");
	await next.host.dispose();
});

it("isolates owner/app/project/thread data, inherits settings thread > project > app > default, and never writes a transcript", async () => {
	const f = await fixture();
	const h = backend(f.data, f.ctx);
	await h.host.activate();
	const a = await h.app.experimental_context({ scope: "project", cwd: f.a }, signal());
	const b = await h.app.experimental_context({ scope: "project", cwd: f.b }, signal());
	const thread = await h.app.experimental_context({ scope: "thread", cwd: f.a, threadId: f.threadId }, signal());
	expect(h.greeting.experimental_get(thread)).toBe("default");
	h.greeting.experimental_set("app");
	expect(h.greeting.experimental_get(a)).toBe("app");
	h.greeting.experimental_set("project", a);
	expect(h.greeting.experimental_get(thread)).toBe("project");
	h.greeting.experimental_set("thread", thread);
	expect(h.greeting.experimental_get(a)).toBe("project");
	expect(h.greeting.experimental_get(b)).toBe("app");
	h.count.experimental_set(1);
	h.count.experimental_set(2, a);
	h.count.experimental_set(3, thread);
	expect(h.count.experimental_get(b)).toBeUndefined();
	expect([h.count.experimental_get(), h.count.experimental_get(a), h.count.experimental_get(thread)]).toEqual([
		1, 2, 3,
	]);
	const second = SessionManager.create(f.a, f.ctx.sessionDir);
	second.appendMessage({ role: "user", content: "second thread", timestamp: 1 });
	second.close();
	const threadB = await h.app.experimental_context(
		{ scope: "thread", cwd: f.a, threadId: second.getSessionId() },
		signal(),
	);
	h.count.experimental_set(4, threadB);
	expect(h.count.experimental_get(thread)).toBe(3);
	expect(h.count.experimental_get(threadB)).toBe(4);
	expect(h.host.publicSettings(thread)).toEqual({ greeting: "thread" });
	expect(() => h.host.setPublicSetting("token", "leak", thread)).toThrow(/secret/i);
	const other = backend(f.data, f.ctx, "other");
	await other.host.activate();
	const otherA = await other.app.experimental_context({ scope: "project", cwd: f.a }, signal());
	expect(other.count.experimental_get(otherA)).toBeUndefined();
	expect(() => other.count.experimental_get(a)).toThrow(/context/i);
	await other.host.dispose();
	await h.host.dispose();
	const next = backend(f.data, f.ctx);
	await next.host.activate();
	const saved = await next.app.experimental_context({ scope: "thread", cwd: f.a, threadId: f.threadId }, signal());
	expect(next.count.experimental_get(saved)).toBe(3);
	expect(next.greeting.experimental_get(saved)).toBe("thread");
	expect(() => next.count.experimental_get(thread)).toThrow(/context/i);
	expect(readFileSync(f.transcript, "utf8")).toBe(f.before);
	await next.host.dispose();
});

it("refuses missing, relative, untrusted, mismatched and unknown contexts, cancellation and trust revocation", async () => {
	const f = await fixture();
	const h = backend(f.data, f.ctx);
	await h.host.activate();
	// Wire input may use an extension's Type.Unknown params schema, so the host validates selectors independently.
	await expect(
		h.app.experimental_context(
			{ scope: "project", cwd: f.a, extra: true } as unknown as experimental_BackendDataSelector,
			signal(),
		),
	).rejects.toThrow(/selector/i);
	expect(() => h.count.experimental_get({ scope: "project" } as experimental_BackendDataContext)).toThrow(/context/i);
	await expect(h.app.experimental_context({ scope: "project", cwd: "relative" }, signal())).rejects.toThrow(
		/absolute/i,
	);
	await expect(
		h.app.experimental_context({ scope: "project", cwd: join(f.root, "missing") }, signal()),
	).rejects.toThrow(/directory/i);
	await expect(
		h.app.experimental_context({ scope: "thread", cwd: f.b, threadId: f.threadId }, signal()),
	).rejects.toThrow(/project/i);
	await expect(
		h.app.experimental_context({ scope: "thread", cwd: f.a, threadId: "missing" }, signal()),
	).rejects.toThrow(/thread/i);
	const active = new AbortController();
	const a = await h.app.experimental_context({ scope: "project", cwd: f.a }, active.signal);
	active.abort();
	expect(() => h.count.experimental_set(7, a)).toThrow();
	await expect(h.app.experimental_context({ scope: "project", cwd: f.a }, active.signal)).rejects.toThrow();
	const b = await h.app.experimental_context({ scope: "project", cwd: f.b }, signal());
	f.trust.set(f.b, false);
	expect(() => h.count.experimental_set(7, b)).toThrow(/trusted/i);
	await expect(h.app.experimental_context({ scope: "project", cwd: f.b }, signal())).rejects.toThrow(/trusted/i);
	await h.host.dispose();
	expect(readdirSync(f.root)).not.toContain("data");
});

it("canonicalizes project aliases and refuses a captured context after its directory is retargeted", async () => {
	const f = await fixture();
	const h = backend(f.data, f.ctx);
	await h.host.activate();
	const alias = join(f.root, "alias");
	symlinkSync(f.a, alias, process.platform === "win32" ? "junction" : "dir");
	const direct = await h.app.experimental_context({ scope: "project", cwd: f.a }, signal());
	const captured = await h.app.experimental_context({ scope: "project", cwd: alias }, signal());
	h.count.experimental_set(7, captured);
	expect(h.count.experimental_get(direct)).toBe(7);
	rmSync(alias);
	symlinkSync(f.b, alias, process.platform === "win32" ? "junction" : "dir");
	expect(() => h.count.experimental_set(9, captured)).toThrow(/identity/i);
	expect(h.count.experimental_get(direct)).toBe(7);
	await h.host.dispose();
});

it("stores schema-valid declaration names as own keys, including __proto__", async () => {
	const f = await fixture();
	let count!: ReturnType<experimental_DesktopBackendApp["experimental_storage"]>;
	const definition = experimental_defineDesktopBackend((app) => {
		count = app.experimental_storage({ id: "__proto__", schema: Type.Number() });
	});
	const first = new DesktopBackend("example", f.data, definition, () => {}, f.ctx);
	await first.activate();
	count.experimental_set(8);
	expect(count.experimental_get()).toBe(8);
	await first.dispose();
	const next = new DesktopBackend("example", f.data, definition, () => {}, f.ctx);
	await next.activate();
	expect(count.experimental_get()).toBe(8);
	await next.dispose();
});

it("validates every persisted scope during inert preparation and after old admitted scoped writes drain", async () => {
	const f = await fixture();
	const old = backend(f.data, f.ctx);
	await old.host.activate();
	const a = await old.app.experimental_context({ scope: "project", cwd: f.a }, signal());
	old.count.experimental_set(2, a);
	const candidate = backend(f.data, f.ctx);
	old.count.experimental_set(9, a);
	await old.host.dispose();
	await candidate.host.activate();
	const nextA = await candidate.app.experimental_context({ scope: "project", cwd: f.a }, signal());
	expect(candidate.count.experimental_get(nextA)).toBe(9);
	await candidate.host.dispose();
	expect(() => backend(f.data, f.ctx, "example", Type.String())).toThrow(/persisted/i);
});
