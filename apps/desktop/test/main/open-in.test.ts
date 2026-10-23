import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { detectTargets, InvalidParams, OpenIn, windowsIcons } from "../../src/main/open-in.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A temporary folder with an empty file at each path. */
function layout(files: string[]): string {
	const root = mkdtempSync(join(tmpdir(), "kc-open-in-"));
	roots.push(root);
	for (const file of files) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), "");
	}
	return root;
}

/** A Windows machine under `root`: PATH, %LOCALAPPDATA% and %ProgramFiles% all inside it. */
const windowsEnv = (root: string, path: string[]) => ({
	PATH: path.map((p) => join(root, p)).join(";"),
	PATHEXT: ".COM;.EXE;.BAT;.CMD",
	LOCALAPPDATA: join(root, "Local"),
	ProgramFiles: join(root, "Program Files"),
	ProgramData: join(root, "ProgramData"),
	SystemRoot: join(root, "Windows"),
	USERPROFILE: root,
});

test("Windows: shims resolve to the editor's own program, install folders are searched, each target once", async () => {
	const root = layout([
		"Local/Programs/Microsoft VS Code/Code.exe",
		"Local/Programs/Microsoft VS Code/bin/code.cmd",
		"Local/Programs/cursor/Cursor.exe",
		"Local/Programs/cursor/resources/app/bin/cursor.cmd",
		"Local/Programs/Zed/bin/zed.exe",
		// A shim with no program anywhere is left out; nothing else names Windsurf.
		"orphan/windsurf.cmd",
		"Program Files/Sublime Text/sublime_text.exe",
		"Program Files/JetBrains/WebStorm 2025.1/bin/webstorm64.exe",
		"Program Files/JetBrains/WebStorm 2025.2/bin/webstorm64.exe",
		"Program Files/Git/git-bash.exe",
		"apps/wt.exe",
		"Windows/System32/wsl.exe",
		"ProgramData/Microsoft/Windows/Start Menu/Programs/WSL.lnk",
	]);
	const env = windowsEnv(root, [
		"Local/Programs/Microsoft VS Code/bin",
		"Local/Programs/cursor/resources/app/bin",
		"Local/Programs/Zed/bin",
		"orphan",
		"apps",
	]);
	const targets = await detectTargets("win32", env);
	// Codex's order: editors, the two shell entries, terminals, then the IDEs.
	expect(targets.map((t) => t.id)).toEqual([
		"vscode",
		"cursor",
		"sublimeText",
		"zed",
		"systemDefault",
		"fileManager",
		"terminal",
		"gitBash",
		"wsl",
		"webstorm",
	]);
	expect(targets.find((t) => t.id === "wsl")!.args(root)).toEqual(["-d", root, "wsl.exe"]);
	// WSL draws its Start menu shortcut's penguin, not Windows Terminal's icon.
	expect(targets.find((t) => t.id === "wsl")!.iconPath).toBe(
		join(root, "ProgramData/Microsoft/Windows/Start Menu/Programs/WSL.lnk"),
	);
	const command = (id: string) => targets.find((t) => t.id === id)!.command;
	expect(command("vscode")).toBe(join(root, "Local/Programs/Microsoft VS Code/Code.exe"));
	expect(command("cursor")).toBe(join(root, "Local/Programs/cursor/Cursor.exe"));
	expect(command("zed")).toBe(join(root, "Local/Programs/Zed/bin/zed.exe"));
	// The newest of two versions.
	expect(command("webstorm")).toBe(join(root, "Program Files/JetBrains/WebStorm 2025.2/bin/webstorm64.exe"));
	expect(targets.find((t) => t.id === "fileManager")!.name).toBe("File Explorer");
});

