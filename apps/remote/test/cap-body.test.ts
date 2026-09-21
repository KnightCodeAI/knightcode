import { describe, expect, it } from "vitest";
import { capBody } from "../src/bugs.ts";

const MB = 1024 * 1024;

function requestOf(chunks: number, chunkBytes: number): Request {
	let sent = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent === chunks) {
				controller.close();
				return;
			}
			sent++;
			controller.enqueue(new Uint8Array(chunkBytes));
		},
	});
	return new Request("https://remote.knightcode.dev/v1/bug-reports", { method: "POST", body });
}

async function drain(request: Request): Promise<{ read: number; failed: boolean }> {
	const reader = request.body!.getReader();
	let read = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return { read, failed: false };
			read += value.byteLength;
		}
	} catch {
		return { read, failed: true };
	}
}

describe("capBody", () => {
	// The point of the cap is that it fires while the body is still arriving. Asserting only
	// on the response status would not show that: the per-file and total checks after
	// `formData()` return 413 for an oversized body too, so a test that just posts a big
	// bundle passes whether or not the stream is capped at all.
	it("fails the stream partway instead of reading the whole body", async () => {
		const capped = capBody(requestOf(5, MB), 2 * MB);
		const { read, failed } = await drain(capped.request);
		expect(failed).toBe(true);
		expect(capped.exceeded()).toBe(true);
		// Two chunks got through; the third crossed the limit and errored the stream, so the
		// remaining two were never pulled.
		expect(read).toBe(2 * MB);
	});

	it("passes a body under the limit through untouched", async () => {
		const capped = capBody(requestOf(2, MB), 10 * MB);
		const { read, failed } = await drain(capped.request);
		expect(failed).toBe(false);
		expect(capped.exceeded()).toBe(false);
		expect(read).toBe(2 * MB);
	});

	it("reports a body exactly on the limit as acceptable", async () => {
		const capped = capBody(requestOf(2, MB), 2 * MB);
		const { failed } = await drain(capped.request);
		expect(failed).toBe(false);
		expect(capped.exceeded()).toBe(false);
	});
});
