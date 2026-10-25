import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { InvalidParams } from "../../src/main/open-in.ts";
import { detectShells, type Pty, type TerminalEvent, Terminals } from "../../src/main/terminals.ts";

const roots: string[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	vi.useRealTimers();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function layout(files: string[] = []): string {
	const root = mkdtempSync(join(tmpdir(), "kc-terminals-"));
	roots.push(root);
	for (const file of files) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), "");
	}
	return root;
}

class FakePty implements Pty {
	readonly pid = 1;
	readonly written: string[] = [];
	readonly sizes: [number, number][] = [];
	killed = false;
	private data?: (data: string) => void;
	private exit?: (event: { exitCode: number }) => void;
	onData(listener: (data: string) => void) {
		this.data = listener;
	}
	onExit(listener: (event: { exitCode: number }) => void) {
		this.exit = listener;
	}
	write(data: string) {
		this.written.push(data);
	}
	resize(cols: number, rows: number) {
		this.sizes.push([cols, rows]);
	}
	kill() {
		this.killed = true;
	}
	emit(data: string) {
		this.data?.(data);
	}
	end(exitCode: number) {
		this.exit?.({ exitCode });
	}
}

function setup() {
	const root = layout(["bin/bash"]);
	const ptys: FakePty[] = [];
	const spawned: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }[] = [];
	const posted: [number, TerminalEvent][] = [];
	const terminals = new Terminals({
		platform: "linux",
		env: { SHELL: join(root, "bin/bash"), HOME: root },
		spawn: () => (command, args, options) => {
			spawned.push({ command, args, cwd: options.cwd, env: options.env });
			const pty = new FakePty();
			ptys.push(pty);
			return pty;
		},
		post: (windowId, event) => posted.push([windowId, event]),
	});
	return { root, terminals, ptys, spawned, posted };
}

test("a terminal runs the thread's shell in its folder, with the app's terminal environment", () => {
	const { root, terminals, spawned } = setup();
	const info = terminals.create({ threadId: "t1", cwd: root, cols: 80, rows: 24 }, 1);
	expect(info).toMatchObject({ threadId: "t1", cwd: root, shellId: "bash", shellName: "bash" });
	expect(info.exitCode).toBeUndefined();
	expect(spawned[0]).toMatchObject({ command: join(root, "bin/bash"), args: ["-l"], cwd: root });
	expect(spawned[0]!.env).toMatchObject({
		TERM: "xterm-256color",
		COLORTERM: "truecolor",
		KNIGHTCODE_DESKTOP: "1",
		HOME: root,
	});
	expect(() => terminals.create({ threadId: "t1", cwd: join(root, "missing"), cols: 80, rows: 24 }, 1)).toThrow(
		InvalidParams,
	);
	expect(() => terminals.create({ threadId: "t1", cwd: "relative", cols: 80, rows: 24 }, 1)).toThrow(InvalidParams);
	expect(terminals.list("t1")).toHaveLength(1);
	expect(terminals.list("t2")).toEqual([]);
});

test("output reaches attached windows batched every 16 ms; a window attaching later gets the scrollback first", () => {
	const { root, terminals, ptys, posted } = setup();
	const { terminalId } = terminals.create({ threadId: "t1", cwd: root, cols: 80, rows: 24 }, 1);
	ptys[0]!.emit("a");
	ptys[0]!.emit("b");
	expect(posted).toEqual([]);
	vi.advanceTimersByTime(16);
	expect(posted).toEqual([[1, { event: "terminal/data", terminalId, data: "ab" }]]);
	ptys[0]!.emit("c");
	// Attaching flushes what is pending to the windows already there, so the newcomer sees it once, in the scrollback.
	expect(terminals.attach(terminalId, 2)).toEqual({ scrollback: "abc" });
	expect(posted.at(-1)).toEqual([1, { event: "terminal/data", terminalId, data: "c" }]);
	ptys[0]!.emit("d");
	vi.advanceTimersByTime(16);
	expect(posted.slice(-2)).toEqual([
		[1, { event: "terminal/data", terminalId, data: "d" }],
		[2, { event: "terminal/data", terminalId, data: "d" }],
	]);
	// A closed or reloaded window stops getting output; the terminal keeps running.
	terminals.detachWindow(1);
	ptys[0]!.emit("e");
	vi.advanceTimersByTime(16);
	expect(posted.at(-1)).toEqual([2, { event: "terminal/data", terminalId, data: "e" }]);
	expect(ptys[0]!.killed).toBe(false);
});

