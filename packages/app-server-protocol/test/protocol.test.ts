import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ThinkingLevel as AgentThinkingLevel } from "@knightcode/agent";
import type { Static, TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { describe, expect, test } from "vitest";
import {
	ClientNotifications,
	ClientRequests,
	schemaDocument,
	ServerNotifications,
	GitConflictReason,
	ServerRequests,
	type ThinkingLevel,
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
	cleanup: { default: "rm -rf node_modules" },
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

// One valid example per message. A message without an example fails the coverage test below.
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
	"thread/handoff": { threadId: "t1", to: "local", branch: "kc/fix-it", environment: "dev" },
	"thread/worktree/restore": { threadId: "t1" },
	"worktree/list": { cwd: "/p" },
	"worktree/delete": { path: "/w/ab12/p" },
	"environment/list": { cwd: "/p" },
	"environment/save": { cwd: "/p", environments: [environment] },
	"thread/diff/read": { threadId: "t1", scope: "branch", against: "main", context: 3, ignoreWhitespace: true },
	"thread/diff/revert": { threadId: "t1", scope: "uncommitted", path: "a.txt", hunkId: "h1", context: 3 },
	"git/status": { threadId: "t1" },
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
	"project/trust/read": { cwd: "/p" },
	"project/trust/set": { cwd: "/p", trusted: true },
	"account/list": {},
	"account/login/start": { provider: "anthropic", type: "oauth" },
	"account/login/answer": { loginId: "l1", value: "code" },
	"account/login/cancel": { loginId: "l1" },
	"account/logout": { provider: "anthropic" },
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
	"thread/start": { thread, warnings: [] },
	"thread/resume": {
		thread,
		turns: [turn],
		queue: { steering: [], followUp: [] },
		usage,
		warnings: [],
		nextCursor: "opaque-history-anchor",
	},
	"thread/fork": { thread: worktreeThread, warnings: [] },
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
	"thread/diff/read": { scope: "lastTurn", files: [diffFile], filesOmitted: 0, untrackedSkipped: 0, turnId: "m1" },
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
		origins: { theme: "global" },
		versions: { global: "hash" },
		errors: [],
	},
	"config/write": { version: "hash" },
	"project/trust/read": { trusted: null, needsTrust: true },
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

	test("the generated JSON Schema is up to date", () => {
		const path = join(import.meta.dirname, "../../cli/docs/app-server.schema.json");
		expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(schemaDocument(), null, "\t")}\n`);
	});
});
