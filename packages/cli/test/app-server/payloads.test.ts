import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Item, Turn } from "@knightcode/app-server-protocol";
import { afterEach, expect, test, vi } from "vitest";
import { INLINE_PAYLOAD_BYTES, PayloadStore } from "../../src/app-server/payloads.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";

const dirs: string[] = [];
const stores: PayloadStore[] = [];
afterEach(async () => {
	for (const store of stores.splice(0)) await store.close();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	vi.useRealTimers();
});
function store() {
	const dir = mkdtempSync(join(tmpdir(), "kc-payload-"));
	dirs.push(dir);
	const value = new PayloadStore(dir);
	stores.push(value);
	return { value, dir };
}

test("small inputs are copied and large items freeze metadata and strings before async spooling", async () => {
	const { value } = store();
	const input = { nested: { value: "original" } };
	const small = value.input(input);
	input.nested.value = "changed";
	expect(small).toEqual({ input: { nested: { value: "original" } } });
	const text = '😀漢\n"\\'.repeat(20_000);
	const item: Item = { type: "agentMessage", id: "i", text };
	const wire = value.item(item);
	expect(wire.type).toBe("itemReference");
	if (wire.type !== "itemReference") throw new Error("expected reference");
	item.text = "mutated";
	const chunks: Buffer[] = [];
	let offset = 0;
	for (;;) {
		const chunk = await value.read({ id: wire.payload.id, offset, maxBytes: 49_151 });
		chunks.push(Buffer.from(chunk.data, "base64"));
		if (chunk.eof) break;
		expect(chunk.nextOffset).toBeGreaterThan(offset);
		offset = chunk.nextOffset!;
	}
	expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({ type: "agentMessage", id: "i", text });
});

test("invalid ids, offsets and chunk limits are refused; close releases files and rejects new work", async () => {
	const { value, dir } = store();
	const wire = value.item({ type: "agentMessage", id: "i", text: "x".repeat(INLINE_PAYLOAD_BYTES) });
	if (wire.type !== "itemReference") throw new Error("expected reference");
	await expect(value.read({ id: "../../auth.json", offset: 0 })).rejects.toMatchObject({ code: "payloadNotFound" });
	await expect(value.read({ id: wire.payload.id, offset: wire.payload.byteLength + 1 })).rejects.toMatchObject({
		code: "invalidParams",
	});
	await expect(value.read({ id: wire.payload.id, offset: -1 })).rejects.toMatchObject({ code: "invalidParams" });
	await expect(value.read({ id: wire.payload.id, offset: 0, maxBytes: 49_153 })).rejects.toMatchObject({
		code: "invalidParams",
	});
	await value.close();
	await value.close();
	await expect(value.read({ id: wire.payload.id, offset: 0 })).rejects.toMatchObject({ code: "shuttingDown" });
	expect(() => value.input({})).toThrow("shutting down");
	expect(readdirSync(join(dir, "app-server-payloads"))).toEqual([]);
});

test("payload leases expire and renew on reads", async () => {
	vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
	const { value } = store();
	const wire = value.item({ type: "agentMessage", id: "i", text: "x".repeat(INLINE_PAYLOAD_BYTES) });
	if (wire.type !== "itemReference") throw new Error("expected reference");
	await value.read({ id: wire.payload.id, offset: 0 });
	vi.setSystemTime(Date.now() + 29 * 60_000);
	await value.read({ id: wire.payload.id, offset: 0 });
	vi.setSystemTime(Date.now() + 29 * 60_000);
	await value.read({ id: wire.payload.id, offset: 0 });
	vi.setSystemTime(Date.now() + 31 * 60_000);
	await expect(value.read({ id: wire.payload.id, offset: 0 })).rejects.toMatchObject({ code: "payloadNotFound" });
});

test("a turn over 64 MiB progresses through a small reference and keeps full errors in the payload", async () => {
	const { value } = store();
	const turn: Turn = {
		id: "t",
		threadId: "thread",
		status: "failed",
		error: "😀".repeat(3_000),
		items: [{ type: "agentMessage", id: "i", text: "a".repeat(65 * 1024 * 1024) }],
	};
	const wire = value.turn(turn);
	expect("payload" in wire).toBe(true);
	expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(INLINE_PAYLOAD_BYTES);
	if (!("payload" in wire)) throw new Error("expected reference");
	expect([...wire.error!]).toHaveLength(2_000);
	expect(wire.payload.byteLength).toBeGreaterThan(64 * 1024 * 1024);
	const chunk = await value.read({ id: wire.payload.id, offset: 0 });
	expect(Buffer.from(chunk.data, "base64").length).toBe(49_152);
	expect(chunk.eof).toBe(false);
	const original = turn.items[0];
	if (original.type !== "agentMessage") throw new Error("expected agent text");
	original.text = "mutated after reference capture";
	const client = createInProcessClient({
		handlers: { "payload/read": async (params) => value.read(params) },
		version: "test",
	});
	try {
		await client.initialize();
		const restored = await client.resolveTurn(wire);
		expect(restored.error).toBe("😀".repeat(3_000));
		const item = restored.items[0];
		expect(item.type).toBe("agentMessage");
		if (item.type !== "agentMessage") throw new Error("expected agent text");
		expect(item.text.length).toBe(65 * 1024 * 1024);
		expect(item.text).toBe("a".repeat(65 * 1024 * 1024));
	} finally {
		client.close();
	}
}, 60_000);
