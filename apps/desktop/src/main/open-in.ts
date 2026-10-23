/**
 * "Open in" (desktop-shell.md section 9.9), after Codex's open-in targets (26.1016 main bundle, `open-in-targets`):
 * editors found on PATH or in their install folders (Windows), as app bundles (macOS) or desktop entries (Linux),
 * each launched with its own go-to-line syntax; terminals at the folder; and two fixed
 * entries, the file manager and the system's default app, that main runs through Electron's shell.
 */

import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

export type TargetKind = "editor" | "terminal" | "fileManager" | "systemDefault";

export interface OpenInTarget {
	id: string;
	name: string;
	kind: TargetKind;
	/** The program to run; empty for the two shell entries (fileManager, systemDefault). */
	command: string;
	/** Where its icon is read from (Electron's app.getFileIcon); the command when absent. */
	iconPath?: string;
	args(path: string, line?: number, column?: number): string[];
}

type Goto = (path: string, line?: number, column?: number) => string[];

// The go-to-line syntaxes Codex passes (its HX, mZ, fZ, sZ).
const vscode: Goto = (p, l, c) => (l ? ["--goto", `${p}:${l}:${c ?? 1}`] : [p]);
const colon: Goto = (p, l, c) => [l ? `${p}:${l}:${c ?? 1}` : p];
const jetbrains: Goto = (p, l, c) => (l ? ["--line", String(l), "--column", String(c ?? 1), p] : [p]);
const emacs: Goto = (p, l, c) => (l ? [`+${l}:${c ?? 1}`, p] : [p]);
const notepadPlusPlus: Goto = (p, l, c) => (l ? [`-n${l}`, `-c${c ?? 1}`, p] : [p]);

/** A directory as is, a file's folder: what a terminal or `open -a Terminal` starts in. */
const folderOf = (path: string) => (existsSync(path) && statSync(path).isDirectory() ? path : dirname(path));

interface Spec {
	id: string;
	name: string;
	kind?: TargetKind;
	goto?: Goto;
	/** Commands looked up on PATH. On Windows a `bin\x.cmd` shim resolves to `exe` one folder up. */
	path?: string[];
	/** Windows: the editor's own program, beside or above its PATH shim. */
	exe?: string;
	/** Windows: candidates under %LOCALAPPDATA%\Programs, %ProgramFiles% and %ProgramFiles(x86)%. */
	win?: string[][];
	/** macOS: paths under /Applications or ~/Applications; a bare `.app` opens with `open -a`. */
	mac?: string[];
	/** Linux: desktop entries, launched with `gio launch`. */
	desktop?: string[];
	/** Arguments for a terminal, given the folder. */
	terminal?: (folder: string, command: string) => string[];
	/** Windows: a program in System32 the target needs besides its own (WSL's wsl.exe). */
	requires?: string;
	/** Windows: a Start menu shortcut whose icon is the target's (Codex's WSL.lnk). */
	shortcutIcon?: string;
}

/** An IDE of JetBrains': `idea64.exe` in `JetBrains\IntelliJ IDEA <version>\bin` on Windows (Codex's uVe). */
const jetbrainsSpec = (id: string, name: string, exe: string, desktop: string[], win?: string[][]): Spec => ({
	id,
	name,
	goto: jetbrains,
	path: [`${exe}64.exe`, exe, `${exe}.sh`],
	exe: `${exe}64.exe`,
	win: win ?? [["JetBrains", `*${name}*`, "bin", `${exe}64.exe`]],
	mac: [`${name}.app/Contents/MacOS/${exe}`],
	desktop,
});

