/**
 * "Open in" (desktop-shell.md section 9.9): the editors, terminals and IDEs a file or folder opens in. Each target has
 * its own lookup per platform, built from shared helpers (PATH, shims to
 * the program, install folders, Start menu shortcuts, app bundles, desktop entries), its own go-to-line syntax, and
 * the file manager and the system's default app as two fixed entries that main runs through Electron's shell.
 */

import { execFile, spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

export type TargetKind = "editor" | "terminal" | "fileManager" | "systemDefault";

export interface Launch {
	command: string;
	args: string[];
}

export interface OpenInTarget {
	id: string;
	name: string;
	kind: TargetKind;
	/** The program to run; empty for the two shell entries (fileManager, systemDefault). */
	command: string;
	/** Where its icon is read from (Electron's app.getFileIcon); the command when absent. */
	iconPath?: string;
	args(path: string, line?: number, column?: number): string[];
	/** When what runs depends on what is opened: a terminal given a file runs the user's editor in it. */
	launch?(path: string, line?: number, column?: number): Launch;
}

type Args = (path: string, line?: number, column?: number) => string[];

/** A directory as is, a file's folder: where a terminal starts. */
const folderOf = (path: string) => (existsSync(path) && statSync(path).isDirectory() ? path : dirname(path));

const pathKey = (env: NodeJS.ProcessEnv) => Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

const pathDirs = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv) =>
	(env[pathKey(env)] ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);

/** Names in each PATH directory (lowercased on Windows); a folder that cannot be read lists nothing. */
type PathIndex = Map<string, Set<string>>;

/**
 * Each PATH directory read once, without blocking main: detection looks up dozens of names, each across every
 * directory and PATHEXT extension, which as single lstat calls took 0.7 s on a 74-entry PATH.
 */
