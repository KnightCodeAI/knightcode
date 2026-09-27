import type { SettingItem } from "@knightcode/tui";
import type { ExtensionAPI, ExtensionContext, ModelRegistry, Theme } from "@knightcodeai/cli";
import { SelectSubmenu } from "@knightcodeai/cli/modes/interactive/components/settings-submenu";
import type { RegisteredToolEntry } from "./registry.ts";
import { readPersisted, resolveEnabled, type ToolSettings } from "./state.ts";

export const CLASSIFIER_GATE = "classifier-gate";
const GATED_TOOLS = new Set(["bash", "powershell", "write", "edit"]);
const RISK_THRESHOLD = 0.5;
// A call is classified whole or not at all: a scored prefix would let an unseen tail run.
// ponytail: fixed cap; size it from the model's context window if long calls confirm too often.
const MAX_INPUT_CHARS = 4000;

/** `provider/model`; provider IDs never contain a slash, model IDs may. */
function splitModelRef(ref: string): { provider: string; model: string } | undefined {
	const slash = ref.indexOf("/");
	return slash > 0 ? { provider: ref.slice(0, slash), model: ref.slice(slash + 1) } : undefined;
}

/** The /tools classifier-gate row: which classifier model screens tool calls. */
function classifierGateSettings(current: ToolSettings, _theme: Theme, models: ModelRegistry): SettingItem[] {
	const model = typeof current.model === "string" ? current.model : "";
	return [
		{
			id: "model",
			label: "Model",
			description: "Classifier asked whether each shell or file-editing call is risky. Log in to OpenRouter for Jev.",
			currentValue: model || "not set",
			submenu: (currentValue, done) =>
				new SelectSubmenu(
					"Classifier model",
					"",
					models.getAvailableClassifiers().map((m) => ({
						value: `${m.provider}/${m.id}`,
						label: `${m.provider}/${m.id}`,
						description: m.name,
					})),
					currentValue,
					(value) => done(value),
					() => done(),
				),
		},
	];
}

export const classifierGateEntry: RegisteredToolEntry = {
	tool: { name: CLASSIFIER_GATE, feature: true },
	defaultEnabled: false,
	settings: classifierGateSettings,
};

type GateResult = { block: true; reason: string } | undefined;

async function confirmOrBlock(ctx: ExtensionContext, toolName: string, reason: string): Promise<GateResult> {
	if (!ctx.hasUI) return { block: true, reason: `${reason} (no UI for confirmation)` };
	// The loop awaits this handler before it checks for abort, so the dialog must close on abort.
	const allowed = await ctx.ui.confirm(`Classifier gate: ${toolName}`, `${reason}\n\nAllow this call?`, {
		signal: ctx.signal,
	});
	if (ctx.signal?.aborted) return { block: true, reason: "Aborted" };
	return allowed ? undefined : { block: true, reason: "Blocked by user" };
}

/**
 * Screens shell and file-mutating tool calls with the classifier chosen in /tools. Only a bool
 * answer below the threshold for the whole call allows it; anything else needs confirmation, and
 * is blocked without a UI.
 */
export function registerClassifierGate(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (!GATED_TOOLS.has(event.toolName)) return undefined;
		const persisted = readPersisted();
		if (!resolveEnabled(CLASSIFIER_GATE, classifierGateEntry.defaultEnabled, persisted)) return undefined;

		const ref = persisted[CLASSIFIER_GATE]?.model;
		const parts = typeof ref === "string" ? splitModelRef(ref) : undefined;
		const model = parts && ctx.modelRegistry.findClassifier(parts.provider, parts.model);
		if (!model) {
			const why = ref ? `Classifier ${ref} is not available.` : "No classifier model is set.";
			return confirmOrBlock(ctx, event.toolName, `${why} Choose one in /tools ${CLASSIFIER_GATE}.`);
		}

		const input = JSON.stringify(event.input);
		if (input.length > MAX_INPUT_CHARS) {
			return confirmOrBlock(
				ctx,
				event.toolName,
				`Call is too large to classify (${input.length} > ${MAX_INPUT_CHARS} characters).`,
			);
		}

		const result = await ctx.modelRegistry.classify(
			model,
			{
				state: { tool: event.toolName, input, cwd: ctx.cwd },
				questions: {
					risky: {
						type: "bool",
						instructions:
							"Could this coding-agent tool call cause harm that is hard to undo: deleting or overwriting data outside the working directory or beyond the task, exposing secrets, changing system configuration, or publishing to a remote service?",
						criteria: {
							true: "The call is destructive, irreversible, exfiltrates data, or reaches beyond the project.",
							false: "The call is routine project work that is easy to review or undo.",
						},
					},
				},
			},
			{ signal: ctx.signal },
		);

		if (result.stopReason === "aborted") return { block: true, reason: "Aborted" };
		if (result.stopReason === "error") {
			return confirmOrBlock(ctx, event.toolName, `Classifier failed: ${result.errorMessage ?? "unknown error"}.`);
		}
		const answer = result.answers.risky;
		if (answer?.type === "bool" && answer.probability < RISK_THRESHOLD) return undefined;
		const why =
			answer?.type === "bool"
				? `Classifier rates this call risky (p=${answer.probability.toFixed(2)}).`
				: "Classifier returned no risk answer.";
		return confirmOrBlock(ctx, event.toolName, why);
	});
}
