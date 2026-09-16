import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@knightcodeai/cli";
import { ENV_AGENT_DIR } from "@knightcodeai/cli/config";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { toolsCommand, toolsCompletions } from "../src/command.ts";
import toolsExtension from "../src/index.ts";
import { TOOLS } from "../src/registry.ts";
import { readPersisted, resetSessionOverrides, stateFile, writePersisted } from "../src/state.ts";

type Handler = () => unknown;
type Command = {
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	getArgumentCompletions?: (p: string) => unknown;
};

function fakePi(active: string[]) {
	const registered: string[] = [];
	const handlers = new Map<string, Handler[]>();
	let command: Command | undefined;
	const pi = {
		registerTool: (tool: { name: string }) => {
			registered.push(tool.name);
		},
		registerCommand: (_name: string, options: Command) => {
			command = options;
		},
		on: (event: string, handler: Handler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		getActiveTools: () => [...active],
		setActiveTools: (names: string[]) => {
			active.splice(0, active.length, ...names);
		},
	} as unknown as ExtensionAPI;
	return { pi, registered, handlers, command: () => command!, active };
}

function fakeCtx(answers: Array<string | undefined>) {
	const notices: Array<{ message: string; type?: string }> = [];
	const prompts: Array<{ title: string; options: string[] }> = [];
	const ctx = {
		ui: {
			select: async (title: string, options: string[]) => {
				prompts.push({ title, options });
				return answers.shift();
			},
			notify: (message: string, type?: string) => {
				notices.push({ message, type });
			},
		},
	} as unknown as ExtensionCommandContext;
	return { ctx, notices, prompts };
}

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kc-tools-ext-"));
	process.env[ENV_AGENT_DIR] = dir;
	resetSessionOverrides();
});
afterEach(() => {
	delete process.env[ENV_AGENT_DIR];
	rmSync(dir, { recursive: true, force: true });
	resetSessionOverrides();
});

describe("factory", () => {
	test("registers every registry tool and the tools command", () => {
		const { pi, registered, command } = fakePi([]);
		toolsExtension(pi);
		expect(registered).toEqual(TOOLS.map((e) => e.tool.name));
		expect(registered).toEqual(["webfetch", "websearch"]);
		expect(command()).toBeDefined();
	});

	test("session_start removes a persisted-off tool and leaves the rest", () => {
		writePersisted({ websearch: false }, stateFile());
		const { pi, handlers, active } = fakePi(["read", "webfetch", "websearch"]);
		toolsExtension(pi);
		for (const handler of handlers.get("session_start") ?? []) handler();
		expect(active).toEqual(["read", "webfetch"]);
	});

	test("session_start re-adds a tool enabled for the session", async () => {
		writePersisted({ websearch: false }, stateFile());
		const { pi, handlers, active } = fakePi(["read", "webfetch"]);
		toolsExtension(pi);
		await toolsCommand("websearch on", fakeCtx([]).ctx, pi);
		expect(active).toEqual(["read", "webfetch", "websearch"]);
		// A new session starts from the engine's default set; the override must be re-applied.
		active.splice(0, active.length, "read", "webfetch");
		for (const handler of handlers.get("session_start") ?? []) handler();
		expect(active).toEqual(["read", "webfetch", "websearch"]);
	});
});

describe("/tools", () => {
	test("argument fast path sets each mode and notifies", async () => {
		const { pi, active } = fakePi(["webfetch", "websearch"]);
		const { ctx, notices } = fakeCtx([]);
		await toolsCommand("websearch off", ctx, pi);
		expect(active).toEqual(["webfetch"]);
		expect(readPersisted()).toEqual({ websearch: false });
		expect(notices.at(-1)).toEqual({ message: "websearch: off", type: "info" });

		await toolsCommand("websearch on", ctx, pi);
		expect(active).toEqual(["webfetch", "websearch"]);
		expect(readPersisted()).toEqual({ websearch: false });
		expect(notices.at(-1)?.message).toBe("websearch: on (this session)");

		await toolsCommand("websearch always", ctx, pi);
		expect(readPersisted()).toEqual({ websearch: true });
		expect(notices.at(-1)?.message).toBe("websearch: on (default)");
	});

	test("interactive path asks for the tool, then the mode", async () => {
		const { pi, active } = fakePi(["webfetch", "websearch"]);
		const { ctx, prompts, notices } = fakeCtx(["webfetch — on (default)", "Disabled"]);
		await toolsCommand("", ctx, pi);
		expect(prompts[0]).toEqual({ title: "Tools", options: ["webfetch — on (default)", "websearch — on (default)"] });
		expect(prompts[1]).toEqual({
			title: "webfetch",
			options: ["Disabled", "Enabled for this session", "Enabled by default"],
		});
		expect(active).toEqual(["websearch"]);
		expect(notices.at(-1)?.message).toBe("webfetch: off");
	});

	test("naming the tool skips the first prompt", async () => {
		const { pi } = fakePi(["webfetch", "websearch"]);
		const { ctx, prompts } = fakeCtx(["Enabled by default"]);
		await toolsCommand("webfetch", ctx, pi);
		expect(prompts.map((p) => p.title)).toEqual(["webfetch"]);
		expect(readPersisted()).toEqual({ webfetch: true });
	});

	test("cancelling either prompt changes nothing", async () => {
		const { pi, active } = fakePi(["webfetch", "websearch"]);
		const { ctx, notices } = fakeCtx([undefined]);
		await toolsCommand("", ctx, pi);
		const second = fakeCtx(["webfetch — on (default)", undefined]);
		await toolsCommand("", second.ctx, pi);
		expect(active).toEqual(["webfetch", "websearch"]);
		expect(readPersisted()).toEqual({});
		expect(notices).toEqual([]);
		expect(second.notices).toEqual([]);
	});

	test("bad arguments notify with usage as an error", async () => {
		const { pi } = fakePi(["webfetch"]);
		for (const args of ["nope", "webfetch maybe", "webfetch on extra"]) {
			const { ctx, notices } = fakeCtx([]);
			await toolsCommand(args, ctx, pi);
			expect(notices).toEqual([{ message: "Usage: /tools [webfetch|websearch] [off|on|always]", type: "error" }]);
		}
	});

	test("completions offer tool names, then modes", () => {
		expect(toolsCompletions("")).toEqual([
			{ value: "webfetch", label: "webfetch" },
			{ value: "websearch", label: "websearch" },
		]);
		expect(toolsCompletions("webs")).toEqual([{ value: "websearch", label: "websearch" }]);
		expect(toolsCompletions("websearch ")).toEqual([
			{ value: "websearch off", label: "off" },
			{ value: "websearch on", label: "on" },
			{ value: "websearch always", label: "always" },
		]);
		expect(toolsCompletions("websearch al")).toEqual([{ value: "websearch always", label: "always" }]);
	});
});