async function pathIndex(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<PathIndex> {
	const dirs = pathDirs(platform, env);
	const lists = await Promise.all(dirs.map((dir) => readdir(dir).catch((): string[] => [])));
	return new Map(
		dirs.map((dir, i) => [dir, new Set(platform === "win32" ? lists[i]!.map((n) => n.toLowerCase()) : lists[i])]),
	);
}

/** A command on PATH: with Windows' PATHEXT for a bare name. `index` skips the names a directory does not hold. */
export function onPath(
	name: string,
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	index?: PathIndex,
): string | undefined {
	const extensions =
		platform === "win32" && !extname(name) ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
	for (const dir of pathDirs(platform, env))
		for (const extension of extensions) {
			const file = `${name}${extension.toLowerCase()}`;
			if (index && !index.get(dir)?.has(platform === "win32" ? file.toLowerCase() : file)) continue;
			const candidate = join(dir, file);
			// lstat: an app execution alias (WindowsApps\wt.exe) is a reparse point that stat and existsSync refuse.
			const entry = lstatSync(candidate, { throwIfNoEntry: false });
			if (entry && !entry.isDirectory()) return candidate;
		}
	return undefined;
}

const exists = (path: string) => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

/** Newest first, the order scanned folders are tried in. */
const newestFirst = (names: string[]) => [...names].sort((a, b) => b.localeCompare(a));

function list(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

/** POSIX single quoting, a bare word left as is. */
function quote(word: string): string {
	return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** `$EDITOR`'s words: quotes and backslashes as a POSIX shell reads them; undefined when it cannot be read. */
export function shellWords(command: string): string[] | undefined {
	const words: string[] = [];
	let word: string | undefined;
	let quoteChar: string | undefined;
	for (let i = 0; i < command.length; i++) {
		const c = command[i]!;
		if (quoteChar) {
			if (c === quoteChar) quoteChar = undefined;
			else if (c === "\\" && quoteChar === '"' && i + 1 < command.length) word = (word ?? "") + command[++i];
			else word = (word ?? "") + c;
		} else if (c === "'" || c === '"') {
			quoteChar = c;
			word ??= "";
		} else if (c === "\\" && i + 1 < command.length) word = (word ?? "") + command[++i];
		else if (/\s/.test(c)) {
			if (word !== undefined) words.push(word);
			word = undefined;
		} else word = (word ?? "") + c;
	}
	if (quoteChar) return undefined;
	if (word !== undefined) words.push(word);
	return words;
}

/** The line flag each terminal editor reads. */
function editorLine(executable: string, line?: number, column?: number): string[] {
	if (!line) return [];
	const col = column ?? 1;
	if (executable === "nvim" || executable === "vim") return [`+call cursor(${line},${col})`];
	if (executable === "nano") return [`+${line},${col}`];
	if (executable === "less") return [`+${line}g`];
	return [];
}

/** `cd <folder> && <editor> <file>`, the editor's own line flag before a `--` it may carry. */
export function editorScript(editor: string, file: string, line?: number, column?: number): string {
	const folder = quote(dirname(file));
	const words = shellWords(editor);
	const program = words?.[0]?.trim();
	if (!words || !program) return `cd ${folder} && ${editor} ${quote(file)}`;
	const flags = editorLine(
		basename(program)
			.replace(/\.exe$/i, "")
			.toLowerCase(),
		line,
		column,
	);
	const dashes = words.indexOf("--");
	const all =
		dashes < 0 ? [...words, ...flags, file] : [...words.slice(0, dashes), ...flags, ...words.slice(dashes), file];
	return `cd ${folder} && ${all.map(quote).join(" ")}`;
}

/** The lookups over one machine, shared by every target. */
class Lookups {
	readonly home: string;
	/** %LOCALAPPDATA%\Programs, %ProgramFiles%, %ProgramFiles(x86)%. */
	readonly roots: string[];
	readonly localAppData: string;

	constructor(
		readonly platform: NodeJS.Platform,
		readonly env: NodeJS.ProcessEnv,
		private readonly index: PathIndex,
		private readonly shortcut: ((lnk: string) => string | undefined) | undefined,
	) {
		this.home = env.USERPROFILE ?? env.HOME ?? "";
		this.localAppData = env.LOCALAPPDATA ?? join(this.home, "AppData", "Local");
		this.roots = [join(this.localAppData, "Programs"), env.ProgramFiles, env["ProgramFiles(x86)"]].filter(
			(r): r is string => Boolean(r),
		);
	}

	which(name: string): string | undefined {
		return onPath(name, this.platform, this.env, this.index);
	}

	/** An existing path as is when it has an extension, else with `.cmd`, `.bat` or `.exe` (ao). */
	shim(path: string | undefined): string | undefined {
		if (!path || !exists(path)) return undefined;
		if (extname(path)) return path;
		for (const ext of [".cmd", ".bat", ".exe"]) if (exists(`${path}${ext}`)) return `${path}${ext}`;
		return path;
	}

	/** `exe` above the `bin` a shim is in, else beside it (oo). */
	beside(found: string, exe: string): string | undefined {
		const dir = dirname(found);
		if (basename(dir).toLowerCase() === "bin" && exists(join(dirname(dir), exe))) return join(dirname(dir), exe);
		return exists(join(dir, exe)) ? join(dir, exe) : undefined;
	}

	/** The first candidate under an install root (ro). */
	installed(candidates: string[][]): string | undefined {
		for (const root of this.roots)
			for (const parts of candidates) if (exists(join(root, ...parts))) return join(root, ...parts);
		return undefined;
	}

	/**
	 * A command shim (`.cmd`, `.bat`) stands for the program it starts: beside it, or up to three folders above its `bin`
	 * (Cursor's is `resources\app\bin`). A path is never handed to a
	 * shell: cmd.exe would read `&` or `%` in a file name as its own syntax.
	 */
	runnable(found: string | undefined, exe: string): string | undefined {
		if (!found || !/\.(cmd|bat)$/i.test(found)) return found;
		let dir = dirname(found);
		for (let up = 0; up < 4; up++, dir = dirname(dir)) if (exists(join(dir, exe))) return join(dir, exe);
		return undefined;
	}

	/** A PATH shim's own program, else the install folder's (co). */
	program(command: string, exe: string, installDir: string): string | undefined {
		const found = this.shim(this.which(command));
		if (found)
			return this.beside(found, exe) ?? (basename(found).toLowerCase() === exe.toLowerCase() ? found : undefined);
		return this.installed([[installDir, exe]]);
	}

	/** %LOCALAPPDATA%\Microsoft\WindowsApps\<name> (so). */
	windowsApp(name: string): string | undefined {
		return this.shim(join(this.localAppData, "Microsoft", "WindowsApps", name));
	}

	/** Every file in both Start menus, in search order; walked once per detection. */
	private shortcuts: string[] | undefined;

	/** A Start menu shortcut by name, in any folder of either Start menu (lo). */
	startMenu(names: string[]): string | undefined {
		if (!this.shortcuts) {
			const files: string[] = [];
			const walk = (dir: string) => {
				for (const name of list(dir)) {
					const path = join(dir, name);
					const entry = lstatSync(path, { throwIfNoEntry: false });
					if (entry?.isFile()) files.push(path);
					else if (entry?.isDirectory()) walk(path);
				}
			};
			for (const root of [this.env.APPDATA, this.env.ProgramData])
				if (root) walk(join(root, "Microsoft", "Windows", "Start Menu", "Programs"));
			this.shortcuts = files;
		}
		const wanted = new Set(names.map((n) => n.toLowerCase()));
		return this.shortcuts.find((path) => wanted.has(basename(path).toLowerCase()));
	}

	/** A shortcut's target, read by Electron's shell.readShortcutLink. */
	target(lnk: string | undefined): string | undefined {
		return lnk ? this.shim(this.shortcut?.(lnk)) : undefined;
	}

	/** /Applications paths, each also under ~/Applications (zX). */
	fixed(paths: string[]): string | undefined {
		for (const path of paths) {
			const candidates = path.startsWith("/Applications/")
				? [path, join(this.home, "Applications", path.slice("/Applications/".length))]
				: [path];
			const found = candidates.find(exists);
			if (found) return found;
		}
		return undefined;
	}

	/** An app bundle whose name starts with `name`, in /Applications or ~/Applications (VX). */
	appNamed(name: string, bin?: string): string | undefined {
		const prefix = name.toLowerCase();
		for (const dir of ["/Applications", join(this.home, "Applications")])
			for (const entry of list(dir)) {
				const lower = entry.toLowerCase();
				if (!lower.startsWith(prefix) || !lower.endsWith(".app")) continue;
				// With `bin`, the program inside it (BX).
				const path = bin ? join(dir, entry, "Contents", "MacOS", bin) : join(dir, entry);
				if (exists(path)) return path;
			}
		return undefined;
	}

	/** A desktop entry by name in the XDG data folders, only when `gio` can launch it. */
	desktopEntry(names: string[]): string | undefined {
		if (!this.which("gio")) return undefined;
		const xdg = this.env.XDG_DATA_HOME;
		const dataHome = xdg && isAbsolute(xdg) ? xdg : join(this.home, ".local", "share");
		const dataDirs = this.env.XDG_DATA_DIRS
			? this.env.XDG_DATA_DIRS.split(":").filter(isAbsolute)
			: ["/usr/local/share", "/usr/share"];
		const dirs = [
			dataHome,
			join(this.home, ".local", "share", "flatpak", "exports", "share"),
			...dataDirs,
			"/var/lib/flatpak/exports/share",
			"/var/lib/snapd/desktop",
		].map((dir) => join(dir, "applications"));
		for (const name of names) {
			const found = dirs.map((dir) => join(dir, name)).find(exists);
			if (found) return found;
		}
		return undefined;
	}

	/** A command on PATH, else its desktop entry (JX). */
	linux(commands: string[], entries: string[]): string | undefined {
		for (const command of commands) {
			const found = this.which(command);
			if (found) return found;
		}
		return this.desktopEntry(entries);
	}

	/** The terminal editor: $VISUAL, $EDITOR, else the first of nvim, vim, nano and less on PATH. */
	terminalEditor(): string | undefined {
		const visual = this.env.VISUAL?.trim() || this.env.EDITOR?.trim();
		if (visual) return visual;
		for (const name of ["nvim", "vim", "nano", "less"]) {
			const found = this.which(name);
			if (found) return found;
		}
		return undefined;
	}

	/** JetBrains Toolbox's apps on macOS, by target: the newest bundle of each. */
	toolbox(): Map<string, string> {
		const found = new Map<string, string>();
		const apps = join(this.home, "Library", "Application Support", "JetBrains", "Toolbox", "apps");
		for (const app of newestFirst(list(apps)))
			for (const channel of newestFirst(list(join(apps, app))))
				for (const build of newestFirst(list(join(apps, app, channel)))) {
					const dir = join(apps, app, channel, build);
					for (const bundle of newestFirst(list(dir))) {
						const lower = bundle.toLowerCase();
						if (!lower.endsWith(".app")) continue;
						for (const ide of JETBRAINS) {
							if (found.has(ide.id) || !ide.bundlePrefixes.some((p) => lower.startsWith(p))) continue;
							const program = join(dir, bundle, "Contents", "MacOS", ide.exe);
							if (exists(program)) found.set(ide.id, program);
						}
					}
				}
		return found;
	}
}

/** What a lookup found: the program and how it is given a path. */
interface Found {
	command: string;
	args: Args;
	iconPath?: string;
	launch?: OpenInTarget["launch"];
}

type Detect = (l: Lookups) => Found | undefined | Promise<Found | undefined>;

interface Def {
	id: string;
	name: string | Partial<Record<NodeJS.Platform, string>>;
	kind: TargetKind;
	win32?: Detect;
	darwin?: Detect;
	linux?: Detect;
}

// Each editor family's go-to-line syntax.
const vscodeArgs =
	(platform: NodeJS.Platform): Args =>
	(p, l, c) =>
		l ? ["--goto", `${p}:${l}:${c ?? 1}`] : platform === "win32" ? [p] : ["--goto", p];
const colon: Args = (p, l, c) => [l ? `${p}:${l}:${c ?? 1}` : p];
const jetbrainsArgs: Args = (p, l, c) => (l ? ["--line", String(l), "--column", String(c ?? 1), p] : [p]);
const emacsArgs: Args = (p, l, c) => (l ? [`+${l}:${c ?? 1}`, p] : [p]);
const plain: Args = (p) => [p];

/** A Linux find: a command runs as is; a desktop entry through `gio launch`, which takes the path alone. */
function linuxFound(l: Lookups, found: string | undefined, args: Args): Found | undefined {
	if (!found) return undefined;
	if (extname(found) !== ".desktop") return { command: found, args };
	const gio = l.which("gio");
	return gio ? { command: gio, args: (p) => ["launch", found, p] } : undefined;
}

/** An editor with one lookup per platform and the VS Code family's arguments. */
function editor(
	id: string,
	name: string,
	lookups: { darwin?: string[]; win32?: (l: Lookups) => string | undefined; linux?: [string[], string[]] },
): Def {
	return {
		id,
		name,
		kind: "editor",
		...(lookups.darwin ? { darwin: (l) => found(l.fixed(lookups.darwin!), vscodeArgs("darwin")) } : {}),
		...(lookups.win32 ? { win32: (l) => found(lookups.win32!(l), vscodeArgs("win32")) } : {}),
		...(lookups.linux ? { linux: (l) => linuxFound(l, l.linux(...lookups.linux!), vscodeArgs("linux")) } : {}),
	};
}

const found = (command: string | undefined, args: Args, iconPath?: string): Found | undefined =>
	command ? { command, args, ...(iconPath ? { iconPath } : {}) } : undefined;

/** An app opened through Launch Services, `open -a <name>` (BBEdit, Emacs and TextMate on macOS). */
const launchServices =
	(name: string, args: Args = plain): Detect =>
	(l) => {
		const app = l.appNamed(name) ?? l.fixed([`/Applications/${name}.app`]);
		return app
			? { command: "/usr/bin/open", args: (p, line, column) => ["-a", name, ...args(p, line, column)], iconPath: app }
			: undefined;
	};

/** TextMate's line: a txmt:// URL. */
const textmateArgs: Args = (p, l, c) => {
	if (!l) return [p];
	const url = new URL("txmt://open/");
	url.searchParams.set("url", pathToFileURL(p).toString());
	url.searchParams.set("line", String(l));
	url.searchParams.set("column", String(c ?? 1));
	return [url.toString()];
};

/** The terminals' script runners on macOS, for a file opened with the user's editor in it. */
function macTerminalScript(id: string, script: string, shell: string): Launch | undefined {
	const escaped = script.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
	if (id === "kitty") return { command: "/usr/bin/open", args: ["-na", "kitty.app", "--args", shell, "-lc", script] };
	if (id === "ghostty")
		return { command: "/usr/bin/open", args: ["-na", "Ghostty.app", "--args", "-e", shell, "-lc", script] };
	if (id === "terminal")
		return { command: "/usr/bin/osascript", args: ["-e", `tell application "Terminal" to do script "${escaped}"`] };
	if (id === "iterm2")
		return {
			command: "/usr/bin/osascript",
			args: [
				"-e",
				[
					'tell application "iTerm"',
					"create window with default profile",
					`tell current session of current window to write text "${escaped}"`,
					"end tell",
				].join("\n"),
			],
		};
	return undefined;
}

/** A macOS terminal app: `open -a` at the folder, or a file in the user's editor where it can run one. */
const macTerminal =
	(id: string, appPaths: string[], appName: string): Detect =>
	(l) => {
		const app = l.fixed(appPaths);
		if (!app) return undefined;
		const args: Args = (p) => ["-a", appName, folderOf(p)];
		return {
			command: "/usr/bin/open",
			args,
			iconPath: app,
			launch: (p, line, column) => {
				const editorCommand = l.terminalEditor();
				const isFile = existsSync(p) && !statSync(p).isDirectory();
				const script = editorCommand && isFile ? editorScript(editorCommand, p, line, column) : undefined;
				const shell = l.env.SHELL?.trim() || "/bin/zsh";
				return (
					(script ? macTerminalScript(id, script, shell) : undefined) ?? { command: "/usr/bin/open", args: args(p) }
				);
			},
		};
	};

/** A Linux terminal's starting-folder flags. */
function linuxTerminalArgs(command: string, path: string, shell: string): string[] {
	const folder = folderOf(path);
	switch (basename(command)) {
		case "kitty":
			return ["--directory", folder];
		case "ghostty":
			return [`--working-directory=${folder}`];
		case "konsole":
			return ["--workdir", folder];
		case "x-terminal-emulator":
		case "zutty":
			return ["-e", shell, "-lc", `cd ${quote(folder)} && exec ${quote(shell)}`];
		default:
			return ["--working-directory", folder];
	}
}

/** A file opened in the user's editor inside a Linux terminal, each terminal's way of running it. */
function linuxTerminalScript(command: string, args: string[], script: string, shell: string): string[] {
	switch (basename(command)) {
		case "kitty":
			return [...args, shell, "-lc", script];
		case "alacritty":
		case "ghostty":
		case "kgx":
		case "konsole":
		case "tilix":
			return [...args, "-e", shell, "-lc", script];
		case "mate-terminal":
		case "xfce4-terminal":
			return [...args, "--execute", shell, "-lc", script];
		case "x-terminal-emulator":
		case "zutty":
			return ["-e", shell, "-lc", script];
		default:
			return [...args, "--", shell, "-lc", script];
	}
}

/** A Linux terminal: the first of `commands` on PATH. */
const linuxTerminal =
	(commands: string[]): Detect =>
	(l) => {
		const command = commands.map((name) => l.which(name)).find(Boolean);
		if (!command) return undefined;
		const shell = l.env.SHELL?.trim() || "/bin/sh";
		const args: Args = (p) => linuxTerminalArgs(command, p, shell);
		return {
			command,
			args,
			launch: (p, line, column) => {
				const editorCommand = l.terminalEditor();
				const isFile = existsSync(p) && !statSync(p).isDirectory();
				if (!editorCommand || !isFile) return { command, args: args(p) };
				return {
					command,
					args: linuxTerminalScript(command, args(p), editorScript(editorCommand, p, line, column), shell),
				};
			},
		};
	};

/** Windows Terminal's `-d`, its `;` command separator escaped in every argument. */
const windowsTerminalArgs = (p: string, ...rest: string[]) =>
	["-d", folderOf(p), ...rest].map((a) => a.replaceAll(";", "\\;"));

/** Windows Terminal: on PATH or as WindowsApps' alias, else a Start menu shortcut's target. */
function windowsTerminal(l: Lookups): string | undefined {
	return l.which("wt.exe") ?? l.windowsApp("wt.exe") ?? l.target(l.startMenu(["Terminal.lnk", "Windows Terminal.lnk"]));
}

/** The WSL distribution a \\wsl$ or \\wsl.localhost path is in. */
const wslDistro = (path: string) => /^\\\\wsl(?:\$|\.localhost)\\([^\\]+)/i.exec(path)?.[1];

interface JetBrainsIde {
	id: string;
	name: string;
	exe: string;
	bundlePrefixes: string[];
	windows?: { commands: string[]; dirPrefixes: string[]; exes: string[]; fallback?: string[][] };
	desktop: string[];
}

/** JetBrains' IDEs: each one's program, bundle names and Windows lookup. */
const JETBRAINS: JetBrainsIde[] = [
	{
		id: "androidStudio",
		name: "Android Studio",
		exe: "studio",
		bundlePrefixes: ["android studio"],
		windows: {
			commands: ["studio64.exe", "studio.exe", "studio"],
			dirPrefixes: ["android studio"],
			exes: ["studio64.exe", "studio.exe"],
			fallback: [
				["Android", "Android Studio", "bin", "studio64.exe"],
				["Android", "Android Studio", "bin", "studio.exe"],
			],
		},
		desktop: [
			"jetbrains-studio.desktop",
			"android-studio.desktop",
			"com.google.AndroidStudio.desktop",
			"android-studio_android-studio.desktop",
		],
	},
	{
		id: "intellij",
		name: "IntelliJ IDEA",
		exe: "idea",
		bundlePrefixes: ["intellij idea"],
		windows: {
			commands: ["idea64.exe", "idea.exe", "idea"],
			dirPrefixes: ["intellij idea", "idea"],
			exes: ["idea64.exe", "idea.exe"],
		},
		desktop: [
			"jetbrains-idea.desktop",
			"jetbrains-idea-ce.desktop",
			"com.jetbrains.IntelliJ-IDEA-Ultimate.desktop",
			"com.jetbrains.IntelliJ-IDEA-Community.desktop",
			"intellij-idea_intellij-idea.desktop",
			"intellij-idea-ultimate_intellij-idea-ultimate.desktop",
			"intellij-idea-community_intellij-idea-community.desktop",
		],
	},
	{
		id: "rider",
		name: "Rider",
		exe: "rider",
		bundlePrefixes: ["rider"],
		windows: {
			commands: ["rider64.exe", "rider.exe", "rider"],
			dirPrefixes: ["rider"],
			exes: ["rider64.exe", "rider.exe"],
		},
		desktop: ["jetbrains-rider.desktop", "com.jetbrains.Rider.desktop", "rider_rider.desktop"],
	},
	{
		id: "goland",
		name: "GoLand",
		exe: "goland",
		bundlePrefixes: ["goland"],
		desktop: ["jetbrains-goland.desktop", "com.jetbrains.GoLand.desktop", "goland_goland.desktop"],
	},
	{
		id: "rustrover",
		name: "RustRover",
		exe: "rustrover",
		bundlePrefixes: ["rustrover"],
		desktop: ["jetbrains-rustrover.desktop", "com.jetbrains.RustRover.desktop", "rustrover_rustrover.desktop"],
	},
	{
		id: "pycharm",
		name: "PyCharm",
		exe: "pycharm",
		bundlePrefixes: ["pycharm"],
		windows: {
			commands: ["pycharm64.exe", "pycharm.exe", "pycharm"],
			dirPrefixes: ["pycharm"],
			exes: ["pycharm64.exe", "pycharm.exe"],
		},
		desktop: [
			"jetbrains-pycharm.desktop",
			"jetbrains-pycharm-ce.desktop",
			"com.jetbrains.PyCharm-Professional.desktop",
			"com.jetbrains.PyCharm-Community.desktop",
			"pycharm_pycharm.desktop",
			"pycharm-professional_pycharm-professional.desktop",
			"pycharm-community_pycharm-community.desktop",
		],
	},
	{
		id: "webstorm",
		name: "WebStorm",
		exe: "webstorm",
		bundlePrefixes: ["webstorm"],
		windows: {
			commands: ["webstorm64.exe", "webstorm.exe", "webstorm"],
			dirPrefixes: ["webstorm"],
			exes: ["webstorm64.exe", "webstorm.exe"],
		},
		desktop: ["jetbrains-webstorm.desktop", "com.jetbrains.WebStorm.desktop", "webstorm_webstorm.desktop"],
	},
	{
		id: "phpstorm",
		name: "PhpStorm",
		exe: "phpstorm",
		bundlePrefixes: ["phpstorm"],
		windows: {
			commands: ["phpstorm64.exe", "phpstorm.exe", "phpstorm"],
			dirPrefixes: ["phpstorm"],
			exes: ["phpstorm64.exe", "phpstorm.exe"],
		},
		desktop: ["jetbrains-phpstorm.desktop", "com.jetbrains.PhpStorm.desktop", "phpstorm_phpstorm.desktop"],
	},
];

/** A JetBrains IDE. */
function jetbrains(ide: JetBrainsIde): Def {
	const windows = ide.windows;
	return {
		id: ide.id,
		name: ide.name,
		kind: "editor",
		darwin: (l) =>
			found(
				l.fixed([`/Applications/${ide.name}.app/Contents/MacOS/${ide.exe}`]) ??
					l.appNamed(ide.name, ide.exe) ??
					l.toolbox().get(ide.id),
				jetbrainsArgs,
			),
		...(windows
			? {
					win32: (l: Lookups) => {
						for (const command of windows.commands) {
							const program = l.shim(l.which(command));
							if (program) return found(program, jetbrainsArgs);
						}
						const prefixes = windows.dirPrefixes.map((p) => p.toLowerCase());
						for (const root of [l.env.ProgramFiles, l.env["ProgramFiles(x86)"]]) {
							if (!root) continue;
							const dir = join(root, "JetBrains");
							for (const name of newestFirst(list(dir))) {
								if (!prefixes.some((p) => name.toLowerCase().startsWith(p))) continue;
								const program = windows.exes.map((exe) => join(dir, name, "bin", exe)).find(exists);
								if (program) return found(program, jetbrainsArgs);
							}
						}
						return found(windows.fallback ? l.installed(windows.fallback) : undefined, jetbrainsArgs);
					},
				}
			: {}),
		linux: (l) => {
			const commands = [ide.exe, `${ide.exe}.sh`, ...(ide.id === "intellij" ? ["intellij-idea"] : [])];
			for (const command of commands) {
				const program = l.which(command);
				if (program) return found(program, jetbrainsArgs);
			}
			const script = join(l.home, ".local", "share", "JetBrains", "Toolbox", "scripts", ide.exe);
			return linuxFound(l, exists(script) ? script : l.desktopEntry(ide.desktop), jetbrainsArgs);
		},
	};
}

/** A program's standard output, or undefined when it fails or outlives `timeout`; off main's thread. */
function output(command: string, args: string[], env: NodeJS.ProcessEnv, timeout: number): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(command, args, { encoding: "utf8", env, timeout, windowsHide: true }, (error, stdout) =>
			resolve(error ? undefined : stdout),
		);
	});
}

