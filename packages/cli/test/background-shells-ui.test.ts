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
import { taskStopRenderers } from "../src/core/tools/renderers/task-stop.ts";
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

function renderContext(args: Record<string, unknown>, isError: boolean) {
	return {
		args,
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
		isError,
		outputPad: 1,
		durationMs: undefined,
	};
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
	async function twoShells() {
		const manager = new BackgroundShellManager();
		const { operations, exits, emits } = controlledOperations();
		const bash = createBashTool(process.cwd(), { operations, backgroundShells: manager });
		await bash.execute("c1", { command: "npm test", run_in_background: true });
		exits[0]?.(1);
		await Promise.all(manager.list().map((shell) => manager.waitForExit(shell.id, 1000)));
		await bash.execute("c2", { command: "npm run dev", run_in_background: true });
		emits[1]?.("\x1b[32mready\x1b[0m on http://localhost:3000\n");
		return { manager, bash, exits, emits };
	}

	it("lists running commands first, opens their details, and stops the selected one", async () => {
		const { manager } = await twoShells();
		let closed = false;
		const view = new BackgroundTasksComponent(manager, fakeTui(), () => {
			closed = true;
		});
		try {
			const list = screen(view);
			expect(list).toContain("Background tasks");
			expect(list).toContain("1 active shell");
			expect(list).toContain("❯ npm run dev (running)");
			expect(list).toContain("  npm test (error)");
			expect(list.indexOf("npm run dev")).toBeLessThan(list.indexOf("npm test"));
			expect(list).toContain("↑/↓ to select · Enter to view · x to stop · ←/Esc to close");

			// The cursor stops at the ends rather than wrapping.
			view.handleInput("\x1b[A");
			expect(screen(view)).toContain("❯ npm run dev");
			view.handleInput("\x1b[B");
			expect(screen(view)).toContain("❯ npm test");
			expect(screen(view)).not.toContain("x to stop");
			view.handleInput("\x1b[B");
			expect(screen(view)).toContain("❯ npm test");
			view.handleInput("\x1b[A");

			view.handleInput("\r");
			const detail = screen(view);
			expect(detail).toContain("Shell details");
			expect(detail).toMatch(/Status:\s+running/);
			expect(detail).toMatch(/Command:\s+npm run dev/);
			expect(detail).toContain("Output:");
			expect(detail).toContain("╭");
			expect(detail).toContain("│ ready on http://localhost:3000");
			expect(detail).toContain("Showing 1 line");
			expect(detail).toContain("← to go back · Esc/Enter/Space to close · x to stop");

			view.handleInput("x");
			const [running] = manager.list().filter((shell) => shell.command === "npm run dev");
			expect(running?.stoppedBy).toBe("user");
			expect(screen(view)).toMatch(/Status:\s+stopping/);

			view.handleInput("\x1b[D");
			expect(closed).toBe(false);
			expect(screen(view)).toContain("Background tasks");
			view.handleInput("\x1b");
			expect(closed).toBe(true);
		} finally {
			view.dispose();
			manager.dispose();
		}
	});

	it("opens on the details of the only command, and going back closes it", async () => {
		const manager = new BackgroundShellManager();
		const { operations } = controlledOperations();
		const bash = createBashTool(process.cwd(), { operations, backgroundShells: manager });
		await bash.execute("c1", { command: "npm run dev", run_in_background: true });
		let closed = false;
		const view = new BackgroundTasksComponent(manager, fakeTui(), () => {
			closed = true;
		});
		try {
			const detail = screen(view);
			expect(detail).toContain("Shell details");
			expect(detail).toContain("No output available");
			view.handleInput("\x1b[D");
			expect(closed).toBe(true);
		} finally {
			view.dispose();
			manager.dispose();
		}
	});

	it("shows the shells pill only while commands run, inverted when selected", async () => {
		const manager = new BackgroundShellManager();
		const { operations, exits } = controlledOperations();
		const bash = createBashTool(process.cwd(), { operations, backgroundShells: manager });
		const pill = new BackgroundShellsIndicator(() => manager);
		expect(pill.render(80)).toEqual([]);

		await bash.execute("c1", { command: "npm run dev", run_in_background: true });
		await bash.execute("c2", { command: "npm run watch", run_in_background: true });
		expect(screen(pill, 80)).toBe("2 shells · ↓ to view");
		pill.selected = true;
		expect(pill.render(80)[0]).toContain("\x1b[7m");
		expect(screen(pill, 80)).toBe("2 shells · Enter to view");
		pill.selected = false;

		exits[0]?.(0);
		expect(await manager.waitForExit(manager.list()[0]?.id as string, 5000)).toBe(true);
		expect(screen(pill, 80)).toBe("1 shell · ↓ to view");
		manager.dispose();
	});

	it("says so when nothing runs", () => {
		const view = new BackgroundTasksComponent(new BackgroundShellManager(), fakeTui(), () => {});
		try {
			expect(screen(view)).toContain("No tasks currently running");
			expect(screen(view)).toContain("←/Esc to close");
		} finally {
			view.dispose();
		}
	});

	it("fits a short terminal: fewer rows in the list, fewer output lines in the details", async () => {
		const manager = new BackgroundShellManager();
		const { operations, emits } = controlledOperations();
		const bash = createBashTool(process.cwd(), { operations, backgroundShells: manager });
		for (let i = 0; i < 6; i++) await bash.execute(`c${i}`, { command: `job ${i}`, run_in_background: true });
		emits[5]?.(`${Array.from({ length: 30 }, (_, i) => `out ${i}`).join("\n")}\n`);
		const view = new BackgroundTasksComponent(manager, fakeTui(16), () => {});
		try {
			const list = screen(view);
			expect(list.match(/\(running\)/g)).toHaveLength(4);
			expect(list).toContain("1 of 6");
			view.handleInput("\r");
			const detail = screen(view);
			expect(detail).toContain("out 29");
			expect(detail).toContain("Showing 3 lines");
		} finally {
			view.dispose();
			manager.dispose();
		}
	});

	it("never renders a line wider than the terminal", async () => {
		const { manager, bash, emits } = await twoShells();
		await bash.execute("c3", { command: `echo ${"x".repeat(300)}`, run_in_background: true });
		emits[2]?.(`${"y".repeat(500)}\n`);
		const view = new BackgroundTasksComponent(manager, fakeTui(), () => {});
		try {
			for (const width of [20, 60]) {
				expect(view.render(width).every((line) => stripAnsi(line).length <= width)).toBe(true);
				view.handleInput("\r");
				expect(view.render(width).every((line) => stripAnsi(line).length <= width)).toBe(true);
				view.handleInput("\x1b[D");
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

	it("keeps a long command's header on one line and says why a command failed without an exit code", () => {
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
						command: `curl ${"https://example.com/".repeat(10)}`,
						status: "failed",
						error: "Working directory does not exist: /nope",
						summary: 'Background command "curl" failed: Working directory does not exist: /nope',
						outputPath: "/tmp/out.log",
						outputTail: "",
					},
				],
			},
		};
		const component = renderBackgroundShellMessage(message, { expanded: false, outputPad: 1 }, theme);
		const lines = stripAnsi((component as { render(width: number): string[] }).render(60).join("\n")).split("\n");
		expect(lines[0]).toMatch(/Background\(curl https:\/\/example\.com.*…\)$/);
		expect(lines.every((line) => line.length <= 60)).toBe(true);
		expect(lines[1]).toContain("Failed: Working directory does not exist: /nope");
	});

	it("shows a failed task_stop's error instead of a summary", () => {
		const component = taskStopRenderers.renderResult?.(
			{ content: [{ type: "text", text: 'No background command has the ID "nope".' }], details: {} },
			{ expanded: false, isPartial: false },
			theme,
			renderContext({ task_id: "nope" }, true),
		);
		expect(screen(component as { render(width: number): string[] })).toContain(
			'No background command has the ID "nope".',
		);
	});

	it("shows where a background launch went instead of its model-facing text", () => {
		const renderers = createShellRenderers("Bash");
		const details: BashToolDetails = { background: { taskId: "3fa9c21e", movedByUser: true } };
		const component = renderers.renderResult?.(
			{ content: [{ type: "text", text: "The user moved this command to the background..." }], details },
			{ expanded: false, isPartial: false },
			theme,
			renderContext({ command: "npm run dev" }, false),
		);
		const text = screen(component as { render(width: number): string[] });
		expect(text).toContain("Running in the background (↓ to manage)");
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
