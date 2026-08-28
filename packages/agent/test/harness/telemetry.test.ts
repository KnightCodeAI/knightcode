import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createTypedSpanStarter, NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@knightcode/telemetry";
import { describe, expect, expectTypeOf, it } from "vitest";
import { renderAgentTelemetrySchemaMarkdown } from "../../scripts/generate-telemetry-docs.ts";
import {
	AGENT_TELEMETRY_SCHEMAS,
	AI_TELEMETRY_SCHEMA,
	type AiSpanEndAttributes,
	type AiSpanStartAttributes,
	HARNESS_TELEMETRY_SCHEMA,
	type HarnessSpanEndAttributes,
	type HarnessSpanStartAttributes,
	startAiSpan,
	startHarnessSpan,
} from "../../src/harness/telemetry.ts";

describe("agent telemetry schemas", () => {
	it("serializes both schemas and generates the checked-in reference", () => {
		expect(() => JSON.stringify(AI_TELEMETRY_SCHEMA)).not.toThrow();
		expect(() => JSON.stringify(HARNESS_TELEMETRY_SCHEMA)).not.toThrow();
		expect(AGENT_TELEMETRY_SCHEMAS).toEqual([AI_TELEMETRY_SCHEMA, HARNESS_TELEMETRY_SCHEMA]);
		expect(Object.keys(HARNESS_TELEMETRY_SCHEMA.spans)).toEqual([
			"knightcode.harness.run",
			"knightcode.harness.compaction",
			"knightcode.harness.navigation",
			"knightcode.harness.checkpoint",
			"knightcode.harness.turn",
			"knightcode.harness.step",
			"knightcode.harness.tool",
			"knightcode.harness.hook",
			"knightcode.harness.sleep",
			"knightcode.harness.event_handler",
			"knightcode.session.write",
		]);
		const actual = readFileSync(resolve(import.meta.dirname, "../../docs/telemetry-schema.md"), "utf8");
		expect(actual).toBe(renderAgentTelemetrySchemaMarkdown());
	});

	it("starts AI-request and harness spans through one composed typed starter", async () => {
		const startSpan = createTypedSpanStarter(NOOP_TELEMETRY_CONTEXT, AGENT_TELEMETRY_SCHEMAS);
		await startSpan(
			"knightcode.harness.step",
			{
				"knightcode.lane.name": "main",
				"knightcode.operation.id": "operation",
				"knightcode.step.kind": "assistant",
				"knightcode.step.attempt": 1,
			},
			async (stepSpan, startChildSpan) => {
				stepSpan.setAttributes({ "knightcode.step.outcome": "succeeded" });
				await startChildSpan(
					"knightcode.ai.request",
					{
						"knightcode.ai.operation": "stream",
						"knightcode.ai.provider": "provider",
						"knightcode.ai.model": "model",
						"knightcode.ai.api": "api",
						"knightcode.ai.streaming": true,
					},
					(requestSpan) => {
						requestSpan.setAttributes({ "knightcode.ai.response.stop_reason": "stop" });
					},
				);
			},
		);
	});

	it("infers exact AI start and optional end attributes", async () => {
		type Start = AiSpanStartAttributes<"knightcode.ai.request">;
		type End = AiSpanEndAttributes<"knightcode.ai.request">;
		expectTypeOf<Start>().toMatchTypeOf<{
			"knightcode.ai.operation": "stream" | "fetch_deferred" | "cancel_deferred" | "generate_images";
			"knightcode.ai.provider": string;
			"knightcode.ai.model": string;
			"knightcode.ai.api": string;
			"knightcode.ai.streaming": boolean;
			"knightcode.ai.deferred"?: boolean;
		}>();
		expectTypeOf<End["knightcode.ai.response.stop_reason"]>().toEqualTypeOf<
			"stop" | "length" | "tool_use" | "error" | "aborted" | "deferred" | undefined
		>();

		const telemetryContext: TelemetryContext = NOOP_TELEMETRY_CONTEXT;
		await startAiSpan(
			telemetryContext,
			"knightcode.ai.request",
			{
				"knightcode.ai.operation": "stream",
				"knightcode.ai.provider": "provider",
				"knightcode.ai.model": "model",
				"knightcode.ai.api": "api",
				"knightcode.ai.streaming": true,
			},
			(span) => {
				span.setAttributes({ "knightcode.ai.response.stop_reason": "tool_use" });
				// @ts-expect-error pi.ai.request declares no span events
				span.addEvent("chunk");
			},
		);

		const compileTimeFailures = () => {
			const extraAttributes = {
				"knightcode.ai.operation": "stream",
				"knightcode.ai.provider": "provider",
				"knightcode.ai.model": "model",
				"knightcode.ai.api": "api",
				"knightcode.ai.streaming": true,
				"knightcode.ai.unknown": true,
			} as const;
			// @ts-expect-error variables with unknown attributes are rejected
			void startAiSpan(telemetryContext, "knightcode.ai.request", extraAttributes, () => {});
			// @ts-expect-error missing required start attributes
			void startAiSpan(telemetryContext, "knightcode.ai.request", { "knightcode.ai.operation": "stream" }, () => {});
		};
		expectTypeOf(compileTimeFailures).toBeFunction();
	});

	it("infers per-span harness literals and optional completion enrichment", async () => {
		type RunStart = HarnessSpanStartAttributes<"knightcode.harness.run">;
		type RunEnd = HarnessSpanEndAttributes<"knightcode.harness.run">;
		expectTypeOf<RunStart["knightcode.operation.kind"]>().toEqualTypeOf<"run">();
		expectTypeOf<RunEnd["knightcode.operation.outcome"]>().toEqualTypeOf<
			"completed" | "aborted" | "failed" | "suspended" | undefined
		>();

		const telemetryContext: TelemetryContext = NOOP_TELEMETRY_CONTEXT;
		await startHarnessSpan(
			telemetryContext,
			"knightcode.harness.run",
			{
				"knightcode.session.id": "session",
				"knightcode.lane.name": "main",
				"knightcode.operation.id": "operation",
				"knightcode.operation.kind": "run",
				"knightcode.operation.recovery": false,
			},
			(span) => {
				span.setAttributes({ "knightcode.operation.outcome": "completed" });
				span.setAttributes({});
				// @ts-expect-error the harness schema declares no span events
				span.addEvent("result");
			},
		);

		const compileTimeFailures = () => {
			const extraRunAttributes = {
				"knightcode.session.id": "session",
				"knightcode.lane.name": "main",
				"knightcode.operation.id": "operation",
				"knightcode.operation.kind": "run",
				"knightcode.operation.recovery": false,
				"knightcode.unknown": true,
			} as const;
			// @ts-expect-error variables with unknown attributes are rejected
			void startHarnessSpan(telemetryContext, "knightcode.harness.run", extraRunAttributes, () => {});
			void startHarnessSpan(
				telemetryContext,
				"knightcode.harness.checkpoint",
				{
					"knightcode.lane.name": "main",
					"knightcode.operation.id": "operation",
					"knightcode.checkpoint.kind": "normal",
				},
				(span) => {
					// @ts-expect-error empty end schemas reject every attribute
					span.setAttributes({ "knightcode.unknown": true });
				},
			);
			void startHarnessSpan(
				telemetryContext,
				"knightcode.harness.run",
				{
					"knightcode.session.id": "session",
					"knightcode.lane.name": "main",
					"knightcode.operation.id": "operation",
					// @ts-expect-error run spans accept only the run operation kind
					"knightcode.operation.kind": "navigation",
					"knightcode.operation.recovery": false,
				},
				() => {},
			);
			// @ts-expect-error missing required run start attributes
			void startHarnessSpan(telemetryContext, "knightcode.harness.run", {}, () => {});
		};
		expectTypeOf(compileTimeFailures).toBeFunction();
	});
});