/** Xcode: `xed` from xcode-select, else Xcode's own, else the app through Launch Services. */
async function xcode(l: Lookups): Promise<Found | undefined> {
	const app = l.appNamed("Xcode") ?? l.fixed(["/Applications/Xcode.app"]);
	let xed: string | undefined;
	const dir = (await output("/usr/bin/xcode-select", ["-p"], l.env, 1000))?.trim();
	if (dir && exists(join(dir, "usr", "bin", "xed"))) xed = join(dir, "usr", "bin", "xed");
	if (!xed && app && exists(join(app, "Contents", "Developer", "usr", "bin", "xed")))
		xed = join(app, "Contents", "Developer", "usr", "bin", "xed");
	if (xed)
		return {
			command: xed,
			...(app ? { iconPath: app } : {}),
			args: (p, line) => {
				const project = xcodeProject(p);
				return [...(project ? ["--project", project] : []), ...(line ? ["--line", String(line)] : []), p];
			},
		};
	return app ? { command: "/usr/bin/open", iconPath: app, args: (p) => ["-a", app, p] } : undefined;
}

/** The workspace or project above a path, else the folder of the nearest Package.swift. */
function xcodeProject(path: string): string | undefined {
	let dir = folderOf(path);
	let swiftPackage: string | undefined;
	for (;;) {
		const names = list(dir);
		const workspace = names.find((n) => n.endsWith(".xcworkspace"));
		if (workspace) return join(dir, workspace);
		const project = names.find((n) => n.endsWith(".xcodeproj"));
		if (project) return join(dir, project);
		if (!swiftPackage && names.includes("Package.swift")) swiftPackage = dir;
		const parent = dirname(dir);
		if (parent === dir) return swiftPackage;
		dir = parent;
	}
}

