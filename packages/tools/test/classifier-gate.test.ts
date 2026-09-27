import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierAnswer, ClassifierResult } from "@knightcode/ai";
import type { ExtensionAPI } from "@knightcodeai/cli";
import { ENV_AGENT_DIR } from "@knightcodeai/cli/config";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CLASSIFIER_GATE, registerClassifierGate } from "../src/classifier-gate.ts";
import { resetSessionOverrides, setMode, updateSettings } from "../src/state.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

let base: string;
let answers: Record<string, ClassifierAnswer>;
let failure: string | undefined;
const confirm = vi.fn(async (_title: string, _message: string, _opts?: { signal?: AbortSignal }) => false);
const classify = vi.fn(async (): Promise<ClassifierResult> => ({
	api: judge.api,
	provider: judge.provider,
	model: judge.id,
	answers: failure ? {} : answers,
	stopReason: failure ? "error" : "stop",
	errorMessage: failure,
	timestamp: 0,
}));
const judge = { type: "classifier", provider: "openrouter", id: "typesafe/jev-1.13", api: "typesafe-system-one" };
const risk = (probability: number) => ({ risky: { type: "bool" as const, probability } });

const modelRegistry = {
	findClassifier: (provider: string, id: string) =>
		provider === judge.provider && id === judge.id ? judge : undefined,
	classify,
};

function gate() {
	const handlers = new Map<string, Handler>();
	registerClassifierGate({
		on: (event: string, handler: Handler) => handlers.set(event, handler),
	} as unknown as ExtensionAPI);
	return (
		toolName: string,
		{ hasUI = true, command = "rm -rf ~", signal = undefined as AbortSignal | undefined } = {},
	) =>
		handlers.get("tool_call")!(
			{ type: "tool_call", toolCallId: "1", toolName, input: { command } },
			{ hasUI, cwd: "/repo", signal, modelRegistry, ui: { confirm } },
		);
}

async function enable() {
	await setMode(CLASSIFIER_GATE, "session");
	await updateSettings(CLASSIFIER_GATE, { model: "openrouter/typesafe/jev-1.13" });
}

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "kc-classifier-gate-"));
	process.env[ENV_AGENT_DIR] = join(base, "agent");
	resetSessionOverrides();
	answers = risk(0);
	failure = undefined;
	confirm.mockClear();
	classify.mockClear();
});
afterEach(() => {
	delete process.env[ENV_AGENT_DIR];
	resetSessionOverrides();
	rmSync(base, { recursive: true, force: true });
});

describe("classifier gate", () => {
	test("is off by default", async () => {
		answers = risk(1);
		expect(await gate()("bash")).toBeUndefined();
		expect(classify).not.toHaveBeenCalled();
	});

	test("asks before a risky call, and blocks it without a UI", async () => {
		await enable();
		answers = risk(0.9);
		const call = gate();
		expect(await call("bash")).toEqual({ block: true, reason: "Blocked by user" });
		expect(confirm).toHaveBeenCalledOnce();
		expect(await call("bash", { hasUI: false })).toMatchObject({ block: true });
	});

	test("passes safe calls and tools it does not gate", async () => {
		await enable();
		const call = gate();
		answers = risk(0.1);
		expect(await call("bash", { hasUI: false })).toBeUndefined();
		answers = risk(1);
		expect(await call("read", { hasUI: false })).toBeUndefined();
	});

	test("fails closed without a model or when the classifier errors", async () => {
		await setMode(CLASSIFIER_GATE, "session");
		const call = gate();
		expect(await call("write", { hasUI: false })).toMatchObject({
			reason: expect.stringContaining("No classifier model"),
		});
		await updateSettings(CLASSIFIER_GATE, { model: "openrouter/typesafe/jev-1.13" });
		failure = "HTTP 500";
		expect(await call("edit", { hasUI: false })).toMatchObject({ reason: expect.stringContaining("HTTP 500") });
	});

	test("fails closed on a missing or non-bool answer", async () => {
		await enable();
		const call = gate();
		answers = {};
		expect(await call("bash", { hasUI: false })).toMatchObject({ reason: expect.stringContaining("no risk answer") });
		answers = { risky: { type: "score", score: 0, confidence: 1 } };
		expect(await call("bash", { hasUI: false })).toMatchObject({ reason: expect.stringContaining("no risk answer") });
	});

	test("never scores a prefix: an oversized call skips the classifier and fails closed", async () => {
		await enable();
		const command = `${"echo ok; ".repeat(500)}rm -rf ~`;
		expect(await gate()("bash", { hasUI: false, command })).toMatchObject({
			reason: expect.stringContaining("too large to classify"),
		});
		expect(classify).not.toHaveBeenCalled();
	});

	test("the confirmation follows the turn's abort signal", async () => {
		await enable();
		answers = risk(0.9);
		const controller = new AbortController();
		confirm.mockImplementationOnce(async (_title, _message, opts) => {
			expect(opts?.signal).toBe(controller.signal);
			controller.abort();
			return true;
		});
		expect(await gate()("bash", { signal: controller.signal })).toEqual({ block: true, reason: "Aborted" });
	});
});
