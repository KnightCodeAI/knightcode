/** Real jiti backends declare inert RPC contracts and keep secret settings server-side. */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import { Type } from "typebox";
import { DesktopBackend, prepareDesktopBackend } from "../src/app-server/desktop-extensions/backend.ts";
import { experimental_defineDesktopBackend } from "../src/desktop-backend.ts";

const roots: string[] = [];
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "kc-desktop-backend-"));
	roots.push(root);
	const entry = join(root, "server.ts");
	writeFileSync(
		entry,
		`
import { experimental_defineDesktopBackend } from "@knightcodeai/cli/desktop-backend";
import { Type } from "typebox";
export default experimental_defineDesktopBackend(app => {
 const greeting = app.experimental_setting({ id: "greeting", schema: Type.String(), default: "Hello" });
 const secret = app.experimental_setting({ id: "token", schema: Type.String(), default: "server-only-token", secret: true });
 const count = app.experimental_storage({ id: "count", schema: Type.Number() });
 const tick = app.experimental_event({ id: "tick", schema: Type.Number() });
 app.experimental_registerRpc({ id: "read", kind: "read", params: Type.Object({}), result: Type.String(), experimental_handle: () => greeting.experimental_get() });
 app.experimental_registerRpc({ id: "increment", kind: "write", params: Type.Object({ amount: Type.Number() }, { additionalProperties: false }), result: Type.Number(), experimental_handle: ({ amount }) => { const next = (count.experimental_get() ?? 0) + amount; count.experimental_set(next); tick.experimental_emit(next); return next; } });
 app.experimental_registerRpc({ id: "invalidResult", kind: "read", params: Type.Object({}), result: Type.Number(), experimental_handle: () => "bad" });
 app.experimental_onActivate(() => { count.experimental_set((count.experimental_get() ?? 0) + 10); return () => {}; });
});
`,
	);
	return { root, entry, data: join(root, "data") };
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("desktop backend declarations", () => {
	it("does not allow an absent storage read to widen its schema-checked setter", () => {
		experimental_defineDesktopBackend((app) => {
			const value = app.experimental_storage({ id: "count", schema: Type.Number() });
			expectTypeOf<ReturnType<typeof value.experimental_get>>().toEqualTypeOf<number | undefined>();
			expectTypeOf<Parameters<typeof value.experimental_set>[0]>().toEqualTypeOf<number>();
		});
	});

	it("loads with real jiti, keeps setup inert, and validates both RPC boundaries", async () => {
		const { entry, data } = fixture();
		const backend = await prepareDesktopBackend(entry, "example", data, () => {});
		await expect(backend.call("read", {}, new AbortController().signal)).rejects.toThrow(/inactive/i);
		await backend.activate();
		expect(backend.kind("increment")).toBe("write");
		expect(await backend.call("increment", { amount: 2 }, new AbortController().signal)).toBe(12);
		await expect(backend.call("increment", { amount: "bad" }, new AbortController().signal)).rejects.toThrow(
			/parameters/i,
		);
		await expect(backend.call("increment", { amount: 1, extra: true }, new AbortController().signal)).rejects.toThrow(
			/parameters/i,
		);
		await expect(backend.call("invalidResult", {}, new AbortController().signal)).rejects.toThrow(/result/i);
		await backend.dispose();
		await expect(backend.call("read", {}, new AbortController().signal)).rejects.toThrow(/inactive/i);
	});

	it("publishes RPC/event schemas but no secret settings in its prepared contract", async () => {
		const { entry, data } = fixture();
		const backend = await prepareDesktopBackend(entry, "example", data, () => {});
		expect(backend.contracts()).toMatchObject({
			methods: { read: { kind: "read", result: { type: "string" } }, increment: { kind: "write" } },
			events: { tick: { type: "number" } },
		});
		expect(JSON.stringify(backend.contracts())).not.toContain("server-only-token");
		await backend.dispose();
	});

	it("returns only non-secret settings and refuses secret or invalid frontend writes", async () => {
		const { entry, data } = fixture();
		const backend = await prepareDesktopBackend(entry, "example", data, () => {});
		await backend.activate();
		expect(backend.publicSettings()).toEqual({ greeting: "Hello" });
		expect(() => backend.setPublicSetting("token", "leak")).toThrow(/secret/i);
		expect(() => backend.setPublicSetting("greeting", 1)).toThrow(/setting/i);
		backend.setPublicSetting("greeting", "Updated");
		expect(await backend.call("read", {}, new AbortController().signal)).toBe("Updated");
		await backend.dispose();
		const next = await prepareDesktopBackend(entry, "example", data, () => {});
		await next.activate();
		expect(next.publicSettings()).toEqual({ greeting: "Updated" });
		expect(JSON.stringify(next.publicSettings())).not.toContain("server-only-token");
		await next.dispose();
	});

	it("mediates settings through reserved schema-checked RPC without exposing secrets", async () => {
		const { entry, data } = fixture();
		const backend = await prepareDesktopBackend(entry, "example", data, () => {});
		await backend.activate();
		expect(backend.kind("@settings/write")).toBe("write");
		expect(await backend.call("@settings/read", { context: { scope: "app" } }, new AbortController().signal)).toEqual({
			greeting: "Hello",
		});
		expect(
			await backend.call(
				"@settings/write",
				{ id: "greeting", value: "Changed", context: { scope: "app" } },
				new AbortController().signal,
			),
		).toEqual({ greeting: "Changed" });
		await expect(
			backend.call("@settings/write", { id: "token", value: "leak" }, new AbortController().signal),
		).rejects.toThrow(/secret/i);
		await backend.dispose();
	});

	it("rereads persisted values after admitted old writes drain instead of activating a stale preparation snapshot", async () => {
		const { entry, data } = fixture();
		const old = await prepareDesktopBackend(entry, "example", data, () => {});
		await old.activate();
		const candidate = await prepareDesktopBackend(entry, "example", data, () => {});
		expect(await old.call("increment", { amount: 2 }, new AbortController().signal)).toBe(12);
		await old.dispose();
		await candidate.activate();
		expect(await candidate.call("increment", { amount: 0 }, new AbortController().signal)).toBe(22);
		await candidate.dispose();
	});

	it("validates persisted data instead of accepting incompatible storage on a later revision", async () => {
		const { entry, data } = fixture();
		const first = await prepareDesktopBackend(entry, "example", data, () => {});
		await first.activate();
		await first.dispose();
		writeFileSync(
			entry,
			readFileSync(entry, "utf8").replace('id: "count", schema: Type.Number()', 'id: "count", schema: Type.String()'),
		);
		await expect(prepareDesktopBackend(entry, "example", data, () => {})).rejects.toThrow(/persisted/i);
	});

	it("rejects async setup and observes its eventual rejection", async () => {
		const { data } = fixture();
		expect(
			() =>
				new DesktopBackend(
					"example",
					data,
					experimental_defineDesktopBackend(async () => {
						await Promise.resolve();
						throw new Error("late setup failure");
					}),
					() => {},
				),
		).toThrow(/synchronous/i);
		await Promise.resolve();
		await Promise.resolve();
	});

	it("cleans up late activation and never starts subsequent services after revocation", async () => {
		const { data } = fixture();
		let release!: () => void;
		const waiting = new Promise<void>((resolve) => {
			release = resolve;
		});
		let cleanups = 0;
		let secondService = 0;
		const backend = new DesktopBackend(
			"example",
			data,
			experimental_defineDesktopBackend((app) => {
				app.experimental_onActivate(async () => {
					await waiting;
					return () => {
						cleanups++;
					};
				});
				app.experimental_onActivate(() => {
					secondService++;
				});
			}),
			() => {},
		);
		const activation = backend.activate();
		await backend.dispose();
		release();
		await expect(activation).rejects.toThrow(/inactive/i);
		expect(cleanups).toBe(1);
		expect(secondService).toBe(0);
	});

	it("stops event delivery during quiescence and revokes emitters after disposal", async () => {
		const { entry, data } = fixture();
		const events: unknown[] = [];
		const backend = await prepareDesktopBackend(entry, "example", data, (id, value) => {
			events.push({ id, value });
		});
		await backend.activate();
		await backend.call("increment", { amount: 1 }, new AbortController().signal);
		await backend.pause();
		await backend.call("increment", { amount: 1 }, new AbortController().signal);
		expect(events).toEqual([{ id: "tick", value: 11 }]);
		await backend.resume();
		await backend.call("increment", { amount: 1 }, new AbortController().signal);
		expect(events).toEqual([
			{ id: "tick", value: 11 },
			{ id: "tick", value: 13 },
		]);
		await backend.dispose();
	});
});