/** Every target, in the menu's order. */
const DEFS: Def[] = [
	editor("vscode", "VS Code", {
		darwin: [
			"/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
			"/Applications/Code.app/Contents/Resources/app/bin/code",
		],
		win32: (l) => l.program("code", "Code.exe", "Microsoft VS Code"),
		linux: [
			["code", "code-oss"],
			[
				"code.desktop",
				"code-oss.desktop",
				"com.visualstudio.code.desktop",
				"com.visualstudio.code-oss.desktop",
				"code_code.desktop",
			],
		],
	}),
	editor("vscodeInsiders", "VS Code Insiders", {
		darwin: [
			"/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code",
			"/Applications/Code - Insiders.app/Contents/Resources/app/bin/code",
		],
		win32: (l) => l.program("code-insiders", "Code - Insiders.exe", "Microsoft VS Code Insiders"),
		linux: [
			["code-insiders"],
			["code-insiders.desktop", "com.visualstudio.code.insiders.desktop", "code-insiders_code-insiders.desktop"],
		],
	}),
	{
		id: "visualStudio",
		name: "Visual Studio",
		kind: "editor",
		// devenv on PATH, then each year and edition, then vswhere's answer.
		win32: async (l) => {
			const onPathProgram = l.shim(l.which("devenv.exe") ?? l.which("devenv"));
			if (onPathProgram) return found(onPathProgram, plain);
			const editions = ["2022", "2019", "2017"].flatMap((year) =>
				["Community", "Professional", "Enterprise", "Preview", "BuildTools"].map((edition) => [
					"Microsoft Visual Studio",
					year,
					edition,
					"Common7",
					"IDE",
					"devenv.exe",
				]),
			);
			return found(l.installed(editions) ?? (await vswhere(l)), plain);
		},
	},
	{
		id: "cursor",
		name: "Cursor",
		kind: "editor",
		darwin: (l) =>
			found(
				l.fixed([
					"/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
					"/Applications/Cursor Preview.app/Contents/Resources/app/bin/cursor",
					"/Applications/Cursor Nightly.app/Contents/Resources/app/bin/cursor",
				]) ??
					(l.appNamed("Cursor")
						? join(l.appNamed("Cursor")!, "Contents", "Resources", "app", "bin", "cursor")
						: undefined),
				vscodeArgs("darwin"),
			),
		// The shim three folders down (resources\app\bin) stands for Cursor.exe.
		win32: (l) => {
			const shim = l.shim(l.which("cursor"));
			if (shim) {
				if (basename(shim).toLowerCase() === "cursor.exe") return found(shim, vscodeArgs("win32"));
				const bin = dirname(shim);
				const app = dirname(bin);
				const resources = dirname(app);
				if (
					basename(bin).toLowerCase() === "bin" &&
					basename(app).toLowerCase() === "app" &&
					basename(resources).toLowerCase() === "resources" &&
					exists(join(dirname(resources), "Cursor.exe"))
				)
					return found(join(dirname(resources), "Cursor.exe"), vscodeArgs("win32"));
			}
			return found(l.installed([["Cursor", "Cursor.exe"]]), vscodeArgs("win32"));
		},
		linux: (l) => linuxFound(l, l.linux(["cursor"], ["cursor.desktop"]), vscodeArgs("linux")),
	},
	editor("devin", "Devin Desktop", { darwin: ["/Applications/Devin.app/Contents/Resources/app/bin/devin-desktop"] }),
	{ id: "bbedit", name: "BBEdit", kind: "editor", darwin: launchServices("BBEdit") },
	{
		id: "emacs",
		name: "Emacs",
		kind: "editor",
		darwin: launchServices("Emacs"),
		linux: (l) =>
			linuxFound(
				l,
				l.linux(["emacs", "emacsclient"], ["emacs.desktop", "emacsclient.desktop", "org.gnu.emacs.desktop"]),
				emacsArgs,
			),
	},
	{
		id: "sublimeText",
		name: "Sublime Text",
		kind: "editor",
		darwin: (l) => {
			const subl = l.which("subl");
			if (subl) return found(subl, colon);
			const app = l.appNamed("Sublime Text");
			const inApp = app ? join(app, "Contents", "SharedSupport", "bin", "subl") : undefined;
			return found(
				(inApp && exists(inApp) ? inApp : undefined) ??
					l.fixed(["/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl"]),
				colon,
			);
		},
		win32: (l) => {
			const shim = l.shim(l.which("subl.exe") ?? l.which("subl"));
			if (shim) return found(l.beside(shim, "sublime_text.exe") ?? shim, colon);
			return found(
				l.installed([
					["Sublime Text", "sublime_text.exe"],
					["Sublime Text", "subl.exe"],
				]),
				colon,
			);
		},
		linux: (l) =>
			linuxFound(
				l,
				l.linux(
					["subl", "sublime_text"],
					["sublime_text.desktop", "com.sublimetext.three.desktop", "sublime-text_subl.desktop"],
				),
				colon,
			),
	},
	{
		id: "zed",
		name: "Zed",
		kind: "editor",
		darwin: (l) =>
			found(
				l.which("zed") ??
					l.fixed([
						"/Applications/Zed.app/Contents/MacOS/zed",
						"/Applications/Zed Preview.app/Contents/MacOS/zed",
						"/Applications/Zed Nightly.app/Contents/MacOS/zed",
					]) ??
					l.appNamed("Zed", "zed"),
				colon,
			),
		win32: (l) => {
			const shim = l.shim(l.which("zed.exe") ?? l.which("zed"));
			return found(shim ?? l.installed([["Zed", "Zed.exe"]]), colon);
		},
		linux: (l) =>
			linuxFound(l, l.linux(["zed"], ["dev.zed.Zed.desktop", "dev.zed.Zed-Preview.desktop", "zed.desktop"]), colon),
	},
	editor("windsurf", "Windsurf", {
		darwin: ["/Applications/Windsurf.app/Contents/Resources/app/bin/windsurf"],
		linux: [["windsurf"], ["windsurf.desktop"]],
	}),
	editor("antigravity", "Antigravity", {
		darwin: ["/Applications/Antigravity.app/Contents/Resources/app/bin/antigravity"],
		// The command on PATH, else its install folders; a shim stands for the Antigravity.exe above it.
		win32: (l) =>
			l.runnable(
				l.shim(l.which("antigravity.exe") ?? l.which("antigravity.cmd") ?? l.which("antigravity")) ??
					l.installed([
						["Antigravity", "Antigravity.exe"],
						["antigravity", "Antigravity.exe"],
						["Antigravity", "bin", "antigravity.cmd"],
						["antigravity", "bin", "antigravity.cmd"],
						["Antigravity", "resources", "app", "bin", "antigravity.cmd"],
						["antigravity", "resources", "app", "bin", "antigravity.cmd"],
					]),
				"Antigravity.exe",
			),
		linux: [["antigravity-ide"], ["antigravity-ide.desktop"]],
	}),
	{
		id: "githubDesktop",
		name: "GitHub Desktop",
		kind: "editor",
		// Its installer puts it in %LOCALAPPDATA% itself, not under Programs.
		win32: (l) => {
			const args: Args = (p) => [folderOf(p)];
			const shim = l.shim(l.which("github.exe") ?? l.which("github"));
			if (shim) return found(l.beside(shim, "GitHubDesktop.exe") ?? shim, args);
			const local = [
				join(l.localAppData, "GitHubDesktop", "GitHubDesktop.exe"),
				join(l.localAppData, "GitHub Desktop", "GitHubDesktop.exe"),
			].find(exists);
			return found(
				local ??
					l.installed([
						["GitHub Desktop", "GitHubDesktop.exe"],
						["GitHubDesktop", "GitHubDesktop.exe"],
					]),
				args,
			);
		},
	},
	{
		id: "systemDefault",
		name: "Default app",
		kind: "systemDefault",
		darwin: () => ({ command: "", args: () => [] }),
		win32: () => ({ command: "", args: () => [] }),
		linux: () => ({ command: "", args: () => [] }),
	},
	{
		id: "fileManager",
		name: { darwin: "Finder", win32: "File Explorer", linux: "File Manager" },
		kind: "fileManager",
		darwin: () => ({ command: "", args: () => [] }),
		win32: () => ({ command: "", args: () => [] }),
		linux: () => ({ command: "", args: () => [] }),
	},
	{
		id: "terminal",
		name: "Terminal",
		kind: "terminal",
		darwin: macTerminal("terminal", ["/System/Applications/Utilities/Terminal.app"], "Terminal"),
		win32: (l) => found(windowsTerminal(l), (p) => windowsTerminalArgs(p)),
		linux: linuxTerminal([
			"kgx",
			"gnome-terminal",
			"konsole",
			"xfce4-terminal",
			"mate-terminal",
			"tilix",
			"alacritty",
			"x-terminal-emulator",
		]),
	},
	{
		id: "gitBash",
		name: "Git Bash",
		kind: "terminal",
		// Its icon is its Start menu shortcut's.
		win32: (l) => {
			const shim = l.shim(l.which("git-bash.exe") ?? l.which("git-bash"));
			const program =
				(shim ? (l.beside(shim, "git-bash.exe") ?? shim) : undefined) ??
				l.installed([
					["Git", "git-bash.exe"],
					["Git", "bin", "bash.exe"],
				]);
			const icon = l.startMenu(["Git Bash.lnk"]) ?? l.installed([["Git", "git-bash.exe"]]) ?? program;
			return found(program, (p) => [`--cd=${folderOf(p)}`], icon);
		},
	},
	{
		id: "cmder",
		name: "Cmder",
		kind: "terminal",
		// %CMDER_ROOT%, PATH, then its Start menu shortcut's target.
		win32: (l) => {
			const root = l.env.CMDER_ROOT?.trim();
			const fromRoot = root && exists(join(root, "Cmder.exe")) ? join(root, "Cmder.exe") : undefined;
			const program =
				fromRoot ?? l.shim(l.which("cmder.exe") ?? l.which("cmder")) ?? l.target(l.startMenu(["Cmder.lnk"]));
			return found(program, (p) => ["/START", folderOf(p)]);
		},
	},
	{
		id: "wsl",
		name: "WSL",
		kind: "terminal",
		// WSL in Windows Terminal at the folder (Windows' own path, which WSL mounts), in the path's distribution when it
		// is one's. Its icon is its Start menu shortcut's penguin.
		win32: (l) => {
			if (!existsSync(join(l.env.SystemRoot ?? "C:\\Windows", "System32", "wsl.exe"))) return undefined;
			const wt = windowsTerminal(l);
			if (!wt) return undefined;
			const icon = l.startMenu(["WSL.lnk"]) ?? l.windowsApp("wsl.exe");
			return found(
				wt,
				(p) => {
					const distro = wslDistro(folderOf(p));
					return windowsTerminalArgs(p, "wsl.exe", ...(distro ? ["-d", distro] : []));
				},
				icon,
			);
		},
	},
	{
		id: "iterm2",
		name: "iTerm2",
		kind: "terminal",
		darwin: macTerminal("iterm2", ["/Applications/iTerm.app", "/Applications/iTerm2.app"], "iTerm"),
	},
	{
		id: "kitty",
		name: "Kitty",
		kind: "terminal",
		darwin: macTerminal("kitty", ["/Applications/kitty.app"], "kitty"),
		linux: linuxTerminal(["kitty"]),
	},
	{
		id: "ghostty",
		name: "Ghostty",
		kind: "terminal",
		darwin: macTerminal("ghostty", ["/Applications/Ghostty.app"], "Ghostty"),
		linux: linuxTerminal(["ghostty"]),
	},
	{ id: "warp", name: "Warp", kind: "terminal", darwin: macTerminal("warp", ["/Applications/Warp.app"], "Warp") },
	{ id: "xcode", name: "Xcode", kind: "editor", darwin: xcode },
	...JETBRAINS.map(jetbrains),
	{ id: "textmate", name: "TextMate", kind: "editor", darwin: launchServices("TextMate", textmateArgs) },
];

