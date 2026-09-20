import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { ENV_AGENT_DIR } from "../src/config.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../src/core/extensions/types.ts";
import type { SessionEntry } from "../src/core/session-manager.ts";
import undoExtension from "../src/extensions/undo/index.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type Handler = (event: unknown, ctx: ExtensionCommandContext) => unknown;
type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };

function fakePi() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const pi = {
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		registerCommand: (name: string, options: Command) => commands.set(name, options),
	} as unknown as ExtensionAPI;
	undoExtension(pi);
	const fire = (event: string, payload: unknown, ctx: ExtensionCommandContext) => handlers.get(event)!(payload, ctx);
	return { fire, command: commands.get("undo")!, commands };
}

function user(id: string, parentId: string | null, text: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-09-20T10:00:00.000Z",
		message: { role: "user", content: text, timestamp: 0 },
	} as SessionEntry;
}

function assistant(id: string, parentId: string): SessionEntry {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-09-20T10:00:01.000Z",
		message: { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 0 },
	} as unknown as SessionEntry;
}

type Picker = { render(width: number): string[]; handleInput(data: string): void };

function fakeCtx(options: {
	cwd: string;
	entries: SessionEntry[];
	answers?: Array<string | undefined>;
	hasUI?: boolean;
	mode?: "tui" | "rpc";
	idle?: boolean;
}) {
	const prompts: Array<{ title: string; options: string[] }> = [];
	const notices: Array<{ message: string; type?: string }> = [];
	const navigated: string[] = [];
	const pickers: Picker[] = [];
	const answers = options.answers ?? [];
	const ctx = {
		cwd: options.cwd,
		hasUI: options.hasUI ?? true,
		mode: options.mode ?? "tui",
		isIdle: () => options.idle ?? true,
		sessionManager: {
			getSessionId: () => "s1",
			getBranch: (fromId?: string) => {
				const stop = fromId ?? options.entries.at(-1)?.id;
				const index = options.entries.findIndex((entry) => entry.id === stop);
				return options.entries.slice(0, index + 1);
			},
			getEntry: (id: string) => options.entries.find((entry) => entry.id === id),
		},
		ui: {
			select: async (title: string, choices: string[]) => {
				prompts.push({ title, options: choices });
				return answers.shift();
			},
			notify: (message: string, type?: string) => notices.push({ message, type }),
			custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: (v: unknown) => void) => Picker) => {
				return await new Promise((resolve) => {
					const keybindings = { matches: (data: string, id: string) => data === id };
					pickers.push(factory({}, {}, keybindings, resolve));
					// Drive the picker like a user: confirm the pre-selected row.
					pickers.at(-1)!.handleInput(answers.shift() ?? "tui.select.confirm");
				});
			},
		},
		navigateTree: async (id: string) => {
			navigated.push(id);
			return { cancelled: false };
		},
	} as unknown as ExtensionCommandContext;
	return { ctx, prompts, notices, navigated, pickers };
}

/** Old leaf → common ancestor, chronological, excluding the ancestor; as core builds it. */
function preparation(entries: SessionEntry[], targetId: string) {
	const targetIndex = entries.findIndex((entry) => entry.id === targetId);
	return {
		targetId,
		oldLeafId: entries.at(-1)!.id,
		commonAncestorId: targetId,
		entriesToSummarize: entries.slice(targetIndex + 1),
		userWantsSummary: false,
	};
}

let dir: string;
let cwd: string;
beforeAll(() => initTheme("dark"));
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kc-undo-ext-"));
	cwd = join(dir, "project");
	mkdirSync(cwd);
	process.env[ENV_AGENT_DIR] = dir;
	delete process.env.KNIGHTCODE_DISABLE_FILE_CHECKPOINTS;
});
afterEach(() => {
	delete process.env[ENV_AGENT_DIR];
	rmSync(dir, { recursive: true, force: true });
});

