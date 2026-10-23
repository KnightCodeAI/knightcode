/**
 * Terminals (desktop-shell.md section 9.7): shells in pseudo-terminals in main, as Codex runs them (node-pty), each
 * belonging to a thread. A terminal outlives the windows showing it: it keeps 64 KiB of its output, which a window
 * gets first when it attaches (after a reload, or a second window on the thread), and ends only when it is closed,
 * when its thread is archived or deleted, or when the app quits.
 */

import { randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { InvalidParams, onPath } from "./open-in.ts";

/** What main needs of a node-pty process. */
export interface Pty {
	readonly pid: number;
	onData(listener: (data: string) => void): unknown;
	onExit(listener: (event: { exitCode: number }) => void): unknown;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	kill(): void;
}

export type SpawnPty = (
	command: string,
	args: string[],
	options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
) => Pty;

export interface Shell {
	id: string;
	name: string;
	command: string;
	args: string[];
}

export interface TerminalInfo {
	terminalId: string;
	threadId: string;
	cwd: string;
	shellId: string;
	shellName: string;
	exitCode?: number;
}

export type TerminalEvent =
	| { event: "terminal/data"; terminalId: string; data: string }
	| { event: "terminal/exit"; terminalId: string; exitCode: number };

export interface TerminalDeps {
	platform: NodeJS.Platform;
	/** The login shell's environment (shell-env.ts), as the app server's tools get. */
	env: NodeJS.ProcessEnv;
	/** node-pty's spawn, loaded on the first terminal. */
	spawn: () => SpawnPty;
	post: (windowId: number, event: TerminalEvent) => void;
}

const SCROLLBACK = 64 * 1024;
const BATCH_MS = 16;

/**
 * The shells offered, the default first: on Windows PowerShell 7, Windows PowerShell, Command Prompt, then Git Bash
 * and WSL when installed; elsewhere `$SHELL`, bash and sh, as login shells.
 */
export function detectShells(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Shell[] {
	const shells: Shell[] = [];
	const add = (id: string, name: string, command: string | undefined, args: string[] = []) => {
		if (command && !shells.some((s) => s.id === id)) shells.push({ id, name, command, args });
	};
	if (platform === "win32") {
		const system32 = join(env.SystemRoot ?? "C:\\Windows", "System32");
		const at = (path: string) => (existsSync(path) ? path : undefined);
		add("pwsh", "PowerShell", onPath("pwsh", platform, env), ["-NoLogo"]);
		add("powershell", "Windows PowerShell", at(join(system32, "WindowsPowerShell", "v1.0", "powershell.exe")), [
			"-NoLogo",
		]);
		add("cmd", "Command Prompt", env.ComSpec ?? at(join(system32, "cmd.exe")));
		const git = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs")]
			.filter((root): root is string => Boolean(root))
			.map((root) => join(root, "Git", "bin", "bash.exe"))
			.find((path) => existsSync(path));
		add("gitBash", "Git Bash", git, ["--login", "-i"]);
		add("wsl", "WSL", at(join(system32, "wsl.exe")));
		return shells;
	}
	for (const path of [env.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"]) {
		if (!path || !isAbsolute(path) || !existsSync(path)) continue;
		add(basename(path), basename(path), path, ["-l"]);
	}
	return shells;
}

interface Terminal {
	info: TerminalInfo;
	pty: Pty;
	scrollback: string;
	pending: string;
	timer: ReturnType<typeof setTimeout> | undefined;
	windows: Set<number>;
}

export class Terminals {
	private readonly deps: TerminalDeps;
	private readonly terminals = new Map<string, Terminal>();
	private spawnPty: SpawnPty | undefined;

	constructor(deps: TerminalDeps) {
		this.deps = deps;
	}

	shells(): Shell[] {
		return detectShells(this.deps.platform, this.deps.env);
	}

	/** A new terminal for the thread, shown in the asking window; the shell asked for, else the first one found. */
	create(
		params: { threadId: string; cwd: string; shellId?: string; cols: number; rows: number },
		windowId: number,
	): TerminalInfo {
		if (!isAbsolute(params.cwd) || !statSync(params.cwd, { throwIfNoEntry: false })?.isDirectory())
			throw new InvalidParams(`not an existing folder: ${params.cwd}`);
		const shells = this.shells();
		const shell = shells.find((s) => s.id === params.shellId) ?? shells[0];
		if (!shell) throw new InvalidParams("no shell found");
		this.spawnPty ??= this.deps.spawn();
		const pty = this.spawnPty(shell.command, shell.args, {
			name: "xterm-256color",
			cols: params.cols,
			rows: params.rows,
			cwd: params.cwd,
			env: { ...this.deps.env, TERM: "xterm-256color", COLORTERM: "truecolor", KNIGHTCODE_DESKTOP: "1" },
		});
		const terminal: Terminal = {
			info: {
				terminalId: randomUUID(),
				threadId: params.threadId,
				cwd: params.cwd,
				shellId: shell.id,
				shellName: shell.name,
			},
			pty,
			scrollback: "",
			pending: "",
			timer: undefined,
			windows: new Set([windowId]),
		};
		this.terminals.set(terminal.info.terminalId, terminal);
		pty.onData((data) => this.output(terminal, data));
		pty.onExit(({ exitCode }) => {
			this.flush(terminal);
			terminal.info.exitCode = exitCode;
			for (const id of terminal.windows)
				this.deps.post(id, { event: "terminal/exit", terminalId: terminal.info.terminalId, exitCode });
		});
		return { ...terminal.info };
	}

	list(threadId: string): TerminalInfo[] {
		return [...this.terminals.values()].filter((t) => t.info.threadId === threadId).map((t) => ({ ...t.info }));
	}

	/** Show a terminal in another window, or the same one after a reload: its output so far, then what follows. */
	attach(terminalId: string, windowId: number): { scrollback: string; exitCode?: number } {
		const terminal = this.get(terminalId);
		this.flush(terminal);
		terminal.windows.add(windowId);
		return {
			scrollback: terminal.scrollback,
			...(terminal.info.exitCode !== undefined ? { exitCode: terminal.info.exitCode } : {}),
		};
	}

	write(terminalId: string, data: string): void {
		const terminal = this.get(terminalId);
		if (terminal.info.exitCode === undefined) terminal.pty.write(data);
	}

	resize(terminalId: string, cols: number, rows: number): void {
		const terminal = this.get(terminalId);
		if (terminal.info.exitCode === undefined) terminal.pty.resize(cols, rows);
	}

	/** Close a terminal: its shell ends and it is forgotten. */
	kill(terminalId: string): void {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) return;
		this.terminals.delete(terminalId);
		clearTimeout(terminal.timer);
		if (terminal.info.exitCode === undefined) terminal.pty.kill();
	}

	/** A window closed or reloaded: it stops getting output; its terminals keep running for their threads. */
	detachWindow(windowId: number): void {
		for (const terminal of this.terminals.values()) terminal.windows.delete(windowId);
	}

	killThread(threadId: string): void {
		for (const terminal of [...this.terminals.values()])
			if (terminal.info.threadId === threadId) this.kill(terminal.info.terminalId);
	}

	killAll(): void {
		for (const terminalId of [...this.terminals.keys()]) this.kill(terminalId);
	}

	private get(terminalId: string): Terminal {
		const terminal = this.terminals.get(terminalId);
		if (!terminal) throw new InvalidParams(`no terminal ${terminalId}`);
		return terminal;
	}

	/** Output reaches windows at most every 16 ms, in one message per terminal: a burst is not a message per chunk. */
	private output(terminal: Terminal, data: string): void {
		const all = terminal.scrollback + data;
		// Trimmed at a line start, so a replay never begins inside an escape sequence or a character.
		const cut = all.length - SCROLLBACK;
		terminal.scrollback = cut > 0 ? all.slice(all.indexOf("\n", cut) + 1 || cut) : all;
		terminal.pending += data;
		terminal.timer ??= setTimeout(() => this.flush(terminal), BATCH_MS);
	}

	private flush(terminal: Terminal): void {
		clearTimeout(terminal.timer);
		terminal.timer = undefined;
		if (!terminal.pending) return;
		const data = terminal.pending;
		terminal.pending = "";
		for (const id of terminal.windows)
			this.deps.post(id, { event: "terminal/data", terminalId: terminal.info.terminalId, data });
	}
}
