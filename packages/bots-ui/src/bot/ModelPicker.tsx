// Model and thinking level, from the models the user's connected providers offer. Never a built-in list.
import type { ModelOption, ModelRef } from "@knightcode/bots-protocol";
import { Select } from "../primitives/Select.tsx";
import { navigate } from "../shell/routes.ts";
import { useResource } from "../state/store.ts";

const THINKING_LABELS: Record<string, string> = { off: "Off", low: "Low", medium: "Medium", high: "High" };

export const modelKey = (model: Pick<ModelRef, "provider" | "modelId">) => `${model.provider}/${model.modelId}`;

/** The API's models; empty until the user connects a provider. */
export function useModels(): ModelOption[] {
	const { data } = useResource("models", (api) => api.listModels({}));
	return data?.models ?? [];
}

/** Two selects: model, then thinking when the model offers levels. */
export function ModelPicker({ value, onChange }: { value: ModelRef; onChange: (model: ModelRef) => void }) {
	const models = useModels();
	const current = models.find((m) => modelKey(m) === modelKey(value));
	if (models.length === 0)
		return (
			<p className="kb-settings__hint">
				No models yet.{" "}
				<button
					type="button"
					className="kb-link-button"
					onClick={() => navigate({ name: "settings", section: "account" })}
				>
					Connect a provider
				</button>
			</p>
		);
	return (
		<div className="kb-model-picker">
			<Select
				label="Model"
				value={modelKey(value)}
				onValueChange={(key) => {
					const picked = models.find((m) => modelKey(m) === key);
					if (picked)
						onChange({
							provider: picked.provider,
							modelId: picked.modelId,
							thinking: picked.thinking.includes(value.thinking ?? "") ? value.thinking : picked.thinking[0],
						});
				}}
				options={models.map((m) => ({ value: modelKey(m), label: m.name }))}
			/>
			{current && current.thinking.length > 0 && (
				<Select
					label="Thinking"
					value={value.thinking ?? current.thinking[0]!}
					onValueChange={(thinking) => onChange({ ...value, thinking })}
					options={current.thinking.map((level) => ({ value: level, label: THINKING_LABELS[level] ?? level }))}
				/>
			)}
		</div>
	);
}