describe("file checkpoints", () => {
	test("an edit is backed up under the current user message and restored on rewind", async () => {
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx, prompts } = fakeCtx({ cwd, entries, answers: ["Conversation and 1 file"] });

		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);
		writeFileSync(join(cwd, "a.txt"), "edited");

		const result = await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		expect(result).toBeUndefined();
		expect(prompts[0].options).toEqual(["Conversation only", "Conversation and 1 file"]);
		await fire("session_tree", { newLeafId: null, oldLeafId: "a1" }, ctx);
		expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("original");
	});

	test("choosing conversation only leaves files alone", async () => {
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx } = fakeCtx({ cwd, entries, answers: ["Conversation only"] });

		await fire("tool_execution_start", { toolName: "write", args: { path: "a.txt", content: "x" } }, ctx);
		writeFileSync(join(cwd, "a.txt"), "edited");
		await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		await fire("session_tree", { newLeafId: null, oldLeafId: "a1" }, ctx);
		expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("edited");
	});

	test("escaping the prompt cancels the navigation", async () => {
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx } = fakeCtx({ cwd, entries, answers: [undefined] });

		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);
		const result = await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		expect(result).toEqual({ cancel: true });
	});

	test("nothing tracked after the target means no prompt", async () => {
		const entries = [user("u1", null, "hi"), assistant("a1", "u1"), user("u2", "a1", "edit"), assistant("a2", "u2")];
		const { fire } = fakePi();
		const { ctx, prompts } = fakeCtx({ cwd, entries });
		writeFileSync(join(cwd, "a.txt"), "original");
		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);

		// Rewinding to u2 abandons u2's edit; rewinding only the tail after u2 would not.
		const tailOnly = { ...preparation(entries, "a2"), targetId: "a2", commonAncestorId: "a2" };
		expect(await fire("session_before_tree", { preparation: tailOnly }, ctx)).toBeUndefined();
		expect(prompts).toHaveLength(0);
	});

	test("headless contexts never prompt or cancel", async () => {
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx, prompts } = fakeCtx({ cwd, entries, hasUI: false });

		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);
		expect(await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx)).toBeUndefined();
		expect(prompts).toHaveLength(0);
	});

	test("a restore choice is dropped when the navigation never completes", async () => {
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx } = fakeCtx({ cwd, entries, answers: ["Conversation and 1 file"] });

		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);
		writeFileSync(join(cwd, "a.txt"), "edited");
		await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		// Summarization aborted: no session_tree. The next navigation abandons nothing.
		const nothing = {
			targetId: "a1",
			oldLeafId: "a1",
			commonAncestorId: "a1",
			entriesToSummarize: [],
			userWantsSummary: false,
		};
		await fire("session_before_tree", { preparation: nothing }, ctx);
		await fire("session_tree", { newLeafId: "a1", oldLeafId: "a1" }, ctx);
		expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("edited");
	});

	test("shell tools flag the checkpoint and the prompt says so", async () => {
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx, prompts } = fakeCtx({ cwd, entries, answers: ["Conversation only"] });

		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);
		await fire("tool_execution_start", { toolName: "bash", args: { command: "rm x" } }, ctx);
		await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		expect(prompts[0].options[1]).toContain("shell");
	});

	test("malformed tool arguments are ignored", async () => {
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx, prompts } = fakeCtx({ cwd, entries });
		await fire("tool_execution_start", { toolName: "edit", args: "{not json" }, ctx);
		await fire("tool_execution_start", { toolName: "edit", args: { path: 42 } }, ctx);
		await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		expect(prompts).toHaveLength(0);
	});

	test("a failed write leaves no created-file record behind", async () => {
		const entries = [user("u1", null, "write a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx, prompts } = fakeCtx({ cwd, entries, answers: ["Conversation and 1 file"] });

		await fire(
			"tool_execution_start",
			{ toolCallId: "t1", toolName: "write", args: { path: "a.txt", content: "x" } },
			ctx,
		);
		await fire("tool_execution_end", { toolCallId: "t1", toolName: "write", result: {}, isError: true }, ctx);
		writeFileSync(join(cwd, "a.txt"), "made by a shell command");

		await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		await fire("session_tree", { newLeafId: null, oldLeafId: "a1" }, ctx);
		expect(prompts).toHaveLength(0);
		expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe("made by a shell command");
	});

	test("a shared new-file record survives while another call can still create the file", async () => {
		const entries = [user("u1", null, "write a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx } = fakeCtx({ cwd, entries, answers: ["Conversation and 1 file"] });
		const args = { path: "a.txt", content: "x" };

		await fire("tool_execution_start", { toolCallId: "t1", toolName: "write", args }, ctx);
		await fire("tool_execution_start", { toolCallId: "t2", toolName: "write", args }, ctx);
		await fire("tool_execution_end", { toolCallId: "t1", toolName: "write", result: {}, isError: true }, ctx);
		writeFileSync(join(cwd, "a.txt"), "x");
		await fire("tool_execution_end", { toolCallId: "t2", toolName: "write", result: {}, isError: false }, ctx);

		await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		await fire("session_tree", { newLeafId: null, oldLeafId: "a1" }, ctx);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
	});

	test("a range whose backups all failed still warns", async () => {
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx, prompts, notices } = fakeCtx({ cwd, entries });

		// A directory cannot be copied, so the backup fails.
		await fire("tool_execution_start", { toolCallId: "t1", toolName: "edit", args: { path: "." } }, ctx);
		expect(await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx)).toBeUndefined();
		await fire("session_tree", { newLeafId: null, oldLeafId: "a1" }, ctx);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(prompts).toHaveLength(0);
		expect(notices[0]).toEqual({ message: expect.stringContaining("backup"), type: "warning" });
	});

	test("a false-looking kill switch value keeps backups on", async () => {
		process.env.KNIGHTCODE_DISABLE_FILE_CHECKPOINTS = "0";
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx, prompts } = fakeCtx({ cwd, entries, answers: ["Conversation only"] });
		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);
		await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		expect(prompts).toHaveLength(1);
	});

	test("the kill switch disables backups", async () => {
		process.env.KNIGHTCODE_DISABLE_FILE_CHECKPOINTS = "1";
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx, prompts } = fakeCtx({ cwd, entries });
		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);
		await fire("session_before_tree", { preparation: preparation(entries, "u1") }, ctx);
		expect(prompts).toHaveLength(0);
		expect(existsSync(join(dir, "file-history"))).toBe(false);
	});

	test("forking copies the backups to the new session id", async () => {
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [user("u1", null, "edit a"), assistant("a1", "u1")];
		const { fire } = fakePi();
		const { ctx } = fakeCtx({ cwd, entries });
		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);

		const target = join(dir, "sessions", "2026-09-20T10-00-00-000Z_019972aa-0000-7000-8000-000000000002.jsonl");
		await fire("session_shutdown", { reason: "fork", targetSessionFile: target }, ctx);
		expect(existsSync(join(dir, "file-history", "019972aa-0000-7000-8000-000000000002", "index.json"))).toBe(true);
	});
});

