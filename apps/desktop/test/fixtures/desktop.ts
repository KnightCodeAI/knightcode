/** Scratch-only configuration for real Electron parity tests; no developer credentials or provider calls. */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, isAbsolute, join, parse, relative, resolve } from "node:path";
import { DEFAULT_PREFERENCES, DEFAULT_STATE } from "../../src/shared/host-protocol.ts";

const COUNTER = resolve(__dirname, "../../../../packages/cli/examples/mcp-app/server.mjs");

/** User-scoped extension: each command raises one dialog kind, and one shows a declarative view widget. */
const PARITY_EXTENSION = `
export default function (knightcode: any) {
	const command = (name: string, description: string, run: (ctx: any) => Promise<void> | void) =>
		knightcode.registerCommand(name, { description, handler: async (_args: string, ctx: any) => run(ctx) });
	command("parity-select", "Choose a fixture layout", async (ctx) => {
		const choice = await ctx.ui.select("Choose a fixture layout", ["Compact", "Comfortable"]);
		ctx.ui.notify(\`Chose \${choice ?? "nothing"}.\`, "info");
	});
	command("parity-confirm", "Confirm a fixture reset", async (ctx) => {
		const confirmed = await ctx.ui.confirm("Reset the fixture?", "This clears the fixture's scratch notes.");
		ctx.ui.notify(confirmed ? "Reset." : "Kept the notes.", "warning");
	});
	command("parity-input", "Name the fixture", async (ctx) => {
		const name = await ctx.ui.input("Name the fixture", "Fixture name");
		ctx.ui.notify(\`Named \${name ?? "nothing"}.\`, "info");
	});
	command("parity-editor", "Edit the fixture notes", async (ctx) => {
		const notes = await ctx.ui.editor("Edit the fixture notes", "First line\\nSecond line");
		ctx.ui.notify(notes === undefined ? "Edit cancelled." : "Notes saved.", "info");
	});
	command("parity-view", "Show the fixture checks", (ctx) => {
		ctx.ui.setWidget("parity:checks", {
			type: "stack",
			children: [
				{ type: "text", text: "Fixture checks", tone: "muted" },
				{ type: "table", columns: ["check", "result"], rows: [["types", "passed"], ["tests", "2 failed"]] },
				{
					type: "stack",
					direction: "horizontal",
					children: [
						{ type: "field", id: "verbose", kind: "toggle", label: "Verbose", value: false },
						{ type: "button", id: "rerun", label: "Run again" },
					],
				},
			],
		});
	});
}
`;

export interface DesktopFixtureOptions {
	theme: "light" | "dark";
	projectSettings?: boolean;
	/** The examples/mcp-app counter as a user MCP server. */
	counter?: boolean;
	/** PARITY_EXTENSION in the agent dir's extensions, and ask_user enabled. */
	dialogs?: boolean;
}

export interface DesktopFixture {
	root: string;
	project: string;
	agentDir: string;
	userData: string;
	/** The faux app server writes its pid here on each start. */
	serverPid: string;
	/** While this file exists, a starting faux app server waits before its handshake. */
	serverHold: string;
	/** The fixture's own fd, when one was found to copy. */
	fd: string | undefined;
	env: Record<string, string>;
}

/**
 * `@` file suggestions list files with fd, and an offline scratch agent dir cannot download it: the fixture
 * copies one in. KNIGHTCODE_PARITY_FD, else the developer's agent-dir copy, else fd/fdfind on PATH.
 */
function findFd(): string | undefined {
	const exe = process.platform === "win32" ? ".exe" : "";
	const candidates = [
		process.env.KNIGHTCODE_PARITY_FD,
		join(process.env.KNIGHTCODE_CODING_AGENT_DIR ?? join(homedir(), ".knightcode", "agent"), "bin", `fd${exe}`),
	];
	for (const name of ["fd", "fdfind"]) {
		const found = spawnSync(process.platform === "win32" ? "where" : "which", [name], { encoding: "utf8" });
		if (found.status === 0) candidates.push(found.stdout.split(/\r?\n/)[0]);
	}
	return candidates.find((path) => path && existsSync(path));
}

/**
 * Skills and context files are also found by walking up from the project to its Git root, so a project
 * under the home folder (Windows' temp dir is) would load the developer's ~/.agents/skills. Such a temp
 * dir is swapped for one at the drive root; KNIGHTCODE_PARITY_TMP overrides both.
 */
export function fixtureParent(): string {
	if (process.env.KNIGHTCODE_PARITY_TMP) return process.env.KNIGHTCODE_PARITY_TMP;
	const temp = realpathSync.native(tmpdir());
	const home = realpathSync.native(homedir());
	const inside = relative(home, temp);
	if (inside.startsWith("..") || isAbsolute(inside)) return temp;
	return join(parse(temp).root, "kc-parity");
}