test("each target builds its own go-to-line syntax", async () => {
	const root = layout([
		"Local/Programs/Microsoft VS Code/Code.exe",
		"Local/Programs/Zed/Zed.exe",
		"Program Files/JetBrains/IntelliJ IDEA 2025.1/bin/idea64.exe",
		"Program Files/Notepad++/notepad++.exe",
		"apps/wt.exe",
	]);
	const targets = await detectTargets("win32", windowsEnv(root, ["apps"]));
	const args = (id: string, line?: number) => targets.find((t) => t.id === id)!.args(root, line, 7);
	expect(args("vscode", 12)).toEqual(["--goto", `${root}:12:7`]);
	expect(args("vscode")).toEqual([root]);
	expect(args("zed", 12)).toEqual([`${root}:12:7`]);
	expect(args("intellij", 12)).toEqual(["--line", "12", "--column", "7", root]);
	expect(args("notepadPlusPlus", 12)).toEqual(["-n12", "-c7", root]);
	// A terminal starts in the folder; Windows Terminal escapes its command separator.
	expect(args("terminal", 12)).toEqual(["-d", root.replaceAll(";", "\\;")]);
});

// A Windows folder ("C:\...") cannot sit in a ":"-separated PATH.
test.skipIf(process.platform === "win32")("Linux: a command on PATH, then the first terminal Codex knows", async () => {
	const root = layout(["bin/code", "bin/subl", "bin/konsole", "bin/kgx"]);
	const targets = await detectTargets("linux", {
		PATH: join(root, "bin"),
		HOME: root,
		XDG_DATA_HOME: join(root, "share"),
		XDG_DATA_DIRS: join(root, "system"),
	});
	const vscode = targets.find((t) => t.id === "vscode")!;
	expect(vscode.command).toBe(join(root, "bin/code"));
	expect(vscode.args("/p/a.ts", 3, 1)).toEqual(["--goto", "/p/a.ts:3:1"]);
	expect(targets.find((t) => t.id === "sublimeText")!.args("/p/a.ts", 3, 2)).toEqual(["/p/a.ts:3:2"]);
	const terminals = targets.filter((t) => t.kind === "terminal");
	expect(terminals).toHaveLength(1);
	expect(terminals[0]!.command).toBe(join(root, "bin/kgx"));
	expect(terminals[0]!.args(root)).toEqual(["--working-directory", root]);
});

test.skipIf(process.platform === "win32")("Linux: an editor found only by its desktop entry launches through gio", async () => {
	const root = layout(["bin/gio", "share/applications/cursor.desktop", "share/applications/dev.zed.Zed.desktop"]);
	const targets = await detectTargets("linux", { PATH: join(root, "bin"), HOME: root, XDG_DATA_HOME: join(root, "share") });
	const entry = (name: string) => join(root, "share/applications", name);
	const cursor = targets.find((t) => t.id === "cursor")!;
	expect(cursor.command).toBe(join(root, "bin/gio"));
	// gio hands its arguments over as files: a flag such as --goto would arrive as a file name.
	expect(cursor.args("/p/a.ts", 3, 1)).toEqual(["launch", entry("cursor.desktop"), "/p/a.ts"]);
	expect(targets.find((t) => t.id === "zed")!.args("/p/a.ts", 3, 1)).toEqual([
		"launch",
		entry("dev.zed.Zed.desktop"),
		"/p/a.ts:3:1",
	]);
});

function service(root: string, launched: [string, string[]][], shown: string[] = []) {
	let now = 0;
	const reads: string[][] = [];
	let failNext = false;
	let launchEnv: NodeJS.ProcessEnv | undefined;
	const openIn = new OpenIn({
		platform: "win32",
		env: windowsEnv(root, ["apps"]),
		icons: async (paths) => {
			reads.push(paths);
			if (failNext) {
				failNext = false;
				throw new Error("no icons");
			}
			return new Map(paths.map((path) => [path, `data:${path}`]));
		},
		reveal: async (path) => void shown.push(`reveal ${path}`),
		openDefault: async (path) => void shown.push(`default ${path}`),
		launch: async (command, args, env) => {
			launched.push([command, args]);
			launchEnv = env;
		},
		now: () => now,
	});
	return {
		openIn,
		reads,
		advance: (ms: number) => (now += ms),
		failIcons: () => (failNext = true),
		launchEnv: () => launchEnv,
	};
}

