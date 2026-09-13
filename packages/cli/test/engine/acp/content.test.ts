import { pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { toPromptInput } from "../../../src/engine/acp/content.ts";

describe("prompt content", () => {
	test("joins text blocks and collects images", () => {
		const input = toPromptInput([
			{ type: "text", text: "look at this" },
			{ type: "image", data: "aGk=", mimeType: "image/png" },
			{ type: "text", text: "and that" },
		]);
		expect(input.text).toBe("look at this\nand that");
		expect(input.images).toEqual([{ type: "image", data: "aGk=", mimeType: "image/png" }]);
	});

	test("labels an embedded text resource with its path", () => {
		const path = process.platform === "win32" ? "C:\\proj\\a.ts" : "/proj/a.ts";
		const input = toPromptInput([
			{ type: "text", text: "fix" },
			{ type: "resource", resource: { uri: pathToFileURL(path).href, text: "const a = 1;", mimeType: "text/plain" } },
		]);
		expect(input.text).toBe(`fix\n[${path}]\nconst a = 1;`);
		expect(input.images).toBeUndefined();
	});

	test("turns a resource link into its path and keeps other URIs verbatim", () => {
		const path = process.platform === "win32" ? "C:\\proj\\b.ts" : "/proj/b.ts";
		const input = toPromptInput([
			{ type: "resource_link", uri: pathToFileURL(path).href, name: "b.ts" },
			{ type: "resource_link", uri: "https://example.com/doc", name: "doc" },
		]);
		expect(input.text).toBe(`${path}\nhttps://example.com/doc`);
	});

	test("drops audio and blob resources", () => {
		const input = toPromptInput([
			{ type: "audio", data: "AAAA", mimeType: "audio/wav" },
			{ type: "resource", resource: { uri: "file:///x.bin", blob: "AAAA", mimeType: "application/octet-stream" } },
			{ type: "text", text: "only this" },
		]);
		expect(input.text).toBe("only this");
	});
});