/** vswhere's newest devenv.exe, Visual Studio's own locator; about 250 ms, so not on main's thread. */
async function vswhere(l: Lookups): Promise<string | undefined> {
	const locator = [l.env["ProgramFiles(x86)"], l.env.ProgramFiles]
		.filter((r): r is string => Boolean(r))
		.map((root) => join(root, "Microsoft Visual Studio", "Installer", "vswhere.exe"))
		.find(exists);
	if (!locator) return undefined;
	const args = ["-products", "*", "-all", "-find", "**\\Common7\\IDE\\devenv.exe", "-utf8", "-nologo", "-prerelease"];
	return (await output(locator, args, l.env, 10_000))
		?.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0 && exists(line));
}

/**
 * The app bundle a macOS command is in, whose icon is the target's: ".app" followed by a separator or the end, not a
 * home folder such as /Users/anna.applegate. A command found on the PATH is followed through its link first
 * (/usr/local/bin/code is in Visual Studio Code.app).
 */
export function appBundle(command: string): string | undefined {
	const within = (path: string) => /^.+?\.app(?=[\\/]|$)/.exec(path)?.[0];
	try {
		return within(command) ?? within(realpathSync(command));
	} catch {
		return undefined;
	}
}

export interface DetectOptions {
	/** A Windows shortcut's target (Electron's shell.readShortcutLink); without it, shortcuts are not followed. */
	readShortcut?: (lnk: string) => string | undefined;
}

