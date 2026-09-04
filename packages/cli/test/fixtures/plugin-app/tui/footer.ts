import { homedir } from "node:os";
import { type Component, truncateToWidth, visibleWidth } from "@knightcode/tui";
import type { RemoteState } from "../kernel.ts";
import type { ModelsState } from "../protocol.ts";
import { dim } from "./shared.ts";

export class PluginFooter implements Component {
	private readonly models: RemoteState<ModelsState>;
	private readonly updateCount: () => number;

	constructor(models: RemoteState<ModelsState>, updateCount: () => number) {
		this.models = models;
		this.updateCount = updateCount;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const state = this.models.value;
		const home = homedir();
		const cwd = process.cwd();
		const displayCwd = cwd === home ? "~" : cwd.startsWith(`${home}/`) ? `~/${cwd.slice(home.length + 1)}` : cwd;
		const current = state.configuration.model;
		const currentSpec = current
			? state.catalog.availableModels.find(
					(model) => model.provider === current.provider && model.modelId === current.modelId,
				)
			: undefined;
		const model = current
			? `(${current.provider}) ${current.modelId}${
					currentSpec?.reasoning
						? state.configuration.thinkingLevel === "off"
							? " • thinking off"
							: ` • ${state.configuration.thinkingLevel}`
						: ""
				}`
			: "no-model";
		const left = `updates ${this.updateCount()} · catalogue r${state.catalog.revision}`;
		const right = truncateToWidth(model, Math.max(0, width - visibleWidth(left) - 2), "");
		const padding = " ".repeat(Math.max(2, width - visibleWidth(left) - visibleWidth(right)));
		// `left` is never truncated and `padding` has a floor, so a narrow viewport needs the whole
		// composed line clipped to keep the footer inside the screen.
		return [
			truncateToWidth(dim(displayCwd), width, dim("...")),
			dim(truncateToWidth(`${left}${padding}${right}`, width, "")),
		];
	}
}