test("open launches a listed target, hands the shell entries to the shell, and refuses the rest", async () => {
	const root = layout(["Local/Programs/Microsoft VS Code/Code.exe"]);
	const launched: [string, string[]][] = [];
	const shown: string[] = [];
	const { openIn, launchEnv } = service(root, launched, shown);
	const file = join(root, "a.ts");
	await openIn.open("vscode", file, 4, 2);
	expect(launched).toEqual([[join(root, "Local/Programs/Microsoft VS Code/Code.exe"), ["--goto", `${file}:4:2`]]]);
	// With the environment detection used (the login shell's), not main's own.
	expect(launchEnv()?.PATH).toBe(windowsEnv(root, ["apps"]).PATH);
	await openIn.open("fileManager", file);
	await openIn.open("systemDefault", file);
	expect(shown).toEqual([`reveal ${file}`, `default ${file}`]);
	await expect(openIn.open("zed", file)).rejects.toBeInstanceOf(InvalidParams);
	await expect(openIn.open("vscode", "relative/a.ts")).rejects.toBeInstanceOf(InvalidParams);
	await expect(openIn.open("vscode", "--install-extension")).rejects.toBeInstanceOf(InvalidParams);
	expect(launched).toHaveLength(1);
});

test("the list carries icons and is detected again only after a minute", async () => {
	const root = layout(["Local/Programs/Microsoft VS Code/Code.exe"]);
	const { openIn, advance } = service(root, []);
	const first = await openIn.list();
	expect(first.find((t) => t.id === "vscode")).toEqual({
		id: "vscode",
		name: "VS Code",
		kind: "editor",
		icon: `data:${join(root, "Local/Programs/Microsoft VS Code/Code.exe")}`,
	});
	// The default app has nothing to draw.
	expect(first.find((t) => t.id === "systemDefault")).toEqual({ id: "systemDefault", name: "Default app", kind: "systemDefault" });
	layout([]);
	mkdirSync(join(root, "Local/Programs/Zed"), { recursive: true });
	writeFileSync(join(root, "Local/Programs/Zed/Zed.exe"), "");
	advance(59_000);
	expect((await openIn.list()).some((t) => t.id === "zed")).toBe(false);
	advance(1_000);
	expect((await openIn.list()).some((t) => t.id === "zed")).toBe(true);
});

test("icons are read in one batch, each program once, and a failed read is tried again", async () => {
	const root = layout(["Local/Programs/Microsoft VS Code/Code.exe", "Local/Programs/Zed/Zed.exe"]);
	const { openIn, reads, failIcons } = service(root, []);
	failIcons();
	expect((await openIn.list()).find((t) => t.id === "vscode")!.icon).toBeUndefined();
	const listed = await openIn.list();
	expect(listed.find((t) => t.id === "zed")!.icon).toBe(`data:${join(root, "Local/Programs/Zed/Zed.exe")}`);
	expect(listed.find((t) => t.id === "fileManager")!.icon).toBe(`data:${join(root, "Windows", "explorer.exe")}`);
	await openIn.list();
	// Both reads asked for every program at once; the third asked for nothing.
	expect(reads).toHaveLength(2);
	expect(reads[0]).toEqual(reads[1]);
	expect(reads[0]).toContain(join(root, "Local/Programs/Microsoft VS Code/Code.exe"));
});

test.runIf(process.platform === "win32")("Windows: icons come from the programs, also under a non-ASCII path", async () => {
	const root = layout([]);
	const folder = join(root, "prögrams");
	mkdirSync(folder);
	const copy = join(folder, "cmd.exe");
	copyFileSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe"), copy);
	const missing = join(root, "missing.exe");
	const icons = await windowsIcons([copy, missing], process.env);
	expect(icons.get(copy)).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
	expect(icons.has(missing)).toBe(false);
}, 30_000);