/** Every target this machine has, in the menu's order, the file manager and the default app among them. */
export async function detectTargets(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	options: DetectOptions = {},
): Promise<OpenInTarget[]> {
	const lookups = new Lookups(platform, env, await pathIndex(platform, env), options.readShortcut);
	// All at once: the few that run a program (vswhere, xcode-select) wait on it without holding the rest.
	const hits = await Promise.all(
		DEFS.map(async (def) => {
			try {
				return await def[platform as "win32" | "darwin" | "linux"]?.(lookups);
			} catch {
				// A path this user cannot probe (EACCES, a file where a folder should be) leaves out one target only.
				return undefined;
			}
		}),
	);
	const targets: OpenInTarget[] = [];
	for (const [i, def] of DEFS.entries()) {
		const hit = hits[i];
		if (!hit) continue;
		// Never a shim on Windows: spawning one needs cmd.exe, which parses the path (see Lookups.runnable).
		if (platform === "win32" && /\.(cmd|bat)$/i.test(hit.command)) continue;
		const name = typeof def.name === "string" ? def.name : (def.name[platform] ?? def.id);
		const bundle = platform === "darwin" && !hit.iconPath ? appBundle(hit.command) : undefined;
		targets.push({ id: def.id, name, kind: def.kind, ...hit, ...(bundle ? { iconPath: bundle } : {}) });
	}
	return targets;
}

