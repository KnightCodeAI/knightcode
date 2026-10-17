import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import { createInProcessPair } from "../../src/app-server/in-process.ts";
import { createStdioTransport } from "../../src/app-server/stdio.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function stdio(limits?: { maxLineBytes: number; maxPendingBytes: number }) {
	const input = new PassThrough();
	const written: string[] = [];
	let stall: Promise<void> | undefined;
	const write = async (text: string) => {
		if (stall) await stall;
		written.push(text);
	};
	const transport = createStdioTransport(input, write, limits);
	const received: unknown[] = [];
	transport.onMessage((message) => received.push(message));
	let closed = 0;
	transport.onClose(() => closed++);
	let inputEnded = 0;
	transport.onInputEnd(() => inputEnded++);
	return {
		input,
		written,
		transport,
		received,
		closed: () => closed,
		inputEnded: () => inputEnded,
		block: () => {
			stall = new Promise(() => {});
		},
	};
}

test("stdio parses one message per line, answers bad JSON with an error notification, and stays open", async () => {
	const s = stdio();
	s.input.write('{"method":"initialized","params":{}}\n{not json\n{"id":1,"meth');
	s.input.write('od":"model/list","params":{}}\n');
	await tick();
	expect(s.received).toEqual([
		{ method: "initialized", params: {} },
		{ id: 1, method: "model/list", params: {} },
	]);
	expect(s.written).toHaveLength(1);
	expect(JSON.parse(s.written[0])).toMatchObject({
		method: "error",
		params: { message: expect.stringContaining("JSON") },
	});
	s.transport.send({ id: 1, result: {} });
	await tick();
	expect(s.written[1]).toBe('{"id":1,"result":{}}\n');
});

test("stdio drops an oversized line up to its newline and keeps reading", async () => {
	// 40 fits the initialized line (36 bytes) but not the padded one.
	const s = stdio({ maxLineBytes: 40, maxPendingBytes: 1_000_000 });
	s.input.write(`{"method":"x","params":{"pad":"${"a".repeat(40)}`);
	s.input.write(`${"a".repeat(40)}"}}\n{"method":"initialized","params":{}}\n`);
	await tick();
	expect(s.received).toEqual([{ method: "initialized", params: {} }]);
	expect(s.written.map((line) => JSON.parse(line).method)).toEqual(["error"]);
	expect(s.closed()).toBe(0);
});

test("stdio counts the line limit in UTF-8 bytes, not characters", async () => {
	// 32 ASCII characters plus 20 two-byte characters: 52 characters, 72 bytes.
	const s = stdio({ maxLineBytes: 60, maxPendingBytes: 1_000_000 });
	s.input.write(
		Buffer.from(`{"method":"x","params":{"t":"${"é".repeat(20)}"}}\n{"method":"initialized","params":{}}\n`, "utf8"),
	);
	await tick();
	expect(s.received).toEqual([{ method: "initialized", params: {} }]);
	expect(s.written.map((line) => JSON.parse(line).method)).toEqual(["error"]);
});

test("stdio decodes a multibyte character split across chunks", async () => {
	const s = stdio();
	const bytes = Buffer.from('{"method":"x","params":{"t":"é"}}\n', "utf8");
	const cut = bytes.indexOf(0xc3) + 1;
	s.input.write(bytes.subarray(0, cut));
	s.input.write(bytes.subarray(cut));
	await tick();
	expect(s.received).toEqual([{ method: "x", params: { t: "é" } }]);
});

test("stdio aborts a client that stops reading", async () => {
	const s = stdio({ maxLineBytes: 1_000, maxPendingBytes: 64 });
	s.block();
	for (let i = 0; i < 10; i++) s.transport.send({ method: "n", params: { i } });
	await tick();
	expect(s.closed()).toBe(1);
});

test("stdio closes once when a write fails, and drops later sends", async () => {
	const input = new PassThrough();
	let writes = 0;
	const transport = createStdioTransport(input, async () => {
		writes++;
		throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
	});
	let closed = 0;
	transport.onClose(() => closed++);
	transport.send({ method: "a", params: {} });
	await tick();
	await tick();
	expect(closed).toBe(1);
	transport.send({ method: "b", params: {} });
	await tick();
	expect(writes).toBe(1);
});

test("stdio abort drops lines that are still queued", async () => {
	const s = stdio();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	// The first write is in flight; the rest wait behind it.
	const transport = createStdioTransport(s.input, async (text) => {
		await gate;
		s.written.push(text);
	});
	transport.send({ method: "a", params: {} });
	await tick();
	transport.send({ method: "b", params: {} });
	transport.send({ method: "c", params: {} });
	transport.close("abort");
	release();
	await tick();
	await tick();
	expect(s.written.map((line) => JSON.parse(line).method)).toEqual(["a"]);
});

test("stdio EOF ends input only: the last line is read, later sends are written, and close drains", async () => {
	const s = stdio();
	s.input.end('{"method":"initialized","params":{}}');
	await tick();
	expect(s.received).toEqual([{ method: "initialized", params: {} }]);
	expect(s.inputEnded()).toBe(1);
	expect(s.closed()).toBe(0);
	// A handler that finishes after EOF still answers.
	s.transport.send({ id: 1, result: {} });
	s.transport.close("drain");
	await tick();
	await tick();
	expect(s.written).toEqual(['{"id":1,"result":{}}\n']);
	expect(s.closed()).toBe(1);
});

test("in-process delivers in order, asynchronously, both ways", async () => {
	const { client, server } = createInProcessPair();
	const atServer: unknown[] = [];
	const atClient: unknown[] = [];
	server.onMessage((m) => atServer.push(m));
	client.onMessage((m) => atClient.push(m));
	client.send({ id: 1, method: "a", params: {} });
	client.send({ id: 2, method: "b", params: {} });
	expect(atServer).toEqual([]);
	server.send({ method: "n", params: {} });
	await tick();
	expect(atServer.map((m) => (m as { id: number }).id)).toEqual([1, 2]);
	expect(atClient).toEqual([{ method: "n", params: {} }]);
});

test("in-process close drains what was sent; abort drops it", async () => {
	const drained = createInProcessPair();
	const gotDrained: unknown[] = [];
	drained.client.onMessage((m) => gotDrained.push(m));
	drained.server.send({ id: 1, error: { code: "internal", message: "x" } });
	drained.server.close();
	await tick();
	expect(gotDrained).toHaveLength(1);

	const aborted = createInProcessPair();
	const gotAborted: unknown[] = [];
	let closed = 0;
	aborted.client.onMessage((m) => gotAborted.push(m));
	aborted.client.onClose(() => closed++);
	aborted.server.send({ id: 1, result: {} });
	aborted.server.close("abort");
	await tick();
	expect(gotAborted).toEqual([]);
	expect(closed).toBe(1);
});

test("in-process overflow closes both ends", async () => {
	const { client, server } = createInProcessPair(2);
	let closed = 0;
	client.onClose(() => closed++);
	server.onClose(() => closed++);
	for (let i = 0; i < 3; i++) client.send({ method: "x", params: {} });
	await tick();
	expect(closed).toBe(2);
});
