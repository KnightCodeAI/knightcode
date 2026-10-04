/**
 * Regenerates the website and docs screenshots from the real interactive TUI.
 *
 *   bun run screenshots                 every scene
 *   bun run screenshots tools themes    only these scenes
 *
 * Each scene runs in its own child process with a throwaway home and project under the OS temp dir, a local endpoint
 * that plays scripted Anthropic responses, and KnightCode's `main()` drawing into a headless xterm. The parent turns
 * the terminal cells into HTML and captures them with headless Chrome or Edge (CHROME_PATH overrides the lookup).
 * Nothing reads the repo's .env, the real ~/.knightcode, or a provider account.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import xterm from "@xterm/headless";
import { SessionManager } from "../packages/cli/src/core/session-manager.ts";
import { main } from "../packages/cli/src/main.ts";
import { canonicalizePath } from "../packages/cli/src/utils/paths.ts";

const REPO = resolve(import.meta.dir, "..");
const COLS = 104;
const MODEL = "claude-sonnet-5-5";
const BG = "#1d1e24";
const FG = "#dcdde3";
let toolIds = 0;

// ---- scenes ---------------------------------------------------------------------------------------------------------

interface Driver {
	settle(quietMs?: number): Promise<void>;
	type(text: string): Promise<void>;
	press(key: keyof typeof KEYS, times?: number): Promise<void>;
}

interface Scene {
	/** Files the scene produces, relative to the repo root. `chrome` adds a title bar and rounded corners. */
	outputs: Array<{ path: string; chrome?: boolean }>;
	/** Terminal height. Tall enough that the whole capture fits in the viewport. */
	rows?: number;
	args: string[];
	/** Model replies, one per request, picked by how many assistant messages the request already carries. */
	turns?: string[];
	/** Writes the fixture project and seeds sessions. Runs in the child, before `main()`. */
	setup?(project: string): void;
	drive?(d: Driver): Promise<void>;
	/** The capture starts at the first row containing `from` and ends at the last row matching `to`. */
	from?: string;
	to?: RegExp;
	settings?: Record<string, unknown>;
}

const GREET = 'export function greet(name: string) {\n\treturn "Hello, " + name;\n}\n';
const FAREWELL = '\nexport function farewell(name: string) {\n\treturn "Bye, " + name;\n}\n';

