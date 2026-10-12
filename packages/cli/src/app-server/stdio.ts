/**
 * ndjson over a readable and a line writer (§5.9). Logs belong on stderr; stdout carries only
 * protocol lines. LF framing only: payload strings may contain U+2028 and U+2029, which readline
 * would split on (modes/rpc/jsonl.ts explains). Limits count UTF-8 bytes.
 */

import type { Readable } from "node:stream";
import type { Message } from "@knightcode/app-server-protocol";
import { serializeJsonLine } from "../modes/rpc/jsonl.ts";
import type { Transport } from "./transport.ts";

export interface StdioLimits {
	/** Longest accepted line, in UTF-8 bytes. Images arrive base64 inside turn/start. */
	maxLineBytes: number;
	/** Written-but-unflushed output, in UTF-8 bytes, past which the client counts as gone. */
	maxPendingBytes: number;
}

export const DEFAULT_STDIO_LIMITS: StdioLimits = { maxLineBytes: 64 * 1024 * 1024, maxPendingBytes: 64 * 1024 * 1024 };

const NEWLINE = 0x0a;

export function createStdioTransport(
	input: Readable,
	write: (text: string) => Promise<void>,
	limits: StdioLimits = DEFAULT_STDIO_LIMITS,
): Transport {
	const messageHandlers: Array<(message: unknown) => void> = [];
	const inputEndHandlers: Array<() => void> = [];
	const closeHandlers: Array<() => void> = [];
	let state: "open" | "draining" | "closed" = "open";
	let reading = true;
	let pending = 0;
	let tail: Promise<void> = Promise.resolve();

	const finish = () => {
		if (state === "closed") return;
		state = "closed";
		stopReading();
		for (const handler of closeHandlers) handler();
	};

	const close = (mode: "drain" | "abort" = "drain") => {
		if (state !== "open") {
			if (mode === "abort") finish();
			return;
		}
		stopReading();
		if (mode === "abort") return finish();
		state = "draining";
		void tail.then(finish);
	};

	const send = (message: Message) => {
		if (state !== "open") return;
		const text = serializeJsonLine(message);
		const bytes = Buffer.byteLength(text, "utf8");
		pending += bytes;
		if (pending > limits.maxPendingBytes) {
			// The client stopped reading stdout. Buffering without bound would exhaust memory.
			process.stderr.write("app-server: the client is not reading its output; closing the connection\n");
			return close("abort");
		}
		const done = () => {
			pending -= bytes;
		};
		// After an abort, lines still queued here are dropped rather than written. A failed write (EPIPE: the
		// reader closed its end) means nothing more can be delivered: abort, so AppServer sees the close and
		// shutdown runs in order, instead of a second exit path.
		tail = tail
			.then(() => (state === "closed" ? undefined : write(text)))
			.then(done, (error: unknown) => {
				done();
				process.stderr.write(
					`app-server: writing stdout failed (${error instanceof Error ? error.message : String(error)}); closing the connection\n`,
				);
				close("abort");
			});
	};

	const tooLong = () =>
		send({ method: "error", params: { message: `Line longer than ${limits.maxLineBytes} bytes; dropped` } });

	const handleLine = (raw: Buffer) => {
		const decoded = raw.toString("utf8");
		const line = decoded.endsWith("\r") ? decoded.slice(0, -1) : decoded;
		if (line.trim() === "") return;
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch (error) {
			// No id to answer: JSON-RPC's parse error becomes an error notification.
			send({
				method: "error",
				params: { message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}` },
			});
			return;
		}
		for (const handler of messageHandlers) handler(message);
	};

	/** The current line's bytes so far. 0x0A never occurs inside a multibyte character, so splits are safe. */
	let parts: Buffer[] = [];
	let size = 0;
	/** Inside an oversized line: drop input up to its newline. */
	let discarding = false;

	const onData = (chunk: string | Buffer) => {
		let data = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
		for (;;) {
			const newline = data.indexOf(NEWLINE);
			const piece = newline === -1 ? data : data.subarray(0, newline);
			if (!discarding) {
				if (size + piece.length > limits.maxLineBytes) {
					tooLong();
					discarding = true;
					parts = [];
					size = 0;
				} else {
					parts.push(piece);
					size += piece.length;
				}
			}
			if (newline === -1) return;
			data = data.subarray(newline + 1);
			if (discarding) {
				// The newline ends the oversized line.
				discarding = false;
				continue;
			}
			const line = Buffer.concat(parts, size);
			parts = [];
			size = 0;
			handleLine(line);
		}
	};

	/** EOF or a closed stdin: read the last line, stop reading, and say so. Output stays open. */
	const endInput = () => {
		if (!reading) return;
		if (!discarding && size > 0) {
			const line = Buffer.concat(parts, size);
			parts = [];
			size = 0;
			handleLine(line);
		}
		stopReading();
		for (const handler of inputEndHandlers) handler();
	};

	function stopReading() {
		if (!reading) return;
		reading = false;
		input.off("data", onData);
		input.off("end", endInput);
		input.off("close", endInput);
	}

	input.on("data", onData);
	input.on("end", endInput);
	input.on("close", endInput);
	return {
		send,
		onMessage: (handler) => messageHandlers.push(handler),
		onInputEnd: (handler) => inputEndHandlers.push(handler),
		onClose: (handler) => closeHandlers.push(handler),
		close,
	};
}
