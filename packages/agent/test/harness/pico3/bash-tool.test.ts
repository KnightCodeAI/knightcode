import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "../../../src/harness/context.ts";
import { bashTool } from "../../../src/harness/pico3/bash.ts";
import type { ToolApi } from "../../../src/harness/pico3/types.ts";

const decoder = new TextDecoder();

function collector(): { api: ToolApi; text: () => string } {
	const chunks: string[] = [];
	const api = {
		taskId: 1,
		conversationId: 1,
		callId: "call-1",
		stream: (chunk: string | Uint8Array) => chunks.push(typeof chunk === "string" ? chunk : decoder.decode(chunk)),
	} as unknown as ToolApi;
	return { api, text: () => chunks.join("") };
}

describe("pico3 bash tool", () => {
	const directories: string[] = [];
	afterAll(async () => {
		for (const directory of directories) await rm(directory, { recursive: true, force: true });
	});

	it("runs a command and reports its output and exit code", async () => {
		const { api, text } = collector();
		const result = await bashTool().execute({ command: "echo hello" }, api, BACKGROUND_CONTEXT);
		expect(result.isError).toBe(false);
		expect(text().trim()).toBe("hello");
		expect((result.details as { exitCode: number }).exitCode).toBe(0);
	});

	it("reports a failing command as an error", async () => {
		const { api } = collector();
		const result = await bashTool().execute({ command: "exit 3" }, api, BACKGROUND_CONTEXT);
		expect(result.isError).toBe(true);
		expect((result.details as { exitCode: number }).exitCode).toBe(3);
	});

	it("settles instead of hanging when the shell cannot be spawned", async () => {
		const directory = await mkdtemp(join(tmpdir(), "knightcode-pico3-bash-"));
		directories.push(directory);
		const missing = join(directory, "gone");
		const { api, text } = collector();
		// An unusable cwd makes spawn emit `error` and never `close`.
		const result = await bashTool().execute({ command: "echo hello", cwd: missing }, api, BACKGROUND_CONTEXT);
		expect(result.isError).toBe(true);
		expect((result.details as { exitCode: number | null }).exitCode).toBeNull();
		expect(text().length).toBeGreaterThan(0);
	});
});
