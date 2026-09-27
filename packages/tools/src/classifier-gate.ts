import type { SettingItem } from "@knightcode/tui";
import type { ExtensionAPI, ExtensionContext, ModelRegistry } from "@knightcodeai/cli";
import { SelectSubmenu } from "@knightcodeai/cli/modes/interactive/components/settings-submenu";
import type { RegisteredToolEntry } from "./registry.ts";
import { readPersisted, resolveEnabled, type ToolSettings } from "./state.ts";

export const CLASSIFIER_GATE = "classifier-gate";
const GATED_TOOLS = new Set(["bash", "powershell", "write", "edit"]);
const RISK_THRESHOLD = 0.5;
// ponytail: fixed truncation keeps large writes inside the classifier's context window.
const MAX_INPUT_CHARS = 4000;

// The /tools panel builds its rows synchronously and without a context, so the gate keeps the
// registry from the last session_start.
let registry: ModelRegistry | undefined;

/** `provider/model`; provider IDs never contain a slash, model IDs may. */
function splitModelRef(ref: string): { provider: string; model: string } | undefined {
	const slash = ref.indexOf("/");
	return slash > 0 ? { provider: ref.slice(0, slash), model: ref.slice(slash + 1) } : undefined;
}

/** The /tools classifier-gate row: which classifier model screens tool calls. */
function classifierGateSettings(current: ToolSettings): SettingItem[] {
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
					(registry?.getAvailableClassifiers() ?? []).map((m) => ({
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
	const allowed = await ctx.ui.confirm(`Classifier gate: ${toolName}`, `${reason}\n\nAllow this call?`);
	return allowed ? undefined : { block: true, reason: "Blocked by user" };
}

/**
 * Screens shell and file-mutating tool calls with the classifier chosen in /tools. A risky call
 * needs confirmation, and is blocked without a UI. A missing or failing classifier fails closed.
 */
export function registerClassifierGate(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		registry = ctx.modelRegistry;
	});
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

		const result = await ctx.modelRegistry.classify(
			model,
			{
				state: {
					tool: event.toolName,
					input: JSON.stringify(event.input).slice(0, MAX_INPUT_CHARS),
					cwd: ctx.cwd,
				},
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
		if (answer?.type !== "bool" || answer.probability < RISK_THRESHOLD) return undefined;
		return confirmOrBlock(
			ctx,
			event.toolName,
			`Classifier rates this call risky (p=${answer.probability.toFixed(2)}).`,
		);
	});
}
