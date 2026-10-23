import { setKeybindings, type TUI, TuiMainScreen } from "@knightcode/tui";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { defaultEditorTheme } from "../../tui/test/test-themes.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import {
	BACKGROUND_SHELL_MESSAGE_TYPE,
	type BackgroundShellMessageDetails,
	BackgroundShellManager,
} from "../src/core/background-shells.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { CustomMessage } from "../src/core/messages.ts";
import type { BashOperations, BashToolDetails } from "../src/core/tools/bash.ts";
import { createBashTool } from "../src/core/tools/bash.ts";
import { createShellRenderers } from "../src/core/tools/renderers/bash.ts";
import { renderBackgroundShellMessage } from "../src/modes/interactive/components/background-shell-message.ts";
import {
	BackgroundShellsIndicator,
	BackgroundTasksComponent,
} from "../src/modes/interactive/components/background-tasks.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import { initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

function fakeTui(rows = 40): TUI {
	return { requestRender: () => {}, terminal: { rows } } as unknown as TUI;
}

/** Operations whose processes run until the test exits or kills them. */
function controlledOperations() {
	const exits: Array<(code: number) => void> = [];
	const emits: Array<(text: string) => void> = [];
	const operations: BashOperations = {
		exec: (_command, _cwd, options) =>
			new Promise((resolve, reject) => {
				options.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				exits.push((exitCode) => resolve({ exitCode }));
				emits.push((text) => options.onData(Buffer.from(text)));
			}),
	};
	return { operations, exits, emits };
}

function screen(component: { render(width: number): string[] }, width = 100): string {
	return stripAnsi(component.render(width).join("\n"));
}

beforeAll(() => {
	initTheme("dark");
});

afterEach(() => {
	setKeybindings(new KeybindingsManager());
});

describe("/tasks view", () => {
	it("lists running commands first, opens live output, and stops the selected one", async () => {
		const manager = new BackgroundShellManager();
		const { operations, exits, emits } = controlledOperations();
		const bash = createBashTool(process.cwd(), { operations, backgroundShells: manager });
		await bash.execute("c1", { command: "npm test", run_in_background: true });
		exits[0]?.(1);
		await new Promise((resolve) => setTimeout(resolve, 50));
		await bash.execute("c2", { command: "npm run dev", run_in_background: true });
		emits[1]?.("\x1b[32mready\x1b[0m on http://localhost:3000\n");

		let closed = false;
		const view = new BackgroundTasksComponent(manager, fakeTui(), () => {
			closed = true;
		});
		try {
			const list = screen(view);
			expect(list).toContain("Background terminals");
			expect(list).toContain("1 running · 1 ended");
			expect(list.indexOf("npm run dev")).toBeLessThan(list.indexOf("npm test"));
			expect(list).toContain("ready on http://localhost:3000");
			expect(list).toContain("exit 1");

			view.handleInput("\r");
			const detail = screen(view);
			expect(detail).toContain("Background terminal");
			expect(detail).toContain("Output: ");
			expect(detail).toContain("ready on http://localhost:3000");
			expect(detail).toContain("x stop");

			view.handleInput("x");
			const [running] = manager.list().filter((shell) => shell.command === "npm run dev");
			expect(running?.stoppedBy).toBe("user");
			expect(screen(view)).toContain("stopping");

			view.handleInput("\x1b");
			expect(closed).toBe(false);
			expect(screen(view)).toContain("1 running · 1 ended");
			view.handleInput("\x1b");
			expect(closed).toBe(true);
		} finally {
			view.dispose();
			manager.dispose();
		}
	});

	it("shows a row above the footer only while commands run", async () => {
		const manager = new BackgroundShellManager();
		const { operations, exits } = controlledOperations();
		const bash = createBashTool(process.cwd(), { operations, backgroundShells: manager });
		const indicator = new BackgroundShellsIndicator(() => manager);
		expect(indicator.render(80)).toEqual([]);

		await bash.execute("c1", { command: "npm run dev", run_in_background: true });
		await bash.execute("c2", { command: "npm run watch", run_in_background: true });
		expect(screen(indicator, 80)).toBe("● 2 background terminals running · /tasks to view");

		exits[0]?.(0);
		await Promise.all(manager.list().map((shell) => manager.waitForExit(shell.id, 50)));
		expect(screen(indicator, 80)).toBe("● 1 background terminal running · /tasks to view");
		manager.dispose();
	});

	it("says how commands get there when there are none", () => {
		const view = new BackgroundTasksComponent(new BackgroundShellManager(), fakeTui(), () => {});
		try {
			expect(screen(view)).toContain("No background commands in this session");
		} finally {
			view.dispose();
		}
	});

	it("never renders a line wider than the terminal", async () => {
		const manager = new BackgroundShellManager();
		const { operations, emits } = controlledOperations();
		const bash = createBashTool(process.cwd(), { operations, backgroundShells: manager });
		await bash.execute("c1", { command: `echo ${"x".repeat(300)}`, run_in_background: true });
		emits[0]?.(`${"y".repeat(500)}\n`);
		const view = new BackgroundTasksComponent(manager, fakeTui(), () => {});
		try {
			for (const width of [20, 60]) {
				expect(view.render(width).every((line) => stripAnsi(line).length <= width)).toBe(true);
				view.handleInput("\r");
				expect(view.render(width).every((line) => stripAnsi(line).length <= width)).toBe(true);
				view.handleInput("\x1b");
			}
		} finally {
			view.dispose();
			manager.dispose();
		}
	});
});

