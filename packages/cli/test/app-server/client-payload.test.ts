import { afterEach, expect, test } from "vitest";
import type { AppServerClient } from "../../src/app-server/client.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";

const clients: AppServerClient[] = [];
afterEach(() => {
	for (const client of clients.splice(0)) client.close();
});
async function clientFor(bytes: Buffer, chunkBytes = bytes.length) {
	const client = createInProcessClient({
		version: "test",
		handlers: {
			"payload/read": async ({ offset }) => {
				const chunk = bytes.subarray(offset, offset + chunkBytes);
				const next = offset + chunk.length;
				return {
					data: chunk.toString("base64"),
					eof: next === bytes.length,
					...(next < bytes.length ? { nextOffset: next } : {}),
				};
			},
		},
	});
	clients.push(client);
	await client.initialize();
	return client;
}

test("payload JSON rejects invalid UTF-8 instead of silently changing string content", async () => {
	const bytes = Buffer.from([0x22, 0xc3, 0x28, 0x22]);
	const client = await clientFor(bytes);
	await expect(client.readPayload({ id: "payload", byteLength: bytes.length })).rejects.toMatchObject({
		code: "internal",
	});
});

test("payload UTF-8 decoding spans chunk boundaries without losing Unicode", async () => {
	const value = { text: "😀漢字" };
	const bytes = Buffer.from(JSON.stringify(value));
	const client = await clientFor(bytes, 1);
	await expect(client.readPayload({ id: "payload", byteLength: bytes.length })).resolves.toEqual(value);
});