const SCENES: Record<string, Scene> = {
	terminal: {
		outputs: [
			{ path: "apps/web/public/screens/terminal.webp" },
			{ path: "packages/cli/docs/images/interactive-mode.png", chrome: true },
		],
		args: ["What is this repo?"],
		setup(project) {
			copyFileSync(join(REPO, "README.md"), join(project, "README.md"));
			for (const name of ["agent", "ai", "cli", "tui"]) mkdirSync(join(project, "packages", name), { recursive: true });
		},
		turns: [
			reply(
				4700,
				thinking("The user wants an overview. Start with the README."),
				toolUse("read", { path: "README.md" }),
			),
			reply(9100, thinking("Check which packages exist."), toolUse("bash", { command: "ls packages" })),
			reply(
				9400,
				text(
					"This is the KnightCode monorepo. The `cli` package ships the `knightcode` binary; `agent` runs the loop and built-in tools, `ai` talks to every model provider, and `tui` draws the terminal UI.\n\nWhich package should I work on?",
				),
			),
		],
	},
	tools: {
		outputs: [{ path: "apps/web/public/screens/tools.webp" }],
		args: ["Add an explicit return type to greet and use a template literal"],
		from: "Add an explicit return type",
		setup(project) {
			writeFileSync(join(project, "src", "greet.ts"), GREET + FAREWELL);
		},
		turns: [
			reply(4800, thinking("Read the file, then make one edit."), toolUse("read", { path: "src/greet.ts" })),
			reply(
				5200,
				thinking("One targeted edit is enough."),
				toolUse("edit", {
					path: "src/greet.ts",
					edits: [
						{
							oldText: GREET.trimEnd(),
							newText: "export function greet(name: string): string {\n\treturn `Hello, ${name}`;\n}",
						},
					],
				}),
			),
			reply(5900, thinking("Confirm what changed."), toolUse("bash", { command: "git diff --stat" })),
			reply(
				6100,
				text("`greet` now has an explicit return type and uses a template literal. `farewell` is untouched."),
			),
		],
	},
	sessions: {
		outputs: [{ path: "apps/web/public/screens/sessions.webp" }],
		args: ["--continue"],
		from: "Document the setting in docs/settings.md",
		setup(project) {
			const s = seed(project);
			s.user("Add a retry wrapper around the fetch calls in the provider layer");
			const first = s.say("I'll wrap the shared request helper so every provider gets retries.");
			s.user("Use exponential backoff with jitter");
			s.say("Done: `withRetry` now backs off 200ms, 400ms, 800ms with 20% jitter.");
			s.user("Now add tests for the retry timing");
			s.say("Added three tests using fake timers.");
			s.branch(first);
			s.user("Actually, keep it simple: fixed 500ms delay, three attempts");
			s.say("Switched `withRetry` to a fixed 500ms delay with three attempts.");
			s.user("Document the setting in docs/settings.md");
			s.say("Added a `retry` section to the settings reference.");
		},
		drive: openCommand("/tree"),
	},
	tree: {
		outputs: [{ path: "packages/cli/docs/images/tree-view.png" }],
		rows: 80,
		args: ["--continue"],
		from: "Session Tree",
		to: /^\s*\(\d+\/\d+\)/,
		setup(project) {
			const s = seed(project);
			s.user("The retry helper waits twice on a 429. Can you find out why?");
			s.tools(
				["read", { path: "packages/ai/src/api/retry.ts" }],
				["grep", { pattern: "retryAfter", path: "packages/ai/src" }],
			);
			const found = s.say("Found it: the Retry-After header is honored and then the backoff timer runs on top of it.");
			s.user("Fix it and add a regression test");
			s.tools(
				["edit", { path: "packages/ai/src/api/retry.ts" }],
				["write", { path: "packages/ai/test/retry-after.test.ts" }],
				["bash", { command: "bun x vitest --run test/retry-after.test.ts" }],
			);
			s.say("Fixed. The header now replaces the backoff delay, and a test covers it.");
			s.user("Also note it in the changelog");
			s.tools(["bash", { command: "bun run changeset fixed patch" }], ["edit", { path: ".changeset/retry-after.md" }]);
			const noted = s.say("Added a changeset entry under Fixed.");
			s.branch(found);
			s.user("Actually, keep the current behavior and log a warning instead");
			s.tools(
				["read", { path: "packages/ai/src/api/retry.ts" }],
				["edit", { path: "packages/ai/src/api/retry.ts" }],
				["bash", { command: "bun run check-types" }],
			);
			s.say("Done. Retry now logs `retry-after and backoff both applied` and behaves as before.");
			s.user("Split that warning into its own helper");
			s.tools(
				["edit", { path: "packages/ai/src/api/retry.ts" }],
				["write", { path: "packages/ai/src/api/retry-log.ts" }],
				["bash", { command: "git add packages/ai/src/api && git status --short" }],
			);
			s.say("Extracted `logRetryOverlap()` into retry-log.ts.");
			s.branch(noted);
			s.user("Open a PR for the fix");
			s.tools(
				["bash", { command: "git push -u origin fix/retry-after" }],
				["bash", { command: "gh pr create --fill" }],
			);
			s.say("Opened the pull request.");
		},
		drive: openCommand("/tree"),
	},
	providers: {
		outputs: [{ path: "apps/web/public/screens/providers.webp" }],
		args: ["Which providers can I use?"],
		from: "Which providers can I use?",
		turns: [
			reply(
				4700,
				text(
					"Run `/login` to sign in with a subscription or add an API key, then `/model` to pick a model from any provider you have connected.",
				),
			),
		],
		async drive(d) {
			await openCommand("/login")(d);
			// Past the sign-in method picker to the API key providers.
			await d.press("down");
			await d.press("enter");
			await d.settle();
		},
	},
	extensions: {
		outputs: [{ path: "apps/web/public/screens/extensions.webp" }],
		args: [],
		from: "context",
		setup(project) {
			const dir = join(project, ".knightcode");
			mkdirSync(join(dir, "skills", "release-notes"), { recursive: true });
			mkdirSync(join(dir, "prompts"));
			mkdirSync(join(dir, "extensions"));
			writeFileSync(
				join(dir, "skills", "release-notes", "SKILL.md"),
				"---\nname: release-notes\ndescription: Draft release notes from the commits since the last tag.\n---\n\nList the commits since the last tag and group them by package.\n",
			);
			writeFileSync(
				join(dir, "prompts", "review.md"),
				"---\ndescription: Review the working tree\n---\n\nReview the uncommitted changes for bugs.\n",
			);
			writeFileSync(
				join(dir, "extensions", "hello.ts"),
				'export default function (knightcode) {\n\tknightcode.registerCommand("hello", {\n\t\tdescription: "Say hello",\n\t\thandler: async (args, ctx) => ctx.ui.notify(`Hello, ${args || "world"}!`, "info"),\n\t});\n}\n',
			);
		},
		async drive(d) {
			await d.press("ctrlO");
			await d.settle();
			await d.type("/hello Ada");
			await d.press("enter");
			await d.settle();
		},
	},
	themes: {
		outputs: [{ path: "apps/web/public/screens/themes.webp" }],
		args: ["Show me the greet function"],
		from: "Show me the greet function",
		turns: [
			reply(
				4700,
				text(
					"Here is the change:\n\n```ts\nexport function greet(name: string): string {\n\treturn `Hello, ${name}`;\n}\n```\n\nIt returns a greeting and keeps `farewell` as is.",
				),
			),
		],
		async drive(d) {
			await openCommand("/settings")(d);
			await d.type("theme");
			await d.settle(400);
			await d.press("enter");
			await d.settle();
		},
	},
};