/**
 * Windows' own icon extraction, one PowerShell for every path: Electron's getFileIcon hands back the generic program
 * icon for many programs, shortcuts and .ico files. A shortcut reads its icon location; Windows Terminal's app alias,
 * its package's program. Paths arrive on stdin, one per line; a JSON object of base64 PNGs leaves on stdout.
 */
const WINDOWS_ICONS = `
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
$out = @{}
foreach ($line in ([Console]::In.ReadToEnd() -split [char]10)) {
	$path = $line.Trim()
	if (-not $path) { continue }
	try {
		$file = $path
		if ($file -like '*.lnk') {
			$link = (New-Object -ComObject WScript.Shell).CreateShortcut($file)
			$icon = ($link.IconLocation -split ',')[0]
			$file = if ($icon) { [Environment]::ExpandEnvironmentVariables($icon) } else { $link.TargetPath }
		} elseif ($file -like '*\\WindowsApps\\wt.exe') {
			$package = Get-AppxPackage -Name 'Microsoft.WindowsTerminal*' | Select-Object -First 1
			if ($package) { $file = Join-Path $package.InstallLocation 'WindowsTerminal.exe' }
		}
		$bitmap = [System.Drawing.Icon]::ExtractAssociatedIcon($file).ToBitmap()
		$stream = New-Object System.IO.MemoryStream
		$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
		$out[$path] = [Convert]::ToBase64String($stream.ToArray())
	} catch {}
}
$out | ConvertTo-Json -Compress
`;

