import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel as AgentThinkingLevel } from "@knightcode/agent";
import type { Static, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { describe, expect, test } from "vitest";
import {
	checkView,
	ClientNotifications,
	ClientRequests,
	Item,
	schemaDocument,
	ServerNotifications,
	GitConflictReason,
	ServerRequests,
	type ThinkingLevel,
	UiSnapshot,
	type View,
	View as ViewSchema,
	VIEW_MAX_DEPTH,
	WIDGET_MAX_BYTES,
} from "../src/index.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const thinkingLevelsAgree: Same<Static<typeof ThinkingLevel>, AgentThinkingLevel> = true;

const thread = {
	id: "t1",
	cwd: "/p",
	projectCwd: "/p",
	name: "fix it",
	status: { type: "idle" },
	createdAt: "2026-10-11T00:00:00.000Z",
	archived: false,
	updatedAt: "2026-10-11T00:00:00.000Z",
	workspace: { mode: "local" },
	approvalMode: "ask",
	thinkingLevel: "off",
};
const summary = {
	id: "t1",
	cwd: "/p",
	projectCwd: "/p",
	name: "fix it",
	status: { type: "notLoaded" },
	createdAt: "2026-10-11T00:00:00.000Z",
	archived: false,
	updatedAt: "2026-10-11T00:00:00.000Z",
	workspaceMode: "worktree",
};
const worktreeThread = {
	...thread,
	workspace: { mode: "worktree", path: "/w/ab12/p", baseRef: "0123abcd", ownerThreadId: "t1", environment: "dev" },
};
const comment = { scope: "uncommitted", path: "a.txt", side: "new", startLine: 2, endLine: 2, body: "rename this" };
const environment = {
	name: "dev",
	setup: { default: "bun install", windows: "bun install --no-save" },
	cleanup: { default: 'rm -rf "$KNIGHTCODE_WORKTREE_PATH/.cache"' },
	actions: [{ name: "Test", icon: "play", command: { default: "bun test" } }],
};
const diffFile = {
	path: "a.txt",
	status: "modified",
	binary: false,
	additions: 1,
	deletions: 1,
	hunks: [
		{
			id: "h1",
			header: "@@ -1,3 +1,3 @@",
			oldStart: 1,
			oldLines: 3,
			newStart: 1,
			newLines: 3,
			lines: [" one", "-two", "+TWO", " three"],
		},
	],
};
const turn = { id: "m1", threadId: "t1", status: "completed", startedAt: 1, completedAt: 2, items: [] };
const item = { type: "agentMessage", id: "m1:0:0", text: "hi", startedAt: 1, completedAt: 2 };
const usage = { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 15, contextWindow: 1000 };
const login = { status: "pending", loginId: "l1", events: [] };
const table = { type: "table", columns: ["test", "result"], rows: [["parser", "failed"]] };
const ui = {
	statuses: [{ key: "tests", text: "✓ 42 passed" }],
	title: "watching",
	workingMessage: "Running tests",
	workingVisible: true,
	widgets: [
		{ key: "tests", placement: "aboveEditor", lines: ["2 failing"] },
		{ key: "checks", placement: "belowEditor", view: { type: "button", id: "reset", label: "Reset" } },
	],
};

// One valid example per message. A message without an example fails the coverage test below.
const backgroundShell = { id: "ab12cd34", command: "npm run dev", cwd: "/p", status: "running", startedAt: 1 };

const requestParams: Record<string, unknown> = {
	initialize: {
		clientInfo: { name: "test", version: "1" },
		capabilities: { optOutNotifications: ["item/reasoning/delta"] },
	},
	"server/diagnostics": {},
	"thread/start": {
		cwd: "/p",
		workspace: { mode: "worktree", baseRef: "main", environment: "dev" },
		approvalMode: "ask",
		model: { provider: "faux", id: "m" },
		thinkingLevel: "low",
	},
	"thread/resume": { threadId: "t1", cursor: "opaque-history-anchor" },
	"thread/fork": { threadId: "t1", atItemId: "m1:user:0", workspace: { mode: "worktree" } },
	"thread/handoff": { threadId: "t1", to: "local", branch: "kc/fix-it", environment: "dev", dryRun: true },
	"thread/worktree/restore": { threadId: "t1" },
	"worktree/list": { cwd: "/p" },
	"worktree/delete": { path: "/w/ab12/p" },
	"environment/list": { cwd: "/p" },
	"environment/save": { cwd: "/p", environments: [environment] },
	"thread/diff/read": { threadId: "t1", scope: "branch", against: "main", context: 3, ignoreWhitespace: true },
	"thread/diff/file": { threadId: "t1", fromTree: "4b825dc6", toTree: "9a1b2c3d", path: "b.txt", oldPath: "a.txt" },
	"file/read": { threadId: "t1", path: "src/a.ts", maxBytes: 1024 },
	"file/list": { threadId: "t1", path: "src" },
	"file/write": { threadId: "t1", path: "src/a.ts", text: "x=2\n", expectedMtimeMs: 1_700_000_000_000 },
	"mcp/app/readResource": { threadId: "t1", server: "weather", uri: "ui://weather/forecast.html" },
	"mcp/app/callTool": {
		threadId: "t1",
		server: "weather",
		name: "refresh",
		arguments: { city: "Oslo" },
		confirmed: true,
	},
	"thread/diff/revert": { threadId: "t1", scope: "uncommitted", path: "a.txt", hunkId: "h1", context: 3 },
	"git/status": { threadId: "t1" },
	"git/origin": { threadId: "t1" },
	"git/stage": { threadId: "t1", path: "a.txt" },
	"git/unstage": { threadId: "t1", path: "a.txt", hunkId: "h1" },
	"git/commit": { threadId: "t1", message: "fix it", includeUnstaged: false },
	"git/push": { threadId: "t1" },
	"git/pr/create": { threadId: "t1", title: "Fix it", body: "Body", draft: true },
	"git/branch/create": { threadId: "t1", name: "kc/fix-it" },
	"git/branch/switch": { threadId: "t1", name: "main" },
	"git/branches": { cwd: "/p" },
	"git/log": { threadId: "t1", limit: 50 },
	"thread/list": { cwd: "/p", cursor: "opaque-list-snapshot", archived: false },
	"thread/read": { threadId: "t1", cursor: "opaque-history-anchor" },
	"thread/unsubscribe": { threadId: "t1" },
	"thread/delete": { threadId: "t1" },
	"thread/archive": { threadId: "t1" },
	"thread/unarchive": { threadId: "t1" },
	"thread/name/set": { threadId: "t1", name: "n" },
	"thread/settings/update": { threadId: "t1", thinkingLevel: "high", approvalMode: "fullAccess" },
	"thread/compact": { threadId: "t1", instructions: "keep the plan" },
	"thread/backgroundShells/list": { threadId: "t1" },
	"thread/backgroundShells/output": { threadId: "t1", id: "ab12cd34" },
	"thread/backgroundShells/stop": { threadId: "t1", id: "ab12cd34" },
	"turn/start": {
		threadId: "t1",
		text: "hi",
		clientMessageId: "c1",
		images: [{ path: "/p/shot.png" }],
		comments: [comment],
	},
	"turn/steer": {
		threadId: "t1",
		expectedTurnId: "m1",
		text: "also this",
		images: [{ mimeType: "image/png", data: "AA==" }],
	},
	"turn/queue/add": { threadId: "t1", text: "then this", clientMessageId: "c2", comments: [comment] },
	"turn/queue/remove": { threadId: "t1", queueId: "q1" },
	"turn/interrupt": { threadId: "t1" },
	"payload/read": { id: "issued-payload-id", offset: 0, maxBytes: 49152 },
	"file/search": { cwd: "/p", query: "thrds", searchId: "composer", limit: 50 },
	"model/list": {},
	"command/list": { threadId: "t1" },
	"config/read": { cwd: "/p" },
	"config/write": { scope: "global", key: "theme", value: "dark", expectedVersion: "none" },
	"tool/list": { cwd: "/p" },
	"tool/settings/read": {},
	"tool/settings/write": { name: "websearch", key: "provider", value: "brave" },
	"mcp/list": { cwd: "/p" },
	"mcp/update": { cwd: "/p", name: "docs", enabled: false, exposure: "direct" },
	"mcp/add": { scope: "global", name: "docs", config: { url: "https://example.com/mcp" } },
	"mcp/remove": { scope: "global", name: "docs" },
	"resource/list": { cwd: "/p" },
	"resource/set": { cwd: "/p", type: "skills", path: "/home/u/.knightcode/agent/skills/a/SKILL.md", enabled: false },
	"plugin/list": { cwd: "/p" },
	"plugin/install": { scope: "global", source: "acme/tools", ref: "v1", trust: false },
	"plugin/set": { scope: "project", cwd: "/p", name: "tools", enabled: true, trust: true },
	"plugin/update": { scope: "global", name: "tools" },
	"plugin/uninstall": { scope: "global", name: "tools@shop" },
	"plugin/marketplace/list": {},
	"plugin/marketplace/add": { scope: "global", source: "acme/marketplace" },
	"plugin/marketplace/update": { name: "shop" },
	"plugin/marketplace/remove": { scope: "global", name: "shop" },
	"project/trust/read": { cwd: "/p" },
	"project/trust/set": { cwd: "/p", trusted: true },
	"account/list": {},
	"account/login/start": { provider: "anthropic", type: "oauth" },
	"account/login/answer": { loginId: "l1", value: "code" },
	"account/login/cancel": { loginId: "l1" },
	"account/logout": { provider: "anthropic" },
	"ui/event": { threadId: "t1", widgetKey: "checks", id: "verbose", value: true },
};
const pluginInfo = {
	name: "Tools",
	namespace: "tools",
	identity: "https://github.com/acme/tools",
	scope: "global",
	source: "acme/tools",
	ref: "v1",
	commit: "a".repeat(40),
	enabled: true,
	trusted: false,
	active: false,
	skills: ["tools:fix"],
	commands: ["tools:review"],
	mcpServers: [{ name: "api", target: "node server.js" }],
	environment: ["API_TOKEN"],
	unsupported: ["hooks"],
	warnings: [],
};
const marketplaceInfo = {
	name: "shop",
	scope: "global",
	source: "acme/marketplace",
	commit: "b".repeat(40),
	updatedAt: "2026-10-28T00:00:00.000Z",
	plugins: [{ name: "tools", description: "Tools", installed: true }],
	diagnostics: [],
};
const requestResults: Record<string, unknown> = {
	initialize: {
		serverInfo: { name: "knightcode", version: "0.0.0" },
		platform: { os: "linux", arch: "x64", homeDir: "/home/u" },
	},
	"server/diagnostics": {
		rssBytes: 1,
		heapBytes: 1,
		loadedThreads: 0,
		loadingThreads: 0,
		payloadFiles: 0,
		payloadBytes: 0,
		inactiveFactories: 0,
		uptimeMs: 1,
		listingFilesOpened: 0,
		listingBytesScanned: 0,
	},
	"thread/start": { thread, warnings: [], ui },
	"thread/resume": {
		thread,
		ui,
		turns: [turn],
		queue: { steering: [], followUp: [] },
		usage,
		warnings: [],
		nextCursor: "opaque-history-anchor",
	},
	"thread/fork": { thread: worktreeThread, warnings: [], ui },
	"thread/handoff": { thread, branch: "kc/fix-it", warnings: [] },
	"thread/worktree/restore": { thread: worktreeThread },
	"worktree/list": {
		worktrees: [
			{
				path: "/w/ab12/p",
				projectCwd: "/p",
				head: "0123abcd",
				branch: "kc/fix-it",
				threadIds: ["t1"],
				lastUsedAt: 1,
				deleted: false,
			},
		],
	},
	"worktree/delete": { snapshot: "4567cdef" },
	"environment/list": { environments: [environment], trusted: true },
	"environment/save": {},
	"thread/diff/read": {
		scope: "lastTurn",
		root: "/repo",
		files: [diffFile],
		filesOmitted: 0,
		untrackedSkipped: 0,
		turnId: "m1",
		fromTree: "4b825dc6",
		toTree: "9a1b2c3d",
	},
	"thread/diff/file": { old: "one\n", new: "two\n", binary: false, tooLarge: false },
	"file/read": {
		path: "/p/src/a.ts",
		size: 4,
		binary: false,
		tooLarge: false,
		text: "x=1\n",
		mtimeMs: 1_700_000_000_000,
	},
	"file/list": {
		root: "/p",
		entries: [
			{ path: "src/a.ts", type: "file" },
			{ path: "src/lib", type: "directory" },
		],
		truncated: false,
	},
	"file/write": { mtimeMs: 1_700_000_000_500 },
	"mcp/app/readResource": {
		contents: [{ uri: "ui://weather/forecast.html", mimeType: "text/html;profile=mcp-app", text: "<p>x</p>" }],
	},
	"mcp/app/callTool": { content: [{ type: "text", text: "12 C" }], structuredContent: { celsius: 12 } },
	"thread/diff/revert": { paths: ["a.txt"] },
	"git/status": {
		branch: "main",
		head: "0123abcd",
		upstream: "origin/main",
		ahead: 1,
		behind: 0,
		staged: 1,
		unstaged: 2,
		untracked: 3,
		conflicted: 0,
		operation: "merge",
	},
	"git/origin": { root: "/repo", url: "git@github.com:owner/repo.git", branch: "main" },
	"git/stage": { paths: ["a.txt"] },
	"git/unstage": { paths: ["a.txt"] },
	"git/commit": { commit: "89abcdef", message: "fix it" },
	"git/push": { remote: "origin", branch: "kc/fix-it", setUpstream: true },
	"git/pr/create": { url: "https://github.com/o/r/pull/1" },
	"git/branch/create": { branch: "kc/fix-it" },
	"git/branch/switch": { branch: "main" },
	"git/branches": { current: "main", defaultBranch: "main", branches: ["main", "kc/fix-it"] },
	"git/log": { base: "0123abcd", commits: [{ sha: "89abcdef", subject: "fix it", author: "Test", time: 1 }] },
	"thread/list": { threads: [summary], nextCursor: "opaque-list-snapshot" },
	"thread/read": { thread: summary, turns: [turn] },
	"thread/unsubscribe": { status: "unsubscribed" },
	"thread/delete": {},
	"thread/archive": { worktree: { deleted: true, snapshot: "4567cdef" } },
	"thread/unarchive": {},
	"thread/name/set": {},
	"thread/settings/update": { thread },
	"thread/compact": {},
	"thread/backgroundShells/list": { shells: [backgroundShell] },
	"thread/backgroundShells/output": { output: "\u001b[32mready\u001b[0m on :3000\n" },
	"thread/backgroundShells/stop": { stopped: true },
	"turn/start": { status: "started", threadId: "t1", requestId: "r1" },
	"turn/steer": {},
	"turn/queue/add": { queueId: "q2" },
	"turn/queue/remove": { removed: true },
	"turn/interrupt": {},
	"payload/read": { data: "e30=", eof: true },
	"file/search": { files: [{ path: "threads.ts", score: 5, indices: [0, 1, 2, 4, 6] }], truncated: false },
	"model/list": {
		models: [
			{
				provider: "faux",
				providerName: "Faux",
				id: "m",
				name: "M",
				contextWindow: 1000,
				maxTokens: 100,
				reasoning: false,
				thinkingLevels: ["off"],
				input: ["text"],
			},
		],
		default: null,
	},
	"command/list": { commands: [{ name: "plan", description: "Plan first" }] },
	"config/read": {
		settings: { theme: "dark" },
		defaults: { transport: "auto" },
		origins: { theme: "global" },
		versions: { global: "hash" },
		paths: { global: "/home/u/.knightcode/agent/settings.json" },
		errors: [],
	},
	"config/write": { version: "hash" },
	"tool/list": { tools: [{ name: "read", description: "Read a file", source: "builtin" }], defaultTools: ["read"] },
	"tool/settings/read": {
		tools: [{ name: "websearch", enabled: true, settings: { provider: "brave", braveApiKey: "••••abcd" } }],
		classifiers: [{ provider: "openrouter", id: "jev", name: "Jev" }],
	},
	"tool/settings/write": {},
	"mcp/list": {
		servers: [
			{
				name: "docs",
				scope: "global",
				source: "/home/u/.knightcode/agent/mcp.json",
				override: "/p/.knightcode/mcp.json",
				transport: "http",
				target: "https://example.com/mcp",
				enabled: false,
				exposure: "codemode",
			},
		],
		errors: [],
		paths: { global: "/home/u/.knightcode/agent/mcp.json", project: "/p/.knightcode/mcp.json" },
	},
	"mcp/update": {},
	"mcp/add": { replaced: false },
	"mcp/remove": { removed: true },
	"plugin/list": {
		plugins: [pluginInfo],
		diagnostics: ['plugin "x" is declared but not installed'],
		importable: [{ name: "beta", from: "Claude Code", source: "beta@shop", enabled: true }],
	},
	"plugin/install": { plugin: pluginInfo },
	"plugin/set": { plugin: pluginInfo },
	"plugin/update": { plugin: pluginInfo, changed: true },
	"plugin/uninstall": {},
	"plugin/marketplace/list": {
		marketplaces: [marketplaceInfo],
		available: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", from: "Anthropic" }],
	},
	"plugin/marketplace/add": { marketplace: marketplaceInfo },
	"plugin/marketplace/update": { marketplaces: [marketplaceInfo] },
	"plugin/marketplace/remove": {},
	"resource/list": {
		resources: [
			{
				type: "skills",
				path: "/home/u/.knightcode/agent/skills/a/SKILL.md",
				name: "a",
				enabled: true,
				scope: "user",
				origin: "top-level",
				source: "auto",
			},
		],
	},
	"resource/set": {},
	"project/trust/read": { trusted: null, needsTrust: true, project: "/p" },
	"project/trust/set": {},
	"account/list": {
		accounts: [{ provider: "anthropic", providerName: "Anthropic", type: "oauth", isSubscription: true }],
		loginOptions: [
			{ provider: "anthropic", providerName: "Anthropic", type: "oauth", label: "Claude", isSubscription: true },
		],
	},
	"account/login/start": { loginId: "l1" },
	"account/login/answer": {},
	"account/login/cancel": {},
	"account/logout": {},
	"ui/event": {},
};
const notificationParams: Record<string, unknown> = {
	initialized: {},
	"thread/started": { thread },
	"thread/replaced": { oldThreadId: "t0", thread },
	"thread/status/changed": { threadId: "t1", status: { type: "active", waitingOn: ["approval"] } },
	"thread/name/updated": { threadId: "t1", name: "n" },
	"thread/settings/updated": { thread },
	"thread/archived": { threadId: "t1", archived: true },
	"thread/deleted": { threadId: "t1" },
	"turn/diff/updated": { threadId: "t1", turnId: "m1", files: [{ path: "a.txt", additions: 1, deletions: 0 }] },
	"thread/workspace/progress": { threadId: "t1", phase: "setup", output: "installing" },
	"turn/started": { turn, requestId: "r1" },
	"turn/completed": { turn: { id: "m1", threadId: "t1", status: "completed", startedAt: 1, completedAt: 2 } },
	"thread/tokenUsage/updated": { threadId: "t1", turnId: "m1", usage },
	"thread/turn/completed": {
		turn: {
			id: "m1",
			threadId: "t1",
			status: "failed",
			startedAt: 1,
			completedAt: 2,
			error: { message: "boom", kind: "provider" },
		},
	},
	"turn/retry": { threadId: "t1", turnId: "m1", attempt: 1, maxAttempts: 3, delayMs: 1000, error: "overloaded" },
	"turn/queue/updated": { threadId: "t1", steering: ["a"], followUp: [{ id: "q1", text: "b" }] },
	"thread/backgroundShells/updated": {
		threadId: "t1",
		shells: [backgroundShell, { ...backgroundShell, id: "ef56", status: "failed", endedAt: 9, exitCode: 2 }],
	},
	"item/started": { threadId: "t1", turnId: "m1", item, index: 0 },
	"item/completed": { threadId: "t1", turnId: "m1", item, index: 0 },
	"item/removed": { threadId: "t1", turnId: "m1", itemId: "m1:0:1" },
	"item/agentMessage/delta": { threadId: "t1", turnId: "m1", itemId: "m1:0:0", delta: "h" },
	"item/reasoning/delta": { threadId: "t1", turnId: "m1", itemId: "m1:0:1", delta: "h" },
	"item/toolCall/outputDelta": {
		threadId: "t1",
		turnId: "m1",
		itemId: "call_1",
		output: [{ type: "text", text: "x" }],
	},
	"serverRequest/cancelled": { id: 3 },
	"ui/notify": { threadId: "t1", message: "Downloaded model", level: "info" },
	"ui/state": {
		threadId: "t1",
		statuses: [{ key: "tests", text: "✓ 42 passed" }],
		title: "watching",
		workingMessage: "Running tests",
		workingVisible: false,
	},
	"ui/widget": { threadId: "t1", key: "tests", placement: "aboveEditor", lines: ["2 failing"] },
	"account/login/updated": login,
	"account/updated": { provider: "anthropic", authenticated: true },
	warning: { message: "bad settings", source: "settings", path: "/p/settings.json", line: 3, column: 5 },
	error: { message: "bad line" },
};
const serverRequestParams: Record<string, unknown> = {
	"item/toolCall/requestApproval": {
		threadId: "t1",
		turnId: "m1",
		itemId: "call_1",
		tool: "bash",
		input: {},
		prefix: "echo",
		decisions: ["accept", "acceptPrefixForSession", "decline"],
	},
	"ui/dialog": { threadId: "t1", kind: "select", title: "Which name?", options: ["helpers", "utils"] },
	"item/toolCall/requestUserInput": {
		threadId: "t1",
		turnId: "m1",
		itemId: "call_2",
		questions: [
			{
				id: "name",
				question: "Which name?",
				options: [{ label: "helpers (Recommended)", description: "Shared helpers." }],
			},
		],
	},
};
const serverRequestResults: Record<string, unknown> = {
	"item/toolCall/requestApproval": { decision: "accept" },
	"ui/dialog": { value: "helpers" },
	"item/toolCall/requestUserInput": { answers: { name: { label: "helpers (Recommended)", note: "keep it short" } } },
};

function checkSchema(name: string, schema: TSchema, example: unknown): void {
	const check = Compile(schema);
	expect(check.Check(example), `${name} accepts its example`).toBe(true);
	if (typeof example !== "object" || example === null || Array.isArray(example)) return;
	expect(check.Check({ ...example, unknownMember: 1 }), `${name} rejects an unknown member`).toBe(false);
	const required = (schema as { required?: string[] }).required ?? [];
	if (required.length > 0) {
		const { [required[0]]: _dropped, ...missing } = example as Record<string, unknown>;
		expect(check.Check(missing), `${name} rejects a missing ${required[0]}`).toBe(false);
	}
}

describe("app server protocol", () => {
	test("ThinkingLevel matches @knightcode/agent", () => {
		expect(thinkingLevelsAgree).toBe(true);
	});

	test("every message has an example", () => {
		expect(Object.keys(requestParams).sort()).toEqual(Object.keys(ClientRequests).sort());
		expect(Object.keys(requestResults).sort()).toEqual(Object.keys(ClientRequests).sort());
		expect(Object.keys(notificationParams).sort()).toEqual(
			[...Object.keys(ClientNotifications), ...Object.keys(ServerNotifications)].sort(),
		);
		expect(Object.keys(serverRequestParams).sort()).toEqual(Object.keys(ServerRequests).sort());
	});

	test("client requests accept valid params and results and reject malformed ones", () => {
		for (const [method, { params, result }] of Object.entries(ClientRequests)) {
			checkSchema(`${method} params`, params, requestParams[method]);
			checkSchema(`${method} result`, result, requestResults[method]);
		}
	});

	test("notifications accept valid params and reject malformed ones", () => {
		for (const [method, params] of Object.entries({ ...ClientNotifications, ...ServerNotifications })) {
			checkSchema(method, params, notificationParams[method]);
		}
	});

	test("server requests accept valid params and results and reject malformed ones", () => {
		for (const [method, { params, result }] of Object.entries(ServerRequests)) {
			checkSchema(`${method} params`, params, serverRequestParams[method]);
			checkSchema(`${method} result`, result, serverRequestResults[method]);
		}
	});

	test("Phase B params reject malformed values", () => {
		const params = (method: keyof typeof ClientRequests) => Compile(ClientRequests[method].params);
		expect(params("thread/handoff").Check({ threadId: "t1" })).toBe(false);
		expect(params("git/push").Check({ threadId: "t1", force: true })).toBe(false);
		expect(params("git/stage").Check({ threadId: "t1", path: "a.txt", context: 0 })).toBe(false);
		expect(params("turn/start").Check({ threadId: "t1", text: "x", comments: [{ ...comment, endLine: 0 }] })).toBe(
			false,
		);
		expect(params("turn/start").Check({ threadId: "t1", text: "x", comments: [] })).toBe(false);
		const noCommand = { ...environment, actions: [{ name: "Test" }] };
		expect(params("environment/save").Check({ cwd: "/p", environments: [noCommand] })).toBe(false);
		const userItem = { type: "userMessage", id: "m1:user:0", text: "hi", images: [], comments: [comment] };
		expect(Compile(ServerNotifications["item/completed"]).Check({ threadId: "t1", turnId: "m1", item: userItem })).toBe(
			true,
		);
	});

	test("file and diff-file params keep their bounds", () => {
		const read = Compile(ClientRequests["file/read"].params);
		expect(read.Check({ threadId: "t1", path: "a", maxBytes: 1 })).toBe(true);
		expect(read.Check({ threadId: "t1", path: "a", maxBytes: 8 * 1024 * 1024 })).toBe(true);
		expect(read.Check({ threadId: "t1", path: "a", maxBytes: 8 * 1024 * 1024 + 1 })).toBe(false);
		expect(read.Check({ threadId: "t1", path: "a", maxBytes: 0 })).toBe(false);
		expect(read.Check({ threadId: "t1", path: "a", maxBytes: -1 })).toBe(false);
		expect(read.Check({ threadId: "t1", path: "a", maxBytes: 1.5 })).toBe(false);
		expect(read.Check({ threadId: "t1", path: "a", encoding: "utf8" })).toBe(false);
		const file = Compile(ClientRequests["thread/diff/file"].params);
		expect(file.Check({ threadId: "t1", fromTree: "a", toTree: "b", path: "x" })).toBe(true);
		expect(file.Check({ threadId: "t1", fromTree: "a", path: "x" })).toBe(false);
		expect(file.Check({ threadId: "t1", fromTree: "a", toTree: "b", path: "x", scope: "staged" })).toBe(false);
		const handoff = Compile(ClientRequests["thread/handoff"].params);
		expect(handoff.Check({ threadId: "t1", to: "local", dryRun: "yes" })).toBe(false);
		const fileResult = Compile(ClientRequests["file/read"].result);
		expect(fileResult.Check({ path: "/a", size: 9, binary: true, tooLarge: false, mtimeMs: 1 })).toBe(true);
	});

	test("gitConflict reasons are the listed set", () => {
		expect(GitConflictReason.anyOf.map((s: { const: string }) => s.const).sort()).toEqual(
			[
				"diffChanged",
				"patchFailed",
				"concurrentChange",
				"pushRejected",
				"localChanges",
				"operationInProgress",
				"branchExists",
				"recoveryRequired",
				"worktreeDeleted",
				"worktreeMissing",
				"worktreeInUse",
				"submodules",
			].sort(),
		);
	});

	test("extension UI messages accept every shape and reject malformed ones", () => {
		const widget = Compile(ServerNotifications["ui/widget"]);
		expect(widget.Check({ threadId: "t1", key: "a", placement: "belowEditor", view: table })).toBe(true);
		expect(widget.Check({ threadId: "t1", key: "a" })).toBe(true);
		expect(widget.Check({ threadId: "t1", key: "a", placement: "aboveEditor", lines: ["x"], view: table })).toBe(false);
		expect(widget.Check({ threadId: "t1", key: "", placement: "aboveEditor", lines: [] })).toBe(false);
		const event = Compile(ClientRequests["ui/event"].params);
		expect(event.Check({ threadId: "t1", widgetKey: "checks", id: "reset" })).toBe(true);
		expect(event.Check({ threadId: "t1", id: "reset" })).toBe(false);
		expect(Compile(UiSnapshot).Check({ ...ui, widgets: [{ key: "a", placement: "aboveEditor" }] })).toBe(false);
		const items = Compile(Item);
		const toolCall = { type: "toolCall", id: "c1", tool: "check", input: {}, status: "completed", output: [] };
		expect(items.Check({ ...toolCall, view: table })).toBe(true);
		expect(items.Check({ ...toolCall, view: { type: "script", text: "x" } })).toBe(false);
		const app = { server: "weather", resourceUri: "ui://weather/forecast.html" };
		expect(items.Check({ ...toolCall, mcpApp: { ...app, result: { content: [] } } })).toBe(true);
		expect(items.Check({ ...toolCall, mcpApp: { ...app, resultOmitted: true } })).toBe(true);
		expect(items.Check({ ...toolCall, mcpApp: { server: "weather" } })).toBe(false);
		const message = { type: "extensionMessage", id: "e1", extension: "checks", text: "done" };
		expect(items.Check({ ...message, view: { type: "markdown", markdown: "**done**" } })).toBe(true);
		expect(items.Check({ ...message, view: { type: "text", text: "x", html: "<b>x</b>" } })).toBe(false);
		expect(items.Check({ ...message, view: { type: "button", label: "Go" } })).toBe(false);
		expect(items.Check({ ...toolCall, backgroundShellId: "ab12cd34" })).toBe(true);
		const notice = { id: "ab12cd34", command: "npm test", status: "failed", exitCode: 1, outputTail: "1 failed" };
		expect(items.Check({ ...message, backgroundShells: [notice] })).toBe(true);
		expect(items.Check({ ...message, backgroundShells: [{ ...notice, status: "exited" }] })).toBe(false);
		// A notice reports an end.
		expect(items.Check({ ...message, backgroundShells: [{ ...notice, status: "running" }] })).toBe(false);
	});

	test("the generated JSON Schema is up to date", () => {
		const path = join(import.meta.dirname, "../../cli/docs/app-server.schema.json");
		expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(schemaDocument(), null, "\t")}\n`);
	});
});

describe("checkView", () => {
	const every: View = {
		type: "stack",
		children: [
			{ type: "text", text: "hi", tone: "success" },
			{ type: "markdown", markdown: "**b**" },
			{
				type: "stack",
				direction: "horizontal",
				children: [
					{ type: "list", items: [{ type: "text", text: "one" }] },
					{ type: "table", columns: ["a", "b"], rows: [["1", "2"]] },
					{ type: "progress", value: 150, max: 100, label: "tests" },
				],
			},
			{ type: "button", id: "go", label: "Go" },
			{ type: "field", id: "name", kind: "text", label: "Name", value: "x" },
			{ type: "field", id: "on", kind: "toggle", label: "On", value: true },
			{ type: "field", id: "pick", kind: "select", label: "Pick", value: "b", options: ["a", "b"] },
		],
	};
	const refused = (value: unknown, maxBytes?: number) => {
		const result = checkView(value, maxBytes);
		expect("error" in result, JSON.stringify(result).slice(0, 200)).toBe(true);
		return "error" in result ? result.error : "";
	};
	const nest = (depth: number): unknown => {
		let view: unknown = { type: "text", text: "x" };
		for (let i = 1; i < depth; i++) view = { type: "stack", children: [view] };
		return view;
	};

	test("accepts every node type nested and returns a copy", () => {
		const result = checkView(every);
		expect(result).toEqual({ view: every });
		expect("view" in result && result.view).not.toBe(every);
		expect(Compile(ViewSchema).Check(every)).toBe(true);
	});

	test("refuses what cannot be copied without throwing", () => {
		const cyclic: { type: string; items: unknown[] } = { type: "list", items: [] };
		cyclic.items.push(cyclic);
		expect(refused(cyclic)).toMatch(/JSON/);
		let deep: unknown = { type: "text", text: "x" };
		for (let i = 0; i < 200_000; i++) deep = { type: "list", items: [deep] };
		expect(refused(deep)).toMatch(/JSON/);
		expect(refused(undefined)).toMatch(/JSON/);
		expect(refused(() => {})).toMatch(/JSON/);
	});

	test("refuses each rule with its own message", () => {
		const big = (bytes: number) => ({ type: "markdown", markdown: "x".repeat(bytes) });
		expect(refused(big(70 * 1024))).toMatch(/65536 bytes/);
		expect(refused(big(17 * 1024), WIDGET_MAX_BYTES)).toMatch(/16384 bytes/);
		expect(checkView(nest(VIEW_MAX_DEPTH))).toHaveProperty("view");
		expect(refused(nest(VIEW_MAX_DEPTH + 1))).toMatch(/levels/);
		expect(refused({ type: "text", text: "x", html: "<b>" })).toMatch(/not a valid view/);
		const field = { type: "field", id: "a", kind: "text", label: "A", value: "" };
		expect(refused({ type: "stack", children: [field, field] })).toMatch(/"a" is used twice/);
		expect(refused({ type: "table", columns: ["a", "b", "c"], rows: [["1", "2"]] })).toMatch(/2 cells for 3 columns/);
		expect(refused({ ...field, kind: "toggle", value: "on" })).toMatch(/toggle/);
		expect(refused({ ...field, kind: "text", value: true })).toMatch(/string/);
		expect(refused({ ...field, kind: "select", value: "c", options: ["a", "b"] })).toMatch(/not one of its options/);
		expect(refused({ ...field, kind: "select", value: "a" })).toMatch(/options/);
		expect(refused({ ...field, kind: "text", options: ["a"] })).toMatch(/options/);
	});

	test("checks the JSON copy, not the object", () => {
		class Shaped {
			type = "text";
			text = "x";
			toJSON() {
				return { type: "stack", children: null };
			}
		}
		expect(refused(new Shaped())).toMatch(/not a valid view/);
	});

	test("removes escape sequences and control characters from every string, keeping tabs and newlines", () => {
		const dirty = "\u001b[31mred\u001b[0m \u001b]0;title\u0007\u001b[2J\u001b[10Aa\rb\u009b31m\u0000\tc\nd";
		const result = checkView({
			type: "stack",
			children: [
				{ type: "text", text: dirty },
				{ type: "table", columns: [dirty], rows: [[dirty]] },
				{ type: "field", id: "s", kind: "select", label: dirty, value: dirty, options: [dirty] },
			],
		});
		const clean = "red ab\tc\nd";
		expect(result).toEqual({
			view: {
				type: "stack",
				children: [
					{ type: "text", text: clean },
					{ type: "table", columns: [clean], rows: [[clean]] },
					{ type: "field", id: "s", kind: "select", label: clean, value: clean, options: [clean] },
				],
			},
		});
		// An id made only of escapes is empty once cleaned, so the schema refuses it.
		expect(refused({ type: "button", id: "\u001b[0m", label: "x" })).toMatch(/not a valid view/);
	});
});