/** Codex's order, which is the menu's (its HVe), with Notepad++ beside Sublime Text. */
const SPECS: Spec[] = [
	{
		id: "vscode",
		name: "VS Code",
		goto: vscode,
		path: ["code"],
		exe: "Code.exe",
		win: [["Microsoft VS Code", "Code.exe"]],
		mac: ["Visual Studio Code.app/Contents/Resources/app/bin/code", "Code.app/Contents/Resources/app/bin/code"],
		desktop: ["code.desktop", "com.visualstudio.code.desktop", "code_code.desktop"],
	},
	{
		id: "vscodeInsiders",
		name: "VS Code Insiders",
		goto: vscode,
		path: ["code-insiders"],
		exe: "Code - Insiders.exe",
		win: [["Microsoft VS Code Insiders", "Code - Insiders.exe"]],
		mac: ["Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code"],
		desktop: ["code-insiders.desktop"],
	},
	{
		id: "cursor",
		name: "Cursor",
		goto: vscode,
		path: ["cursor"],
		exe: "Cursor.exe",
		win: [
			["cursor", "Cursor.exe"],
			["Cursor", "Cursor.exe"],
		],
		mac: ["Cursor.app/Contents/Resources/app/bin/cursor"],
		desktop: ["cursor.desktop"],
	},
	{ id: "bbedit", name: "BBEdit", mac: ["BBEdit.app"] },
	{
		id: "emacs",
		name: "Emacs",
		goto: emacs,
		path: ["emacs", "emacsclient"],
		exe: "emacs.exe",
		mac: ["Emacs.app"],
		desktop: ["emacs.desktop", "emacsclient.desktop"],
	},
	{
		id: "sublimeText",
		name: "Sublime Text",
		goto: colon,
		path: ["subl"],
		exe: "sublime_text.exe",
		win: [["Sublime Text", "sublime_text.exe"]],
		mac: ["Sublime Text.app/Contents/SharedSupport/bin/subl"],
		desktop: ["sublime_text.desktop", "com.sublimetext.three.desktop"],
	},
	{ id: "notepadPlusPlus", name: "Notepad++", goto: notepadPlusPlus, win: [["Notepad++", "notepad++.exe"]] },
	{
		id: "zed",
		name: "Zed",
		goto: colon,
		path: ["zed"],
		exe: "Zed.exe",
		win: [["Zed", "Zed.exe"]],
		mac: ["Zed.app/Contents/MacOS/zed", "Zed Preview.app/Contents/MacOS/zed"],
		desktop: ["dev.zed.Zed.desktop", "zed.desktop"],
	},
	{
		id: "windsurf",
		name: "Windsurf",
		goto: vscode,
		path: ["windsurf"],
		exe: "Windsurf.exe",
		win: [["Windsurf", "Windsurf.exe"]],
		mac: ["Windsurf.app/Contents/Resources/app/bin/windsurf"],
		desktop: ["windsurf.desktop"],
	},
	{
		id: "antigravity",
		name: "Antigravity",
		goto: vscode,
		// Renamed "Antigravity IDE" in its later releases, `antigravity-ide` on PATH.
		path: ["antigravity-ide", "antigravity"],
		exe: "Antigravity IDE.exe",
		win: [
			["Antigravity IDE", "Antigravity IDE.exe"],
			["Antigravity", "Antigravity.exe"],
		],
		mac: ["Antigravity.app/Contents/Resources/app/bin/antigravity"],
		desktop: ["antigravity-ide.desktop"],
	},
	{
		id: "githubDesktop",
		name: "GitHub Desktop",
		path: ["github"],
		exe: "GitHubDesktop.exe",
		win: [
			["GitHubDesktop", "GitHubDesktop.exe"],
			["GitHub Desktop", "GitHubDesktop.exe"],
		],
	},
	{ id: "systemDefault", name: "Default app", kind: "systemDefault" },
	{ id: "fileManager", name: "File Manager", kind: "fileManager" },
	// Windows Terminal: `;` separates its commands, so a path's own is escaped (Codex's rZ). On Linux the first
	// terminal of LINUX_TERMINALS.
	{
		id: "terminal",
		name: "Terminal",
		kind: "terminal",
		path: ["wt.exe"],
		mac: ["/System/Applications/Utilities/Terminal.app"],
		terminal: (folder) => ["-d", folder.replaceAll(";", "\\;")],
	},
	{
		id: "gitBash",
		name: "Git Bash",
		kind: "terminal",
		path: ["git-bash.exe"],
		win: [["Git", "git-bash.exe"]],
		terminal: (folder) => [`--cd=${folder}`],
	},
	// WSL in Windows Terminal, starting in the folder (Windows' own path, which WSL mounts).
	{
		id: "wsl",
		name: "WSL",
		kind: "terminal",
		path: ["wt.exe"],
		requires: "wsl.exe",
		shortcutIcon: "WSL.lnk",
		terminal: (folder) => ["-d", folder.replaceAll(";", "\\;"), "wsl.exe"],
	},
	{ id: "iterm2", name: "iTerm2", kind: "terminal", mac: ["iTerm.app"] },
	{ id: "kitty", name: "Kitty", kind: "terminal", mac: ["kitty.app"] },
	{ id: "ghostty", name: "Ghostty", kind: "terminal", mac: ["Ghostty.app"] },
	{ id: "warp", name: "Warp", kind: "terminal", mac: ["Warp.app"] },
	{ id: "xcode", name: "Xcode", mac: ["Xcode.app"] },
	jetbrainsSpec(
		"androidStudio",
		"Android Studio",
		"studio",
		["jetbrains-studio.desktop", "android-studio.desktop"],
		[["Android", "Android Studio", "bin", "studio64.exe"]],
	),
	jetbrainsSpec("intellij", "IntelliJ IDEA", "idea", ["jetbrains-idea.desktop", "jetbrains-idea-ce.desktop"]),
	jetbrainsSpec("rider", "Rider", "rider", ["jetbrains-rider.desktop"]),
	jetbrainsSpec("goland", "GoLand", "goland", ["jetbrains-goland.desktop"]),
	jetbrainsSpec("rustrover", "RustRover", "rustrover", ["jetbrains-rustrover.desktop"]),
	jetbrainsSpec("pycharm", "PyCharm", "pycharm", ["jetbrains-pycharm.desktop", "jetbrains-pycharm-ce.desktop"]),
	jetbrainsSpec("webstorm", "WebStorm", "webstorm", ["jetbrains-webstorm.desktop"]),
	jetbrainsSpec("phpstorm", "PhpStorm", "phpstorm", ["jetbrains-phpstorm.desktop"]),
	{ id: "textmate", name: "TextMate", mac: ["TextMate.app"] },
];