export function createDesktopFixture(options: DesktopFixtureOptions): DesktopFixture {
	const parent = fixtureParent();
	mkdirSync(parent, { recursive: true });
	// Git returns long paths, not RUNNER~1-style Windows temp paths.
	const root = realpathSync.native(mkdtempSync(join(parent, "kc-desktop-parity-")));
	const project = join(root, "project");
	const agentDir = join(root, "agent");
	const userData = join(root, "userdata");
	const home = join(root, "home");
	const serverPid = join(root, "server.pid");
	const serverHold = join(root, "server.hold");
	const env: Record<string, string> = {};
	// Only OS/process-launch variables cross into the fixture, never API keys, runtime injection or agent settings.
	for (const key of [
		"PATH",
		"Path",
		"SystemRoot",
		"SYSTEMROOT",
		"WINDIR",
		"SystemDrive",
		"COMSPEC",
		"PATHEXT",
		"TEMP",
		"TMP",
		"TMPDIR",
		"DISPLAY",
		"WAYLAND_DISPLAY",
		"XAUTHORITY",
		"XDG_RUNTIME_DIR",
		"DBUS_SESSION_BUS_ADDRESS",
	]) {
		const value = process.env[key];
		if (value !== undefined) env[key] = value;
	}
	Object.assign(env, {
		HOME: home,
		USERPROFILE: home,
		APPDATA: join(root, "appdata"),
		LOCALAPPDATA: join(root, "localappdata"),
		XDG_CONFIG_HOME: join(root, "config"),
		XDG_CACHE_HOME: join(root, "cache"),
		XDG_DATA_HOME: join(root, "data"),
		CLAUDE_CONFIG_DIR: join(root, "claude"),
		GROK_HOME: join(root, "grok"),
		GH_CONFIG_DIR: join(root, "gh"),
		KNIGHTCODE_CODING_AGENT_DIR: agentDir,
		KNIGHTCODE_OFFLINE: "1",
		KNIGHTCODE_FAUX_PID_FILE: serverPid,
		KNIGHTCODE_FAUX_HOLD_FILE: serverHold,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: join(root, "gitconfig"),
		TZ: "UTC",
		LANG: "en_US.UTF-8",
	});
	const configRoots = [
		"HOME",
		"APPDATA",
		"LOCALAPPDATA",
		"XDG_CONFIG_HOME",
		"XDG_CACHE_HOME",
		"XDG_DATA_HOME",
		"CLAUDE_CONFIG_DIR",
		"GROK_HOME",
		"GH_CONFIG_DIR",
		"KNIGHTCODE_CODING_AGENT_DIR",
	];
	for (const path of [project, userData, ...configRoots.map((key) => env[key])]) {
		mkdirSync(path, { recursive: true });
	}
	// The desktop's own commits need an identity; the scratch global config is the only one Git reads.
	writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n\tname = Parity\n\temail = parity@example.invalid\n");
	// gh's presence and sign-in are the developer's: without it on PATH, PR creation always takes the missing-gh path.
	for (const key of ["PATH", "Path"]) {
		if (env[key] === undefined) continue;
		const gh = process.platform === "win32" ? "gh.exe" : "gh";
		env[key] = env[key]
			.split(delimiter)
			.filter((dir) => dir && !existsSync(join(dir, gh)))
			.join(delimiter);
	}
	const fd = findFd();
	const fdCopy = join(agentDir, "bin", process.platform === "win32" ? "fd.exe" : "fd");
	if (fd) {
		mkdirSync(join(agentDir, "bin"));
		copyFileSync(fd, fdCopy);
	}
	writeFileSync(join(project, "README.md"), "# Parity project\n\nA deterministic desktop fixture.\n");
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({ defaultProvider: "faux-e2e", defaultModel: "faux-e2e" }),
	);
	if (options.projectSettings) {
		mkdirSync(join(project, ".knightcode"));
		writeFileSync(join(project, ".knightcode", "settings.json"), "{}\n");
	}
	if (options.counter) {
		writeFileSync(
			join(agentDir, "mcp.json"),
			JSON.stringify({ mcpServers: { counter: { command: process.execPath, args: [COUNTER] } } }),
		);
	}
	if (options.dialogs) {
		mkdirSync(join(agentDir, "extensions"));
		writeFileSync(join(agentDir, "extensions", "parity.ts"), PARITY_EXTENSION);
		// ask_user is off by default; the question request needs it.
		writeFileSync(join(agentDir, "tools.json"), JSON.stringify({ ask_user: { enabled: true } }));
	}
	const fonts = { font: "Arial", contentFont: "Arial", codeFont: "Courier New", translucentSidebar: false };
	writeFileSync(
		join(userData, "desktop-state.json"),
		JSON.stringify({
			...DEFAULT_STATE,
			projects: [{ path: project, name: "Parity project", collapsed: false }],
			preferences: {
				...DEFAULT_PREFERENCES,
				theme: options.theme,
				uiFontSize: 14,
				codeFontSize: 12,
				turnNotifications: "never",
				terminalShell: process.platform === "win32" ? "cmd" : "sh",
				appearance: { light: fonts, dark: fonts },
			},
		}),
	);
	return { root, project, agentDir, userData, serverPid, serverHold, fd: fd ? fdCopy : undefined, env };
}