function openCommand(command: string) {
	return async (d: Driver) => {
		await d.type(command);
		await d.settle(400);
		await d.press("enter");
		await d.settle();
	};
}

// ---- mock Anthropic stream ------------------------------------------------------------------------------------------

type SseEvent = [string, Record<string, unknown>];
type Block = { block: Record<string, unknown>; deltas: Record<string, unknown>[] };

function thinking(value: string): Block {
	return {
		block: { type: "thinking", thinking: "" },
		deltas: [
			{ type: "thinking_delta", thinking: value },
			{ type: "signature_delta", signature: "sig" },
		],
	};
}

function text(value: string): Block {
	return { block: { type: "text", text: "" }, deltas: [{ type: "text_delta", text: value }] };
}

function toolUse(name: string, input: unknown): Block {
	return {
		block: { type: "tool_use", id: `toolu_${++toolIds}`, name, input: {} },
		deltas: [{ type: "input_json_delta", partial_json: JSON.stringify(input) }],
	};
}

function reply(inputTokens: number, ...blocks: Block[]): string {
	const events: SseEvent[] = [
		[
			"message_start",
			{
				type: "message_start",
				message: {
					id: "msg",
					type: "message",
					role: "assistant",
					model: MODEL,
					content: [],
					stop_reason: null,
					usage: { input_tokens: inputTokens, output_tokens: 1, cache_read_input_tokens: 3800 },
				},
			},
		],
	];
	blocks.forEach(({ block, deltas }, index) => {
		events.push(["content_block_start", { type: "content_block_start", index, content_block: block }]);
		for (const delta of deltas) events.push(["content_block_delta", { type: "content_block_delta", index, delta }]);
		events.push(["content_block_stop", { type: "content_block_stop", index }]);
	});
	const stopReason = blocks.some((b) => b.block.type === "tool_use") ? "tool_use" : "end_turn";
	events.push(
		["message_delta", { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 42 } }],
		["message_stop", { type: "message_stop" }],
	);
	return events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

// ---- seeded sessions ------------------------------------------------------------------------------------------------

