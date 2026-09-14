import { describe, expect, test } from "vitest";
import { sanitiseEntries } from "../src/entries.ts";
import { TRUNCATION_MARKER } from "../src/protocol.ts";

function messageEntry(content: unknown): unknown {
	return {
		type: "message",
		id: "e1",
		parentId: null,
		timestamp: "2026-09-07T00:00:00.000Z",
		message: { role: "user", content },
	};
}

describe("entry sanitising", () => {
	test("replaces image blocks with a metadata placeholder", () => {
		const [entry] = sanitiseEntries([
			messageEntry([
				{ type: "text", text: "look" },
				{ type: "image", data: "AAAA", mimeType: "image/png" },
			]),
		]);
		const content = (entry as { message: { content: Array<{ type: string; text?: string }> } }).message.content;
		expect(content[0]).toEqual({ type: "text", text: "look" });
		expect(content[1].type).toBe("text");
		expect(content[1].text).toContain("image/png");
		expect(JSON.stringify(entry)).not.toContain("AAAA");
	});

	test("leaves text-only entries untouched", () => {
		const input = messageEntry([{ type: "text", text: "plain" }]);
		expect(sanitiseEntries([input])).toEqual([input]);
	});

	test("truncates an entry larger than the frame cap", () => {
		const [entry] = sanitiseEntries([messageEntry([{ type: "text", text: "x".repeat(2_000_000) }])]);
		expect(JSON.stringify(entry).length).toBeLessThan(2_000_000);
		expect(JSON.stringify(entry)).toContain(TRUNCATION_MARKER);
	});
});