test("the scrollback keeps the last 64 KiB, cut at a line start", () => {
	const { root, terminals, ptys } = setup();
	const { terminalId } = terminals.create({ threadId: "t1", cwd: root, cols: 80, rows: 24 }, 1);
	const line = `${"x".repeat(99)}\n`;
	for (let i = 0; i < 1000; i++) ptys[0]!.emit(line);
	const { scrollback } = terminals.attach(terminalId, 2);
	expect(scrollback.length).toBeLessThanOrEqual(64 * 1024);
	expect(scrollback.length).toBeGreaterThan(64 * 1024 - line.length);
	expect(scrollback.startsWith("x")).toBe(true);
	expect(scrollback.length % line.length).toBe(0);
});

test("input and resizes reach a running shell; an ended one reports its code and takes no more", () => {
	const { root, terminals, ptys, posted } = setup();
	const { terminalId } = terminals.create({ threadId: "t1", cwd: root, cols: 80, rows: 24 }, 1);
	terminals.write(terminalId, "ls\r");
	terminals.resize(terminalId, 100, 30);
	ptys[0]!.emit("bye");
	ptys[0]!.end(3);
	// Its last output comes before the exit.
	expect(posted).toEqual([
		[1, { event: "terminal/data", terminalId, data: "bye" }],
		[1, { event: "terminal/exit", terminalId, exitCode: 3 }],
	]);
	terminals.write(terminalId, "more\r");
	terminals.resize(terminalId, 10, 10);
	expect(ptys[0]!.written).toEqual(["ls\r"]);
	expect(ptys[0]!.sizes).toEqual([[100, 30]]);
	expect(terminals.list("t1")[0]!.exitCode).toBe(3);
	expect(terminals.attach(terminalId, 2)).toEqual({ scrollback: "bye", exitCode: 3 });
	expect(() => terminals.write("nope", "x")).toThrow(InvalidParams);
});

test("closing ends the shell; a thread's terminals end together, and every one on quit", () => {
	const { root, terminals, ptys } = setup();
	const a = terminals.create({ threadId: "t1", cwd: root, cols: 80, rows: 24 }, 1);
	terminals.create({ threadId: "t1", cwd: root, cols: 80, rows: 24 }, 1);
	terminals.create({ threadId: "t2", cwd: root, cols: 80, rows: 24 }, 1);
	terminals.kill(a.terminalId);
	expect(ptys.map((p) => p.killed)).toEqual([true, false, false]);
	expect(terminals.list("t1")).toHaveLength(1);
	terminals.killThread("t1");
	expect(ptys.map((p) => p.killed)).toEqual([true, true, false]);
	terminals.killAll();
	expect(ptys.map((p) => p.killed)).toEqual([true, true, true]);
	expect(terminals.list("t2")).toEqual([]);
});

test("Windows offers PowerShell 7, Windows PowerShell, Command Prompt, Git Bash and WSL when installed", () => {
	const root = layout([
		"apps/pwsh.exe",
		"Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
		"Windows/System32/cmd.exe",
		"Windows/System32/wsl.exe",
		"Program Files/Git/bin/bash.exe",
	]);
	const shells = detectShells("win32", {
		PATH: join(root, "apps"),
		PATHEXT: ".EXE",
		SystemRoot: join(root, "Windows"),
		ProgramFiles: join(root, "Program Files"),
	});
	expect(shells.map((s) => [s.id, s.name])).toEqual([
		["pwsh", "PowerShell"],
		["powershell", "Windows PowerShell"],
		["cmd", "Command Prompt"],
		["gitBash", "Git Bash"],
		["wsl", "WSL"],
	]);
	expect(shells.find((s) => s.id === "gitBash")).toMatchObject({
		command: join(root, "Program Files/Git/bin/bash.exe"),
		args: ["--login", "-i"],
	});
	// Without them, Command Prompt alone.
	expect(
		detectShells("win32", { SystemRoot: join(root, "none"), ComSpec: "C:\\Windows\\cmd.exe" }).map((s) => s.id),
	).toEqual(["cmd"]);
});