describe("background shell transcript", () => {
	it("renders a notice per ended command with its status and output tail", () => {
		const message: CustomMessage<BackgroundShellMessageDetails> = {
			role: "custom",
			customType: BACKGROUND_SHELL_MESSAGE_TYPE,
			content: "",
			display: true,
			timestamp: Date.now(),
			details: {
				notices: [
					{
						id: "3fa9c21e",
						toolName: "bash",
						command: "npm test",
						status: "failed",
						exitCode: 1,
						summary: 'Background command "npm test" failed with exit code 1',
						outputPath: "/tmp/out.log",
						outputTail: "1 failing\nAssertionError",
					},
					{
						id: "8c7d1e00",
						toolName: "bash",
						command: "npm run build",
						status: "completed",
						exitCode: 0,
						summary: 'Background command "npm run build" completed (exit code 0)',
						outputPath: "/tmp/build.log",
						outputTail: "",
					},
				],
			},
		};
		const component = renderBackgroundShellMessage(message, { expanded: false, outputPad: 1 }, theme);
		const text = screen(component as { render(width: number): string[] });
		expect(text).toContain("Background(npm test)");
		expect(text).toContain("Failed with exit code 1 · ID 3fa9c21e");
		expect(text).toContain("AssertionError");
		expect(text).toContain("Background(npm run build)");
		expect(text).toContain("Completed · ID 8c7d1e00");
	});

	it("shows where a background launch went instead of its model-facing text", () => {
		const renderers = createShellRenderers("Bash");
		const details: BashToolDetails = { background: { taskId: "3fa9c21e", movedByUser: true } };
		const context = {
			args: { command: "npm run dev" },
			toolCallId: "t1",
			invalidate: () => {},
			lastComponent: undefined,
			state: {},
			cwd: process.cwd(),
			executionStarted: true,
			argsComplete: true,
			isPartial: false,
			expanded: false,
			showImages: false,
			isError: false,
			outputPad: 1,
			durationMs: undefined,
		};
		const component = renderers.renderResult?.(
			{ content: [{ type: "text", text: "The user moved this command to the background..." }], details },
			{ expanded: false, isPartial: false },
			theme,
			context,
		);
		const text = screen(component as { render(width: number): string[] });
		expect(text).toContain("Moved to the background · ID 3fa9c21e · /tasks to view");
		expect(text).not.toContain("The user moved");
	});
});

describe("Ctrl+B", () => {
	it("moves the cursor when no shell command can move to the background", () => {
		const keybindings = new KeybindingsManager();
		setKeybindings(keybindings);
		const editor = new CustomEditor(new TuiMainScreen(new VirtualTerminal()), defaultEditorTheme, keybindings);
		let promoted = 0;
		let canPromote = false;
		editor.onAction("app.tools.background", () => {
			if (!canPromote) return false;
			promoted++;
			return true;
		});
		editor.setText("ab");

		editor.handleInput("\x02"); // Ctrl+B
		editor.handleInput("X");
		expect(editor.getText()).toBe("aXb");
		expect(promoted).toBe(0);

		canPromote = true;
		editor.handleInput("\x02");
		expect(promoted).toBe(1);
		expect(editor.getText()).toBe("aXb");
	});
});
