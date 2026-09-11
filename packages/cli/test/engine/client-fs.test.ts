import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { ExtensionContext } from "../../src/core/extensions/types.ts";
import type { ToolDef } from "../../src/core/tools/index.ts";
import { createClientFileOperations, createClientFileTools } from "../../src/engine/client-fs.ts";
import type { ClientReply, ClientRequest, ClientRequests } from "../../src/engine/client-requests.ts";

/** A client that answers from a script and records what it was asked. */
function scriptedRequests(
	answer: (request: ClientRequest) => ClientReply,
): ClientRequests & { asked: ClientRequest[] } {
	const asked: ClientRequest[] = [];
	return {
		asked,
		ask: async (_sessionId, request) => {
			asked.push(request);
			return answer(request);
		},
		reply: () => false,
		abortAll: () => {},
		size: () => 0,
	};
}

/** The definition's execute takes the loop's five arguments; the tests need only the first two. */
function run(tool: ToolDef, toolCallId: string, params: unknown): Promise<unknown> {
	return tool.execute(toolCallId, params, undefined, undefined, {} as ExtensionContext);
}

// The shortest header the image detector accepts (`utils/mime.ts` matches "GIF" alone).
const GIF = Buffer.from("GIF89a");
const both = { readTextFile: true, writeTextFile: true };

describe("client file operations", () => {
	const dir = join(tmpdir(), `knightcode-test-client-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`);

	beforeEach(() => mkdirSync(dir, { recursive: true }));
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	test("reads text through the client with the absolute path", async () => {
		const requests = scriptedRequests(() => ({ kind: "fs.read", content: "from the editor" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "a.txt");
		writeFileSync(file, "from disk");
		expect((await ops.read.readFile(file)).toString("utf-8")).toBe("from the editor");
		expect(requests.asked).toEqual([{ kind: "fs.read", toolCallId: undefined, path: file }]);
	});

	test("reads images from disk, never through the client", async () => {
		const requests = scriptedRequests(() => ({ kind: "error", code: "failed", message: "must not be asked" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "a.gif");
		writeFileSync(file, GIF);
		expect((await ops.read.readFile(file)).equals(GIF)).toBe(true);
		expect(requests.asked).toEqual([]);
	});

	test("falls back to disk when the client does not own the path", async () => {
		const requests = scriptedRequests(() => ({ kind: "error", code: "not_found", message: "outside the project" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "outside.txt");
		writeFileSync(file, "on disk");
		expect((await ops.edit.readFile(file)).toString("utf-8")).toBe("on disk");
		// The fallback makes the directories the tool no longer makes.
		const nested = join(dir, "new", "outside.txt");
		await ops.write.writeFile(nested, "rewritten");
		expect(readFileSync(nested, "utf-8")).toBe("rewritten");
	});

	test("a failed client read is the tool's error, not a silent disk read", async () => {
		const requests = scriptedRequests(() => ({ kind: "error", code: "failed", message: "editor said no" }));
		const ops = createClientFileOperations("s1", requests, both);
		const file = join(dir, "a.txt");
		writeFileSync(file, "on disk");
		await expect(ops.read.readFile(file)).rejects.toThrow("editor said no");
	});

	test("writes through the client and leaves disk alone, parent directories included", async () => {
		const requests = scriptedRequests(() => ({ kind: "fs.write" }));
		const [, , write] = createClientFileTools(dir, "s1", requests, both, { autoResizeImages: false });
		const file = join(dir, "a.txt");
		writeFileSync(file, "before");
		await run(write, "tc-a", { path: "a.txt", content: "after" });
		await run(write, "tc-b", { path: "new/dir/b.txt", content: "nested" });
		expect(readFileSync(file, "utf-8")).toBe("before");
		expect(existsSync(join(dir, "new"))).toBe(false);
		expect(requests.asked).toEqual([
			{ kind: "fs.write", toolCallId: "tc-a", path: file, content: "after" },
			{ kind: "fs.write", toolCallId: "tc-b", path: join(dir, "new", "dir", "b.txt"), content: "nested" },
		]);
	});

	test("uses disk when the client lacks the capability", async () => {
		const requests = scriptedRequests(() => ({ kind: "error", code: "failed", message: "must not be asked" }));
		const ops = createClientFileOperations("s1", requests, { readTextFile: false, writeTextFile: false });
		const file = join(dir, "a.txt");
		writeFileSync(file, "on disk");
		expect((await ops.read.readFile(file)).toString("utf-8")).toBe("on disk");
		await ops.write.writeFile(file, "changed");
		expect(readFileSync(file, "utf-8")).toBe("changed");
		expect(requests.asked).toEqual([]);
	});

	test("a tool's file requests carry its tool call id", async () => {
		const requests = scriptedRequests((request) =>
			request.kind === "fs.read" ? { kind: "fs.read", content: "hello world\n" } : { kind: "fs.write" },
		);
		const [read, edit, write] = createClientFileTools(dir, "s1", requests, both, { autoResizeImages: false });
		writeFileSync(join(dir, "a.txt"), "hello world\n");

		await run(read, "tc-read", { path: "a.txt" });
		await run(edit, "tc-edit", { path: "a.txt", edits: [{ oldText: "world", newText: "there" }] });
		await run(write, "tc-write", { path: "b.txt", content: "new" });

		expect(requests.asked.map((request) => [request.kind, request.toolCallId])).toEqual([
			["fs.read", "tc-read"],
			["fs.read", "tc-edit"],
			["fs.write", "tc-edit"],
			["fs.write", "tc-write"],
		]);
		const edited = requests.asked.find((request) => request.kind === "fs.write" && request.toolCallId === "tc-edit");
		expect(edited?.kind === "fs.write" ? edited.content : undefined).toBe("hello there\n");
	});

	test("the replacement tools keep the built-in names and prompt contributions", () => {
		const tools = createClientFileTools(
			dir,
			"s1",
			scriptedRequests(() => ({ kind: "fs.write" })),
			both,
			{
				autoResizeImages: true,
			},
		);
		expect(tools.map((tool) => tool.name)).toEqual(["read", "edit", "write"]);
		for (const tool of tools) {
			expect(typeof tool.promptSnippet).toBe("string");
			expect(tool.promptGuidelines?.length).toBeGreaterThan(0);
		}
	});
});