function seed(project: string) {
	const sm = SessionManager.create(project);
	const usage = {
		input: 4000,
		output: 60,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 4060,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	let time = Date.now() - 3_600_000;
	let ids = 0;
	const assistant = (content: unknown[], stopReason: string) =>
		sm.appendMessage({
			role: "assistant",
			content,
			api: "anthropic-messages",
			provider: "anthropic",
			model: MODEL,
			usage,
			stopReason,
			timestamp: (time += 20_000),
		} as never);
	return {
		user: (content: string) => sm.appendMessage({ role: "user", content, timestamp: (time += 20_000) }),
		say: (content: string) => assistant([{ type: "text", text: content }], "stop"),
		branch: (id: string) => sm.branch(id),
		tools(...calls: Array<[string, Record<string, string>]>) {
			const content = calls.map(([name, args]) => ({ type: "toolCall", id: `tc${++ids}`, name, arguments: args }));
			assistant(content, "toolUse");
			for (const call of content) {
				sm.appendMessage({
					role: "toolResult",
					toolCallId: call.id,
					toolName: call.name,
					content: [{ type: "text", text: "ok" }],
					isError: false,
					timestamp: (time += 2_000),
				} as never);
			}
		},
	};
}

function git(cwd: string, ...args: string[]): void {
	execFileSync("git", ["-c", "user.name=KnightCode", "-c", "user.email=demo@knightcode.dev", ...args], { cwd });
}

// ---- child: run one scene inside a headless xterm -------------------------------------------------------------------

const KEYS = { enter: "\r", down: "\x1b[B", up: "\x1b[A", esc: "\x1b", ctrlO: "\x0f" };

interface Row {
	text: string;
	html: string;
}

async function runScene(name: string): Promise<void> {
	const scene = SCENES[name];
	const project = process.cwd();
	const agentDir = process.env.KNIGHTCODE_CODING_AGENT_DIR as string;
	const out = process.env.SHOT_OUT as string;
	const rows = scene.rows ?? 60;

	writeFileSync(join(project, "AGENTS.md"), "# Rules\n");
	mkdirSync(join(project, "src"), { recursive: true });
	git(project, "init", "-q", "-b", "main");
	git(project, "config", "core.autocrlf", "false");
	scene.setup?.(project);
	// Commit the fixture so the footer's git status shows only what the scene changes.
	git(project, "add", ".");
	git(project, "commit", "-q", "-m", "init");

	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const body = (await request.json()) as { messages: Array<{ role: string }> };
			const turns = scene.turns ?? [reply(1000, text("ok"))];
			const index = body.messages.filter((m) => m.role === "assistant").length;
			return new Response(turns[Math.min(index, turns.length - 1)], {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	writeFileSync(
		join(agentDir, "models.json"),
		JSON.stringify({ providers: { anthropic: { baseUrl: `http://localhost:${server.port}` } } }),
	);
	// A stored key, so /login lists Anthropic the way it does for a user who signed in.
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ anthropic: { type: "api_key", key: "demo" } }));
	writeFileSync(
		join(agentDir, "settings.json"),
		JSON.stringify({
			theme: "dark",
			defaultProvider: "anthropic",
			defaultModel: MODEL,
			defaultThinkingLevel: "medium",
			...scene.settings,
		}),
	);
	writeFileSync(join(agentDir, "trust.json"), JSON.stringify({ [canonicalizePath(project)]: true }));

	// Everything KnightCode writes to the terminal lands in the xterm, and the xterm's replies to terminal queries go
	// back in as keyboard input, as they would from a real terminal.
	const term = new xterm.Terminal({ cols: COLS, rows, scrollback: 5000, allowProposedApi: true });
	let lastWrite = Date.now();
	for (const [key, value] of [
		["columns", COLS],
		["rows", rows],
		["isTTY", true],
	] as const) {
		Object.defineProperty(process.stdout, key, { value, configurable: true });
	}
	process.stdout.write = ((chunk: string | Uint8Array) => {
		lastWrite = Date.now();
		term.write(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
		return true;
	}) as typeof process.stdout.write;
	Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
	(process.stdin as unknown as { setRawMode: () => unknown }).setRawMode = () => process.stdin;
	const send = (data: string) => process.stdin.emit("data", data);
	term.onData(send);

	const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
	const driver: Driver = {
		async settle(quietMs = 1000) {
			const began = Date.now();
			await sleep(quietMs);
			while (Date.now() - lastWrite < quietMs && Date.now() - began < 30_000) await sleep(100);
		},
		async type(value) {
			for (const ch of value) {
				send(ch);
				await sleep(20);
			}
		},
		async press(key, times = 1) {
			for (let i = 0; i < times; i++) {
				send(KEYS[key]);
				await sleep(80);
			}
		},
	};

	const dump = () => {
		const buffer = term.buffer.active;
		const cell = buffer.getNullCell();
		const lines: Row[] = [];
		for (let y = 0; y < buffer.length; y++) {
			const line = buffer.getLine(y);
			if (!line) continue;
			let html = "";
			for (let x = 0; x < COLS; x++) {
				line.getCell(x, cell);
				const width = cell.getWidth();
				if (width === 0) continue;
				let fg = cell.isFgRGB() ? hex(cell.getFgColor()) : cell.isFgPalette() ? palette(cell.getFgColor()) : "";
				let bg = cell.isBgRGB() ? hex(cell.getBgColor()) : cell.isBgPalette() ? palette(cell.getBgColor()) : "";
				if (cell.isInverse()) [fg, bg] = [bg || BG, fg || FG];
				let chars = cell.getChars() || " ";
				// Half blocks become two-tone backgrounds: a glyph would leave gaps at the taller line height.
				let background = bg;
				if (chars === "▀" || chars === "▄") {
					const [top, bottom] = chars === "▀" ? [fg || FG, bg || "transparent"] : [bg || "transparent", fg || FG];
					background = `linear-gradient(${top} 50%,${bottom} 50%)`;
					chars = " ";
				}
				const style = [
					fg && `color:${fg}`,
					background && `background:${background}`,
					width === 2 && "width:2ch",
					cell.isBold() && "font-weight:700",
					cell.isItalic() && "font-style:italic",
					cell.isDim() && "opacity:.6",
					cell.isUnderline() && "text-decoration:underline",
				].filter(Boolean);
				const ch = escapeHtml(chars);
				html += style.length ? `<span style="${style.join(";")}">${ch}</span>` : `<span>${ch}</span>`;
			}
			lines.push({ text: line.translateToString(true), html });
		}
		writeFileSync(out, JSON.stringify(lines));
	};

	const deadline = setTimeout(() => {
		dump();
		process.stderr.write(`scene ${name} did not finish in time; dumped what was on screen\n`);
		process.exit(1);
	}, 90_000);
	void (async () => {
		await driver.settle(2500);
		await scene.drive?.(driver);
		clearTimeout(deadline);
		dump();
		process.exit(0);
	})();
	await main([...scene.args, "--offline"]);
}

function hex(color: number): string {
	return `#${color.toString(16).padStart(6, "0")}`;
}

const ANSI16 = [
	"#000000",
	"#cd3131",
	"#0dbc79",
	"#e5e510",
	"#2472c8",
	"#bc3fbc",
	"#11a8cd",
	"#e5e5e5",
	"#666666",
	"#f14c4c",
	"#23d18b",
	"#f5f543",
	"#3b8eea",
	"#d670d6",
	"#29b8db",
	"#ffffff",
];

function palette(n: number): string {
	if (n < 16) return ANSI16[n];
	if (n >= 232) {
		const v = 8 + (n - 232) * 10;
		return `rgb(${v},${v},${v})`;
	}
	const level = (x: number) => (x === 0 ? 0 : 55 + x * 40);
	const i = n - 16;
	return `rgb(${level(Math.floor(i / 36))},${level(Math.floor(i / 6) % 6)},${level(i % 6)})`;
}

function escapeHtml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---- parent: run scenes, then capture them --------------------------------------------------------------------------

function crop(rows: Row[], scene: Scene): Row[] {
	const start = scene.from ? rows.findIndex((r) => r.text.includes(scene.from as string)) : 0;
	if (start < 0) throw new Error(`no row contains ${JSON.stringify(scene.from)}`);
	let end = rows.length - 1;
	if (scene.to) {
		end = rows.findLastIndex((r) => (scene.to as RegExp).test(r.text));
		if (end < start) throw new Error(`no row after the start matches ${scene.to}`);
	}
	// The editor sits at the bottom of the terminal. Shrink the run of empty rows that holds it there to one row; the
	// transcript itself never leaves more than two.
	const picked: Row[] = [];
	let blanks = 0;
	for (const row of rows.slice(start, end + 1)) {
		blanks = row.text.trim() ? 0 : blanks + 1;
		picked.push(row);
		if (blanks === 3) picked.splice(-2);
		if (blanks > 3) picked.pop();
	}
	while (picked.length && !picked[0].text.trim()) picked.shift();
	while (picked.length && !picked[picked.length - 1].text.trim()) picked.pop();
	return picked;
}

function frame(rows: Row[], chrome: boolean): string {
	const bar = chrome
		? '<div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><div class="title">KnightCode - knightcode</div></div>'
		: "";
	return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}
body{padding:1px}
.win{width:fit-content;background:${BG};overflow:hidden${chrome ? ";border-radius:14px;box-shadow:0 0 0 1px #3a3b44" : ""}}
.bar{height:40px;display:flex;align-items:center;gap:8px;padding:0 16px;background:#2a2b33;position:relative}
.bar i{width:13px;height:13px;border-radius:50%}
.title{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:600 14px -apple-system,"Segoe UI",sans-serif;color:#b9bac4}
pre{margin:0;padding:14px 12px 18px;font:15px/1.45 "Cascadia Mono","JetBrains Mono",Menlo,Consolas,monospace;color:${FG}}
.l{height:1.45em;white-space:pre}.l span{display:inline-block;width:1ch;height:100%;vertical-align:top}
</style><div class="win">${bar}<pre>${rows.map((r) => `<div class="l">${r.html}</div>`).join("")}</pre></div>`;
}

function findBrowser(): string {
	const candidates = [
		process.env.CHROME_PATH,
		"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
		"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
		"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		...["google-chrome", "chromium", "chromium-browser", "microsoft-edge"].map((name) => Bun.which(name)),
	];
	const found = candidates.find((path) => path && existsSync(path));
	if (!found) throw new Error("no Chrome or Edge found; set CHROME_PATH");
	return found;
}

/** A headless browser page driven over the DevTools protocol. */
async function openBrowser() {
	const profile = mkdtempSync(join(tmpdir(), "knightcode-shot-browser-"));
	const browser = spawn(
		findBrowser(),
		["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--hide-scrollbars", "about:blank"],
		{ stdio: "ignore" },
	);
	const portFile = join(profile, "DevToolsActivePort");
	for (let i = 0; !existsSync(portFile) || !readFileSync(portFile, "utf8").includes("\n"); i++) {
		if (i > 100) throw new Error("the browser did not open a DevTools port");
		await Bun.sleep(100);
	}
	const port = readFileSync(portFile, "utf8").split("\n")[0];
	const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{
		type: string;
		webSocketDebuggerUrl: string;
	}>;
	const page = targets.find((t) => t.type === "page");
	if (!page) throw new Error("the browser has no page target");
	const socket = new WebSocket(page.webSocketDebuggerUrl);
	await new Promise((ok, fail) => {
		socket.onopen = ok;
		socket.onerror = fail;
	});
	let nextId = 0;
	const pending = new Map<number, { ok: (value: unknown) => void; fail: (error: Error) => void }>();
	socket.onmessage = (event) => {
		const message = JSON.parse(String(event.data));
		const waiter = pending.get(message.id);
		if (!waiter) return;
		pending.delete(message.id);
		if (message.error) waiter.fail(new Error(message.error.message));
		else waiter.ok(message.result);
	};
	const call = <T>(method: string, params: Record<string, unknown> = {}) =>
		new Promise<T>((ok, fail) => {
			const id = ++nextId;
			pending.set(id, { ok: ok as (value: unknown) => void, fail });
			socket.send(JSON.stringify({ id, method, params }));
		});

	await call("Emulation.setDeviceMetricsOverride", { width: 1400, height: 1000, deviceScaleFactor: 2, mobile: false });
	await call("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

	return {
		async capture(htmlPath: string, outPath: string): Promise<{ width: number; height: number }> {
			await call("Page.navigate", { url: pathToFileURL(htmlPath).href });
			const { result } = await call<{ result: { value: string } }>("Runtime.evaluate", {
				expression:
					"new Promise(r => (document.readyState === 'complete' ? r() : addEventListener('load', r))).then(() => document.fonts.ready).then(() => JSON.stringify(document.querySelector('.win').getBoundingClientRect()))",
				awaitPromise: true,
				returnByValue: true,
			});
			const box = JSON.parse(result.value) as { x: number; y: number; width: number; height: number };
			const png = outPath.endsWith(".png");
			const { data } = await call<{ data: string }>("Page.captureScreenshot", {
				format: png ? "png" : "webp",
				...(png ? {} : { quality: 92 }),
				clip: { ...box, scale: 1 },
				captureBeyondViewport: true,
			});
			writeFileSync(outPath, Buffer.from(data, "base64"));
			return { width: Math.round(box.width * 2), height: Math.round(box.height * 2) };
		},
		async close() {
			socket.close();
			const exited = new Promise((r) => browser.once("exit", r));
			browser.kill();
			await exited;
			rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
		},
	};
}

/** fd and rg, copied into each scene's tools dir so offline startup does not warn that they are missing. */
function findTools(): Record<string, string> {
	const ext = process.platform === "win32" ? ".exe" : "";
	const tools: Record<string, string> = {};
	for (const tool of ["fd", "rg"]) {
		const path = [join(homedir(), ".knightcode", "agent", "bin", tool + ext), Bun.which(tool)].find(
			(p) => p && existsSync(p),
		);
		if (!path) throw new Error(`${tool} not found; run knightcode once online so it installs ${tool}`);
		tools[tool + ext] = path;
	}
	return tools;
}

/** The child sees only what it needs: no provider keys from the shell or the repo's .env. */
function childEnv(home: string, out: string): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined && /^(path|pathext|systemroot|windir|comspec|temp|tmp|lang|programfiles.*)$/i.test(key)) {
			env[key] = value;
		}
	}
	return {
		...env,
		HOME: home,
		USERPROFILE: home,
		KNIGHTCODE_CODING_AGENT_DIR: join(home, ".knightcode", "agent"),
		KNIGHTCODE_OFFLINE: "1",
		COLORTERM: "truecolor",
		TERM: "xterm-256color",
		SHOT_OUT: out,
	};
}

async function captureAll(names: string[]): Promise<void> {
	const unknown = names.filter((n) => !SCENES[n]);
	if (unknown.length) throw new Error(`unknown scene ${unknown.join(", ")}; known: ${Object.keys(SCENES).join(", ")}`);
	const selected = names.length ? names : Object.keys(SCENES);
	const work = join(tmpdir(), "knightcode-screenshots");
	rmSync(work, { recursive: true, force: true });
	const tools = findTools();
	const browser = await openBrowser();
	const failed: string[] = [];
	try {
		for (const name of selected) {
			const home = join(work, name);
			const project = join(home, "workspaces", "knightcode");
			const bin = join(home, ".knightcode", "agent", "bin");
			mkdirSync(project, { recursive: true });
			mkdirSync(bin, { recursive: true });
			for (const [file, from] of Object.entries(tools)) copyFileSync(from, join(bin, file));
			const dumpPath = join(work, `${name}.json`);
			// --no-env-file: Bun would otherwise load a .env it finds next to the script.
			const run = spawnSync(process.execPath, ["--no-env-file", import.meta.path, "--scene", name], {
				cwd: project,
				env: childEnv(home, dumpPath),
				encoding: "utf8",
				timeout: 120_000,
			});
			try {
				if (run.status !== 0 || !existsSync(dumpPath)) throw new Error(`exit ${run.status}\n${run.stderr}`);
				const rows = crop(JSON.parse(readFileSync(dumpPath, "utf8")) as Row[], SCENES[name]);
				for (const output of SCENES[name].outputs) {
					const htmlPath = join(work, `${name}${output.chrome ? "-chrome" : ""}.html`);
					writeFileSync(htmlPath, frame(rows, output.chrome ?? false));
					const size = await browser.capture(htmlPath, join(REPO, output.path));
					console.log(`${output.path}  ${size.width}x${size.height}`);
				}
			} catch (error) {
				failed.push(name);
				console.error(`${name}: ${error instanceof Error ? error.message : error}`);
			}
		}
	} finally {
		await browser.close();
	}
	if (failed.length) {
		console.error(`failed: ${failed.join(", ")}; the HTML and dumps are in ${work}`);
		process.exit(1);
	}
}

if (process.argv[2] === "--scene") await runScene(process.argv[3]);
else await captureAll(process.argv.slice(2));