/** Data URLs of the programs' icons on Windows; rejects when PowerShell fails or takes longer than 15 seconds. */
export function windowsIcons(paths: string[], env: NodeJS.ProcessEnv): Promise<Map<string, string>> {
	return new Promise((resolve, reject) => {
		const powershell = join(env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
		const script = Buffer.from(WINDOWS_ICONS, "utf16le").toString("base64");
		const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", script], {
			stdio: ["pipe", "pipe", "ignore"],
			windowsHide: true,
		});
		const timer = setTimeout(() => child.kill(), 15_000);
		let out = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => (out += chunk));
		child.stdin.on("error", () => {});
		child.once("error", reject);
		child.once("close", (code) => {
			clearTimeout(timer);
			try {
				if (code !== 0) throw new Error(`icon extraction exited with ${code}`);
				const icons = JSON.parse(out) as Record<string, string>;
				resolve(new Map(Object.entries(icons).map(([path, png]) => [path, `data:image/png;base64,${png}`])));
			} catch (error) {
				reject(error);
			}
		});
		child.stdin.end(paths.join("\n"));
	});
}

/** A host request main refuses for what it asked, not for something that failed. */
export class InvalidParams extends Error {
	readonly code = "invalidParams";
}

export interface OpenInDeps {
	platform: NodeJS.Platform;
	env: NodeJS.ProcessEnv;
	/** Data URLs of the programs' icons, read in one go; a path whose icon cannot be read is left out. */
	icons: (paths: string[]) => Promise<Map<string, string>>;
	/** The file manager: a file shown selected in its folder, a folder opened. */
	reveal: (path: string) => Promise<void>;
	/** The system's default app for the file. */
	openDefault: (path: string) => Promise<void>;
	launch?: (command: string, args: string[], env: NodeJS.ProcessEnv) => Promise<void>;
	/** A Windows shortcut's target, for the terminals found by their Start menu entry. */
	readShortcut?: (lnk: string) => string | undefined;
	now?: () => number;
}

const CACHE_MS = 60_000;

/**
 * Never through a shell (a path is data, not a command line); detached, so the editor outlives the app. Not
 * `windowsHide`: a program that honours the start-up show state, and a terminal's own console, would open hidden.
 */
function launch(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { detached: true, env, stdio: "ignore" });
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}

/** `host/openIn/list` and `host/openIn/open`, over targets detected at most once a minute. */
export class OpenIn {
	private readonly deps: OpenInDeps;
	private cached: { at: number; targets: Promise<OpenInTarget[]> } | undefined;
	/** Icons by program path, kept for the app's life: a program's icon does not change under it. */
	private readonly icons = new Map<string, Promise<string | undefined>>();

	constructor(deps: OpenInDeps) {
		this.deps = deps;
	}

	private targets(): Promise<OpenInTarget[]> {
		const now = (this.deps.now ?? Date.now)();
		if (!this.cached || now - this.cached.at >= CACHE_MS) {
			const targets = detectTargets(this.deps.platform, this.deps.env, { readShortcut: this.deps.readShortcut });
			// A failed detection is not kept: the next list tries again.
			targets.catch(() => (this.cached = undefined));
			this.cached = { at: now, targets };
		}
		return this.cached.targets;
	}

	/** Where a target's icon is read from: its own program, or the file manager's; the default app has none. */
	private iconPathOf(target: OpenInTarget): string | undefined {
		if (target.iconPath) return target.iconPath;
		if (target.kind !== "fileManager") return target.command || undefined;
		if (this.deps.platform === "win32") return join(this.deps.env.SystemRoot ?? "C:\\Windows", "explorer.exe");
		return this.deps.platform === "darwin" ? "/System/Library/CoreServices/Finder.app" : undefined;
	}

	async list(): Promise<{ id: string; name: string; kind: TargetKind; icon?: string }[]> {
		const targets = await this.targets();
		const missing = [
			...new Set(targets.flatMap((t) => this.iconPathOf(t) ?? []).filter((path) => !this.icons.has(path))),
		];
		if (missing.length > 0) {
			const read = this.deps.icons(missing);
			// A failed read is not kept: the next list tries again.
			read.catch(() => missing.forEach((path) => this.icons.delete(path)));
			for (const path of missing)
				this.icons.set(
					path,
					read.then(
						(icons) => icons.get(path),
						() => undefined,
					),
				);
		}
		return Promise.all(
			targets.map(async (target) => {
				const path = this.iconPathOf(target);
				const icon = path ? await this.icons.get(path) : undefined;
				return { id: target.id, name: target.name, kind: target.kind, ...(icon ? { icon } : {}) };
			}),
		);
	}

	async open(targetId: string, path: string, line?: number, column?: number): Promise<void> {
		// Absolute only: a relative one would resolve against main's own folder, and one starting with "-" is an option.
		if (!isAbsolute(path)) throw new InvalidParams(`not an absolute path: ${path}`);
		const target = (await this.targets()).find((t) => t.id === targetId);
		if (!target) throw new InvalidParams(`no app "${targetId}" to open in`);
		if (target.kind === "fileManager") return this.deps.reveal(path);
		if (target.kind === "systemDefault") return this.deps.openDefault(path);
		// The environment detection used: a Dock- or launcher-started app's own PATH is shorter than the user's.
		const run = target.launch?.(path, line, column) ?? {
			command: target.command,
			args: target.args(path, line, column),
		};
		await (this.deps.launch ?? launch)(run.command, run.args, this.deps.env);
	}
}
