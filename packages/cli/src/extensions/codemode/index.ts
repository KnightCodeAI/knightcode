/**
 * The `codemode` tool as an extension. The CLI loads it as a built-in extension; SDK users
 * add `createCodemodeExtension()` to their extension factories.
 *
 * `codemode` is registered inactive. Activate it with `--tools`, the `defaultTools` setting, or
 * `setActiveTools()`; the MCP extension activates it when MCP tools are only reachable from scripts.
 */

import type { ExtensionAPI, ExtensionFactory } from "../../core/extensions/types.ts";
import type { CodemodeMode } from "../../core/settings-manager.ts";
import { createCodemodeToolDefinition } from "./tool.ts";

export interface CodemodeExtensionOptions {
	/** Overrides the `codemode.mode` setting. */
	mode?: CodemodeMode;
	/** Overrides the `codemode.inlineBudget` setting. */
	inlineBudget?: number;
	/** Expose the model catalog and classifiers to scripts as `models`. Default: `true`. */
	models?: boolean;
}

function readMode(knightcode: ExtensionAPI): CodemodeMode {
	return knightcode.getSettings().codemode?.mode === "only" ? "only" : "on";
}

function readInlineBudget(knightcode: ExtensionAPI): number | undefined {
	const budget = knightcode.getSettings().codemode?.inlineBudget;
	return typeof budget === "number" && Number.isFinite(budget) && budget >= 0 ? budget : undefined;
}

export function createCodemodeExtension(options: CodemodeExtensionOptions = {}): ExtensionFactory {
	return (knightcode) => {
		knightcode.registerTool({
			...createCodemodeToolDefinition({
				appendEntry: (customType, data) => knightcode.appendEntry(customType, data),
				models: options.models ?? true,
				getToolNamespace: (name) => knightcode.getAllTools().find((tool) => tool.name === name)?.namespace,
				getToolGuidelines: () =>
					new Map(knightcode.getAllTools().map((tool) => [tool.name, tool.promptGuidelines ?? []] as const)),
				getMode: () => options.mode ?? readMode(knightcode),
				getInlineBudget: () => options.inlineBudget ?? readInlineBudget(knightcode),
			}),
			defaultActive: false,
		});
	};
}

export default createCodemodeExtension();
