import { describe, expect, test } from "vitest";
import { decodeViewerFrame, encodeFrame, MAX_PROMPT_BYTES } from "../src/protocol.ts";

describe("remote protocol", () => {
	test("round-trips a viewer prompt", () => {
		const encoded = encodeFrame({ v: 1, type: "prompt", text: "hello" });
		expect(decodeViewerFrame(encoded)).toEqual({ v: 1, type: "prompt", text: "hello" });
	});

	test("accepts hello with and without a resume point", () => {
		expect(decodeViewerFrame(encodeFrame({ v: 1, type: "hello" }))).toEqual({ v: 1, type: "hello" });
		expect(decodeViewerFrame(encodeFrame({ v: 1, type: "hello", since: 12 }))).toEqual({
			v: 1,
			type: "hello",
			since: 12,
		});
	});

	test("rejects malformed, unversioned and unknown frames", () => {
		expect(decodeViewerFrame("not json")).toBeUndefined();
		expect(decodeViewerFrame(JSON.stringify([1, 2]))).toBeUndefined();
		expect(decodeViewerFrame(JSON.stringify({ v: 2, type: "abort" }))).toBeUndefined();
		expect(decodeViewerFrame(JSON.stringify({ v: 1, type: "shutdown" }))).toBeUndefined();
		expect(decodeViewerFrame(JSON.stringify({ v: 1, type: "prompt" }))).toBeUndefined();
		expect(decodeViewerFrame(JSON.stringify({ v: 1, type: "hello", since: -1 }))).toBeUndefined();
	});

	test("rejects a prompt over the size cap", () => {
		const oversize = JSON.stringify({ v: 1, type: "prompt", text: "x".repeat(MAX_PROMPT_BYTES + 1) });
		expect(decodeViewerFrame(oversize)).toBeUndefined();
	});
});