describe("/undo", () => {
	test("refuses while the agent is busy", async () => {
		const { command } = fakePi();
		const { ctx, notices, navigated } = fakeCtx({ cwd, entries: [user("u1", null, "hi")], idle: false });
		await command.handler("", ctx);
		expect(notices[0].type).toBe("warning");
		expect(navigated).toEqual([]);
	});

	test("reports when there is nothing to undo", async () => {
		const { command } = fakePi();
		const { ctx, notices, navigated } = fakeCtx({ cwd, entries: [] });
		await command.handler("", ctx);
		expect(notices[0].message).toBe("Nothing to undo");
		expect(navigated).toEqual([]);
	});

	test("the picker lists user messages with their file counts and navigates to the choice", async () => {
		writeFileSync(join(cwd, "a.txt"), "original");
		const entries = [
			user("u1", null, "first prompt"),
			assistant("a1", "u1"),
			user("u2", "a1", "second prompt"),
			assistant("a2", "u2"),
		];
		const { fire, command } = fakePi();
		const { ctx, pickers, navigated } = fakeCtx({ cwd, entries, answers: ["tui.select.confirm"] });
		await fire("tool_execution_start", { toolName: "edit", args: { path: "a.txt" } }, ctx);

		await command.handler("", ctx);
		const text = pickers[0].render(80).join("\n");
		expect(text).toContain("first prompt");
		expect(text).toContain("second prompt");
		expect(text).toContain("1 file changed");
		// The most recent message is pre-selected, so confirming picks it.
		expect(navigated).toEqual(["u2"]);
	});

	test("escape in the picker navigates nowhere", async () => {
		const entries = [user("u1", null, "first prompt"), assistant("a1", "u1")];
		const { command } = fakePi();
		const { ctx, navigated } = fakeCtx({ cwd, entries, answers: ["tui.select.cancel"] });
		await command.handler("", ctx);
		expect(navigated).toEqual([]);
	});

	test("outside the TUI a plain select stands in for the picker", async () => {
		const entries = [
			user("u1", null, "first prompt"),
			assistant("a1", "u1"),
			user("u2", "a1", "second"),
			assistant("a2", "u2"),
		];
		const { command } = fakePi();
		const { ctx, prompts, navigated } = fakeCtx({ cwd, entries, mode: "rpc", answers: ["2. first prompt"] });
		await command.handler("", ctx);
		expect(prompts[0].options).toEqual(["1. second", "2. first prompt"]);
		expect(navigated).toEqual(["u1"]);
	});
});
