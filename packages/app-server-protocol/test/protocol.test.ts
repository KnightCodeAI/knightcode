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
	status: "idle",
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
	status: "notLoaded",
	archived: false,
	updatedAt: "2026-10-11T00:00:00.000Z",
};
const turn = { id: "m1", threadId: "t1", status: "completed", items: [] };
const item = { type: "agentMessage", id: "m1:0:0", text: "hi" };
const login = { status: "pending", loginId: "l1", events: [] };

// One valid example per message. A message without an example fails the coverage test below.
const requestParams: Record<string, unknown> = {
	initialize: { clientInfo: { name: "test", version: "1" }, protocolVersion: 1, capabilities: {} },
	"thread/start": { cwd: "/p", approvalMode: "ask", model: { provider: "faux", id: "m" }, thinkingLevel: "low" },
	"thread/resume": { threadId: "t1", cursor: "opaque-history-anchor" },
	"thread/fork": { threadId: "t1", atItemId: "m1:user:0" },
	"thread/list": { cwd: "/p", cursor: "opaque-list-snapshot", archived: false },
	"thread/read": { threadId: "t1", cursor: "opaque-history-anchor" },
	"thread/unsubscribe": { threadId: "t1" },
	"thread/archive": { threadId: "t1" },
	"thread/unarchive": { threadId: "t1" },
	"thread/name/set": { threadId: "t1", name: "n" },
	"thread/settings/update": { threadId: "t1", thinkingLevel: "high", approvalMode: "fullAccess" },
	"thread/compact": { threadId: "t1", instructions: "keep the plan" },
	"turn/start": { threadId: "t1", text: "hi", images: [{ mimeType: "image/png", data: "AA==" }] },
	"turn/steer": { threadId: "t1", text: "also this" },
	"turn/followUp": { threadId: "t1", text: "then this" },
	"turn/interrupt": { threadId: "t1" },
	"payload/read": { id: "issued-payload-id", offset: 0, maxBytes: 49152 },
	"model/list": {},
	"command/list": { threadId: "t1" },
	"config/read": { cwd: "/p" },
	"account/list": {},
	"account/login/start": { provider: "anthropic", type: "oauth" },
	"account/login/answer": { loginId: "l1", value: "code" },
	"account/login/cancel": { loginId: "l1" },
	"account/logout": { provider: "anthropic" },
};
const requestResults: Record<string, unknown> = {
	initialize: { serverInfo: { name: "knightcode", version: "0.0.0" }, protocolVersion: 1 },
	"thread/start": { thread },
	"thread/resume": { thread, turns: [turn], nextCursor: "opaque-history-anchor" },
	"thread/fork": { thread },
	"thread/list": { threads: [summary], nextCursor: "opaque-list-snapshot" },
	"thread/read": { thread: summary, turns: [turn] },
	"thread/unsubscribe": {},
	"thread/archive": {},
	"thread/unarchive": {},
	"thread/name/set": {},
	"thread/settings/update": { thread },
	"thread/compact": {},
	"turn/start": { status: "started", threadId: "t1", requestId: "r1" },
	"turn/steer": {},
	"turn/followUp": {},
	"turn/interrupt": {},
	"payload/read": { data: "e30=", eof: true },
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
				input: ["text"],
			},
		],
		default: null,
	},
	"command/list": { commands: [{ name: "plan", description: "Plan first" }] },
	"config/read": { settings: { theme: "dark" } },
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
	"thread/status/changed": { threadId: "t1", status: "active" },
	"thread/name/updated": { threadId: "t1", name: "n" },
	"thread/settings/updated": { thread },
	"thread/archived": { threadId: "t1", archived: true },
	"turn/started": { turn, requestId: "r1" },
	"turn/completed": { turn: { id: "m1", threadId: "t1", status: "completed" } },
	"turn/retry": { threadId: "t1", turnId: "m1", attempt: 1, maxAttempts: 3, delayMs: 1000, error: "overloaded" },
	"turn/queue/updated": { threadId: "t1", steering: ["a"], followUp: [] },
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
	"account/login/updated": login,
	"account/updated": { provider: "anthropic", authenticated: true },
	error: { message: "bad line" },
};
const serverRequestParams: Record<string, unknown> = {
	"item/toolCall/requestApproval": { threadId: "t1", turnId: "m1", itemId: "call_1", tool: "bash", input: {} },
};
const serverRequestResults: Record<string, unknown> = {
	"item/toolCall/requestApproval": { decision: "accept" },
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

	test("the generated JSON Schema is up to date", () => {
		const path = join(import.meta.dirname, "../../cli/docs/app-server.schema.json");
		expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify(schemaDocument(), null, "\t")}\n`);
	});
});
