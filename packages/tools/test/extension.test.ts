import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@knightcodeai/cli";
import { ENV_AGENT_DIR } from "@knightcodeai/cli/config";
import { initTheme, theme } from "@knightcodeai/cli/modes/interactive/theme/theme";
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
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

type Panel = { render(width: number): string[] };

function fakeCtx(answers: Array<string | undefined>, mode?: "tui") {
	const notices: Array<{ message: string; type?: string }> = [];
	const prompts: Array<{ title: string; options: string[] }> = [];
	const panels: Panel[] = [];
	const ctx = {
		mode,
		ui: {
			select: async (title: string, options: string[]) => {
				prompts.push({ title, options });
				return answers.shift();
			},
			notify: (message: string, type?: string) => {
				notices.push({ message, type });
			},
			// Mounts the component like interactive mode does, then closes it as Esc would.
			custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: () => void) => Panel) => {
				let close = () => {};
				panels.push(await factory({}, theme, {}, () => close()));
				await new Promise<void>((resolve) => {
					close = resolve;
					close();
				});
			},
		},
	} as unknown as ExtensionCommandContext;
	return { ctx, notices, prompts, panels };
}

let dir: string;
beforeAll(() => initTheme("dark"));
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
		expect(registered).toEqual(["webfetch", "websearch"]);
		expect(TOOLS.map((e) => e.tool.name)).toEqual(["webfetch", "websearch", "scratchpad"]);
		expect(command()).toBeDefined();
	});

	test("session_start drops the tools that are off by default and keeps one persisted on", () => {
		writePersisted({ webfetch: { enabled: true } }, stateFile());
		const { pi, handlers, active } = fakePi(["read", "webfetch", "websearch"]);
		toolsExtension(pi);
		for (const handler of handlers.get("session_start") ?? []) handler();
		expect(active).toEqual(["read", "webfetch"]);
	});

	test("session_start re-adds a tool enabled for the session", async () => {
		const { pi, handlers, active } = fakePi(["read"]);
		toolsExtension(pi);
		await toolsCommand("websearch on", fakeCtx([]).ctx, pi);
		expect(active).toEqual(["read", "websearch"]);
		// A new session starts from the engine's default set; the override must be re-applied.
		active.splice(0, active.length, "read");
		for (const handler of handlers.get("session_start") ?? []) handler();
		expect(active).toEqual(["read", "websearch"]);
	});
});

describe("/tools", () => {
	test("argument fast path sets each mode and notifies", async () => {
		const { pi, active } = fakePi(["read"]);
		const { ctx, notices } = fakeCtx([]);
		await toolsCommand("websearch on", ctx, pi);
		expect(active).toEqual(["read", "websearch"]);
		expect(readPersisted()).toEqual({});
		expect(notices.at(-1)).toEqual({ message: "websearch: on (this session)", type: "info" });

		await toolsCommand("websearch always", ctx, pi);
		expect(active).toEqual(["read", "websearch"]);
		expect(readPersisted()).toEqual({ websearch: { enabled: true } });
		expect(notices.at(-1)?.message).toBe("websearch: on (default)");

		await toolsCommand("websearch off", ctx, pi);
		expect(active).toEqual(["read"]);
		expect(readPersisted()).toEqual({ websearch: { enabled: false } });
		expect(notices.at(-1)?.message).toBe("websearch: off");
	});

	test("in the TUI, picking a tool opens its settings panel instead of the mode list", async () => {
		const { pi } = fakePi(["read"]);
		const { ctx, prompts, panels, notices } = fakeCtx(["websearch — off"], "tui");
		await toolsCommand("", ctx, pi);
		expect(prompts.map((p) => p.title)).toEqual(["Tools"]);
		expect(panels).toHaveLength(1);
		const text = panels[0].render(80).join("\n");
		expect(text).toContain("websearch");
		expect(text).toContain("Brave API key");
		expect(notices).toEqual([]);
	});

	test("in the TUI, an explicit mode argument still skips the panel", async () => {
		const { pi, active } = fakePi(["read"]);
		const { ctx, panels } = fakeCtx([], "tui");
		await toolsCommand("webfetch on", ctx, pi);
		expect(panels).toEqual([]);
		expect(active).toEqual(["read", "webfetch"]);
	});

	test("outside the TUI, picking a tool asks for the mode", async () => {
		const { pi, active } = fakePi(["read"]);
		const { ctx, prompts, notices } = fakeCtx(["webfetch — off", "Enabled for this session"]);
		await toolsCommand("", ctx, pi);
		expect(prompts[0]).toEqual({
			title: "Tools",
			options: ["webfetch — off", "websearch — off", "scratchpad — off"],
		});
		expect(prompts[1]).toEqual({
			title: "webfetch",
			options: ["Disabled", "Enabled for this session", "Enabled by default"],
		});
		expect(active).toEqual(["read", "webfetch"]);
		expect(notices.at(-1)?.message).toBe("webfetch: on (this session)");
	});

	test("naming the tool skips the first prompt", async () => {
		const { pi } = fakePi(["webfetch", "websearch"]);
		const { ctx, prompts } = fakeCtx(["Enabled by default"]);
		await toolsCommand("webfetch", ctx, pi);
		expect(prompts.map((p) => p.title)).toEqual(["webfetch"]);
		expect(readPersisted()).toEqual({ webfetch: { enabled: true } });
	});

	test("cancelling either prompt changes nothing", async () => {
		const { pi, active } = fakePi(["webfetch", "websearch"]);
		const { ctx, notices } = fakeCtx([undefined]);
		await toolsCommand("", ctx, pi);
		const second = fakeCtx(["webfetch — off", undefined]);
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
			expect(notices).toEqual([
				{ message: "Usage: /tools [webfetch|websearch|scratchpad] [off|on|always]", type: "error" },
			]);
		}
	});

	test("completions offer tool names, then modes", () => {
		expect(toolsCompletions("")).toEqual([
			{ value: "webfetch", label: "webfetch" },
			{ value: "websearch", label: "websearch" },
			{ value: "scratchpad", label: "scratchpad" },
		]);
		expect(toolsCompletions("webs")).toEqual([{ value: "websearch", label: "websearch" }]);
		expect(toolsCompletions("websearch ")).toEqual([
			{ value: "websearch off", label: "off" },
			{ value: "websearch on", label: "on" },
			{ value: "websearch always", label: "always" },
		]);
		expect(toolsCompletions("websearch al")).toEqual([{ value: "websearch always", label: "always" }]);
	});

	test("a feature entry toggles without touching the active tool set", async () => {
		const { pi, active } = fakePi(["read"]);
		const { ctx, notices } = fakeCtx([]);
		await toolsCommand("scratchpad on", ctx, pi);
		expect(active).toEqual(["read"]);
		expect(notices.at(-1)).toEqual({ message: "scratchpad: on (this session)", type: "info" });
	});
});
