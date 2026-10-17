import { fauxAssistantMessage } from "@knightcode/ai";
import { afterEach, expect, test } from "vitest";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import {
	classifyAssistantError,
	TURN_END_TYPE,
	TURN_MARKER_TYPE,
	turnMarkerExtension,
} from "../../src/extensions/turn-marker.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness | undefined;
afterEach(() => harness?.cleanup());

const kinds = (branch: SessionEntry[]) =>
	branch.map((entry) =>
		entry.type === "custom" ? entry.customType : entry.type === "message" ? entry.message.role : entry.type,
	);
const ends = (branch: SessionEntry[]) =>
	branch.flatMap((entry) => (entry.type === "custom" && entry.customType === TURN_END_TYPE ? [entry.data] : []));

test("each prompt is one marker before its user message and one end entry", async () => {
	harness = await createHarness({ extensionFactories: [turnMarkerExtension] });
	harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
	await harness.session.prompt("first");
	await harness.session.prompt("second");
	const branch = harness.session.sessionManager.getBranch();
	expect(kinds(branch).filter((k) => k === TURN_MARKER_TYPE)).toHaveLength(2);
	expect(kinds(branch).indexOf(TURN_MARKER_TYPE)).toBeLessThan(kinds(branch).indexOf("user"));
	expect(ends(branch)).toEqual([{ status: "completed" }, { status: "completed" }]);
});

test("an automatic retry stays inside one turn", async () => {
	harness = await createHarness({
		extensionFactories: [turnMarkerExtension],
		settings: { retry: { enabled: true, maxRetries: 3, baseDelayMs: 1 } },
	});
	harness.setResponses([
		fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded_error" }),
		fauxAssistantMessage("recovered"),
	]);
	await harness.session.prompt("go");
	const branch = harness.session.sessionManager.getBranch();
	expect(kinds(branch).filter((k) => k === TURN_MARKER_TYPE)).toHaveLength(1);
	expect(ends(branch)).toEqual([{ status: "completed" }]);
});

test("a follow-up queued during a run stays inside its turn", async () => {
	harness = await createHarness({ extensionFactories: [turnMarkerExtension] });
	let entered!: () => void;
	const replying = new Promise<void>((resolve) => (entered = resolve));
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	harness.setResponses([
		async () => {
			entered();
			await released;
			return fauxAssistantMessage("one");
		},
		fauxAssistantMessage("two"),
	]);
	const running = harness.session.prompt("first");
	// The run is inside its first model request, so the follow-up queues behind it.
	await replying;
	await harness.session.followUp("then this");
	release();
	await running;
	await harness.session.waitForIdle();
	const branch = harness.session.sessionManager.getBranch();
	expect(kinds(branch).filter((k) => k === "user")).toHaveLength(2);
	expect(kinds(branch).filter((k) => k === TURN_MARKER_TYPE)).toHaveLength(1);
	expect(ends(branch)).toHaveLength(1);
});

test("an aborted run ends interrupted", async () => {
	harness = await createHarness({ extensionFactories: [turnMarkerExtension] });
	let entered!: () => void;
	const replying = new Promise<void>((resolve) => (entered = resolve));
	harness.setResponses([
		// Holds the request until it is aborted, then answers as an aborted stream does.
		(_context, options) =>
			new Promise((resolve) => {
				entered();
				options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted" })), {
					once: true,
				});
			}),
	]);
	const running = harness.session.prompt("slow");
	await replying;
	await harness.session.abort();
	await running.catch(() => {});
	expect(ends(harness.session.sessionManager.getBranch())).toEqual([{ status: "interrupted" }]);
});

test("a failed provider turn stores an actionable error kind", async () => {
	harness = await createHarness({ extensionFactories: [turnMarkerExtension], settings: { retry: { enabled: false } } });
	harness.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "401 Unauthorized" })]);
	await harness.session.prompt("go");
	expect(ends(harness.session.sessionManager.getBranch())).toEqual([
		{ status: "failed", error: { message: "401 Unauthorized", kind: "auth" } },
	]);
});

test("a token-limit parameter error is not classified as auth", () => {
	const kind = (errorMessage: string) =>
		classifyAssistantError(fauxAssistantMessage("", { stopReason: "error", errorMessage }));
	expect(kind("Invalid value for max_tokens: must be positive")).toBe("provider");
	expect(kind("Invalid 'max_output_tokens': integer below minimum")).toBe("provider");
	expect(kind("invalid_token")).toBe("auth");
	expect(kind("Invalid access token")).toBe("auth");
	expect(kind("invalid x-api-key")).toBe("auth");
});
