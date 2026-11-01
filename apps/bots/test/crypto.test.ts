// apps/bots/test/crypto.test.ts
import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import { createDataKey, open, seal } from "../src/crypto/envelope.ts";
import { openArchive, sealArchive } from "../src/crypto/archive.ts";
import { getKek } from "../src/env.ts";

it("seals and opens, and refuses another record's AAD", async () => {
	const { key } = await createDataKey(await testKek());
	const sealed = await seal(key, new TextEncoder().encode("secret"), "vault:1");
	expect(new TextDecoder().decode(await open(key, sealed, "vault:1"))).toBe("secret");
	await expect(open(key, sealed, "vault:2")).rejects.toThrow();
});

it("rejects reordered and truncated archives", async () => {
	const { key } = await createDataKey(await testKek());
	const { segments, manifest } = sealArchive(key, chunks(200_000), { storageId: "s", generation: 3 });
	const parts = await collect(segments);
	await expect(collect(openArchive(key, toIterable([parts[1]!, parts[0]!, ...parts.slice(2)]), await manifest))).rejects.toThrow();
	await expect(collect(openArchive(key, toIterable(parts.slice(0, -1)), await manifest))).rejects.toThrow();
	expect((await collect(openArchive(key, toIterable(parts), await manifest))).length).toBeGreaterThan(0);
});

it("unwraps a data key and opens what it sealed, and round-trips an archive byte for byte", async () => {
	const kek = await testKek();
	const { key, wrapped } = await createDataKey(kek);
	const sealed = await seal(key, new TextEncoder().encode("kept"), "r:1");
	const { unwrapDataKey } = await import("../src/crypto/envelope.ts");
	expect(new TextDecoder().decode(await open(await unwrapDataKey(kek, wrapped), sealed, "r:1"))).toBe("kept");

	const source = await collect(chunks(150_000));
	const { segments, manifest } = sealArchive(key, toIterable(source), { storageId: "s", generation: 1 });
	const parts = await collect(segments);
	const opened = await collect(openArchive(key, toIterable(parts), await manifest));
	expect(concat(opened)).toEqual(concat(source));
	// Another generation's manifest does not open these segments.
	await expect(collect(openArchive(key, toIterable(parts), { ...(await manifest), generation: 2 }))).rejects.toThrow();
	// An altered byte is refused.
	const altered = parts.map((part, i) => (i === 1 ? part.map((byte, j) => (j === 20 ? byte ^ 1 : byte)) : part));
	await expect(collect(openArchive(key, toIterable(altered), await manifest))).rejects.toThrow();
});

const testKek = () => getKek(env);

/** `total` random bytes in uneven chunks, as a stream would deliver them. */
async function* chunks(total: number): AsyncIterable<Uint8Array> {
	let left = total;
	let size = 7_000;
	while (left > 0) {
		const n = Math.min(left, size);
		const bytes = new Uint8Array(n);
		for (let offset = 0; offset < n; offset += 65_536) crypto.getRandomValues(bytes.subarray(offset, Math.min(n, offset + 65_536)));
		yield bytes;
		left -= n;
		size = (size * 3) % 90_001 || 1_000;
	}
}

async function collect(source: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
	const out: Uint8Array[] = [];
	for await (const part of source) out.push(part);
	return out;
}

async function* toIterable(parts: Uint8Array[]): AsyncIterable<Uint8Array> {
	for (const part of parts) yield part;
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
