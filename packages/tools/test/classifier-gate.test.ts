import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClassifierResult } from "@knightcode/ai";
import type { ExtensionAPI } from "@knightcodeai/cli";
import { ENV_AGENT_DIR } from "@knightcodeai/cli/config";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CLASSIFIER_GATE, registerClassifierGate } from "../src/classifier-gate.ts";
import { resetSessionOverrides, setMode, updateSettings } from "../src/state.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

let base: string;
let probability: number;
let failure: string | undefined;
const confirm = vi.fn(async () => false);
const judge = { type: "classifier", provider: "openrouter", id: "typesafe/jev-1.13", api: "typesafe-system-one" };

const modelRegistry = {
	findClassifier: (provider: string, id: string) =>
		provider === judge.provider && id === judge.id ? judge : undefined,
	classify: async (): Promise<ClassifierResult> => ({
		api: judge.api,
		provider: judge.provider,
		model: judge.id,
		answers: failure ? {} : { risky: { type: "bool", probability } },
		stopReason: failure ? "error" : "stop",
		errorMessage: failure,
		timestamp: 0,
	}),
};

function gate() {
	const handlers = new Map<string, Handler>();
	registerClassifierGate({
		on: (event: string, handler: Handler) => handlers.set(event, handler),
	} as unknown as ExtensionAPI);
	return (toolName: string, hasUI = true) =>
		handlers.get("tool_call")!(
			{ type: "tool_call", toolCallId: "1", toolName, input: { command: "rm -rf ~" } },
			{ hasUI, cwd: "/repo", signal: undefined, modelRegistry, ui: { confirm } },
		);
}

beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "kc-classifier-gate-"));
	process.env[ENV_AGENT_DIR] = join(base, "agent");
	resetSessionOverrides();
	probability = 0;
	failure = undefined;
	confirm.mockClear();
});
afterEach(() => {
	delete process.env[ENV_AGENT_DIR];
	resetSessionOverrides();
	rmSync(base, { recursive: true, force: true });
});

describe("classifier gate", () => {
	test("is off by default", async () => {
		probability = 1;
		expect(await gate()("bash")).toBeUndefined();
		expect(confirm).not.toHaveBeenCalled();
	});

	test("asks before a risky call, and blocks it without a UI", async () => {
		await setMode(CLASSIFIER_GATE, "always");
		await updateSettings(CLASSIFIER_GATE, { model: "openrouter/typesafe/jev-1.13" });
		probability = 0.9;
		const call = gate();
		expect(await call("bash")).toEqual({ block: true, reason: "Blocked by user" });
		expect(confirm).toHaveBeenCalledOnce();
		expect(await call("bash", false)).toMatchObject({ block: true });
	});

	test("passes safe calls and tools it does not gate", async () => {
		await setMode(CLASSIFIER_GATE, "session");
		await updateSettings(CLASSIFIER_GATE, { model: "openrouter/typesafe/jev-1.13" });
		const call = gate();
		probability = 0.1;
		expect(await call("bash", false)).toBeUndefined();
		probability = 1;
		expect(await call("read", false)).toBeUndefined();
	});

	test("fails closed without a model or when the classifier errors", async () => {
		await setMode(CLASSIFIER_GATE, "session");
		const call = gate();
		expect(await call("write", false)).toMatchObject({ reason: expect.stringContaining("No classifier model") });
		await updateSettings(CLASSIFIER_GATE, { model: "openrouter/typesafe/jev-1.13" });
		failure = "HTTP 500";
		expect(await call("edit", false)).toMatchObject({ reason: expect.stringContaining("HTTP 500") });
	});
});