/** Linux terminals in Codex's order, with the flag each takes for its starting folder (its QX). */
const LINUX_TERMINALS: [string, (folder: string) => string[]][] = [
	["kgx", (f) => ["--working-directory", f]],
	["gnome-terminal", (f) => ["--working-directory", f]],
	["konsole", (f) => ["--workdir", f]],
	["xfce4-terminal", (f) => ["--working-directory", f]],
	["mate-terminal", (f) => ["--working-directory", f]],
	["tilix", (f) => ["--working-directory", f]],
	["alacritty", (f) => ["--working-directory", f]],
	["kitty", (f) => ["--directory", f]],
	["ghostty", (f) => [`--working-directory=${f}`]],
];

const pathKey = (env: NodeJS.ProcessEnv) => Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

/** A command on PATH: with Windows' PATHEXT for a bare name. */
function onPath(name: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | undefined {
	const dirs = (env[pathKey(env)] ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
	const extensions =
		platform === "win32" && !extname(name) ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
	for (const dir of dirs)
		for (const extension of extensions) {
			const candidate = join(dir, `${name}${extension.toLowerCase()}`);
			// lstat: an app execution alias (WindowsApps\wt.exe) is a reparse point that stat and existsSync refuse.
			const entry = lstatSync(candidate, { throwIfNoEntry: false });
			if (entry && !entry.isDirectory()) return candidate;
		}
	return undefined;
}

/**
 * A Windows command shim (`bin\code.cmd`) is never run through a shell: the editor's own program stands in, beside
 * the shim or above its `bin` (Cursor's is three folders down, `resources\app\bin`), and a shim with neither is left
 * out (Codex's oo and MBe).
 */
function realProgram(found: string, exe: string | undefined): string | undefined {
	if (/\.exe$/i.test(found)) return found;
	if (!exe) return undefined;
	let dir = dirname(found);
	if (existsSync(join(dir, exe))) return join(dir, exe);
	if (basename(dir).toLowerCase() !== "bin") return undefined;
	for (let up = 0; up < 3; up++) {
		dir = dirname(dir);
		if (existsSync(join(dir, exe))) return join(dir, exe);
	}
	return undefined;
}

/** `["JetBrains", "*IntelliJ IDEA*", "bin", "idea64.exe"]` under a root, a `*` segment matching any folder holding it. */
function under(root: string, parts: string[]): string | undefined {
	const [first, ...rest] = parts;
	if (first === undefined) return existsSync(root) ? root : undefined;
	if (!first.startsWith("*")) return under(join(root, first), rest);
	const needle = first.replaceAll("*", "").toLowerCase();
	let names: string[];
	try {
		// Newest first, as Codex sorts its JetBrains folders.
		names = readdirSync(root).sort((a, b) => b.localeCompare(a));
	} catch {
		return undefined;
	}
	for (const name of names) {
		if (!name.toLowerCase().includes(needle)) continue;
		const found = under(join(root, name), rest);
		if (found) return found;
	}
	return undefined;
}

/** Every target this machine has, in Codex's order, the file manager and the default app among them. */
export async function detectTargets(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Promise<OpenInTarget[]> {
	const home = env.USERPROFILE ?? env.HOME ?? "";
	const localAppData = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
	const installRoots = [join(localAppData, "Programs"), env.ProgramFiles, env["ProgramFiles(x86)"]].filter(
		(r): r is string => Boolean(r),
	);
	const applications = ["/Applications", join(home, "Applications")];
	const dataDirs = [
		env.XDG_DATA_HOME ?? join(home, ".local", "share"),
		...(env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":"),
		"/var/lib/flatpak/exports/share",
		join(home, ".local", "share", "flatpak", "exports", "share"),
	];
	const toolbox = join(home, ".local", "share", "JetBrains", "Toolbox", "scripts");

	const targets: OpenInTarget[] = [];
	const add = (spec: Spec, command: string, args: OpenInTarget["args"], iconPath?: string) =>
		targets.push({ id: spec.id, name: spec.name, kind: spec.kind ?? "editor", command, args, ...(iconPath ? { iconPath } : {}) });

	for (const spec of SPECS) {
		const goto = spec.goto ?? ((p: string) => [p]);
		const run = (command: string, iconPath?: string) =>
			add(spec, command, spec.terminal ? (p) => spec.terminal!(folderOf(p), command) : goto, iconPath);
		if (spec.kind === "systemDefault" || spec.kind === "fileManager") {
			const name =
				spec.kind === "systemDefault"
					? spec.name
					: platform === "darwin"
						? "Finder"
						: platform === "win32"
							? "File Explorer"
							: spec.name;
			targets.push({ id: spec.id, name, kind: spec.kind, command: "", args: () => [] });
		} else if (platform === "linux" && spec.id === "terminal") {
			for (const [name, flags] of LINUX_TERMINALS) {
				const command = onPath(name, platform, env);
				if (!command) continue;
				add(spec, command, (p) => flags(folderOf(p)));
				break;
			}
		} else if (platform === "win32") {
			if (spec.requires && !existsSync(join(env.SystemRoot ?? "C:\\Windows", "System32", spec.requires))) continue;
			const fromPath = spec.path?.map((n) => onPath(n, platform, env)).find(Boolean);
			const program =
				(fromPath && realProgram(fromPath, spec.exe)) ??
				spec.win?.flatMap((parts) => installRoots.map((root) => under(root, parts))).find(Boolean);
			const lnk = spec.shortcutIcon;
			const shortcut = lnk
				? [env.ProgramData, env.APPDATA]
						.flatMap((root) => (root ? [join(root, "Microsoft", "Windows", "Start Menu", "Programs", lnk)] : []))
						.find((path) => existsSync(path))
				: undefined;
			if (program) run(program, shortcut);
		} else if (platform === "darwin") {
			const bundle = spec.mac
				?.flatMap((rel) => (rel.startsWith("/") ? [rel] : applications.map((dir) => join(dir, rel))))
				.find((candidate) => existsSync(candidate));
			if (!bundle) continue;
			const app = bundle.slice(0, bundle.indexOf(".app") + 4);
			// An app with no command line of its own opens through Launch Services.
			if (bundle.endsWith(".app"))
				add(spec, "/usr/bin/open", (p) => ["-a", app, spec.kind === "terminal" ? folderOf(p) : p], app);
			else run(bundle, app);
		} else {
			if (spec.kind === "terminal") continue; // Linux terminals come from LINUX_TERMINALS
			const command =
				spec.path?.map((n) => onPath(n, platform, env)).find(Boolean) ??
				spec.path?.map((n) => join(toolbox, n)).find((p) => existsSync(p));
			const entry = spec.desktop
				?.flatMap((name) => dataDirs.map((dir) => join(dir, "applications", name)))
				.find((p) => existsSync(p));
			if (command) run(command);
			else if (entry) {
				const gio = onPath("gio", platform, env);
				if (gio) add(spec, gio, (p, l, c) => ["launch", entry, ...goto(p, l, c).slice(-1)]);
			}
		}
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
	launch?: (command: string, args: string[]) => Promise<void>;
	now?: () => number;
}

const CACHE_MS = 60_000;

/** Never through a shell (a path is data, not a command line); detached, so the editor outlives the app. */
function launch(command: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
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
			const targets = detectTargets(this.deps.platform, this.deps.env);
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
		await (this.deps.launch ?? launch)(target.command, target.args(path, line, column));
	}
}
