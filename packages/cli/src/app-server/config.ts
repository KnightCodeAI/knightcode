/**
 * Settings files over the protocol (§4.4). A read pairs every scope's settings with the version of the
 * same bytes; a write is compare-and-swap on that version, inside the file lock the terminal's
 * SettingsManager takes. Parsing and migration are SettingsManager's, run over the bytes read here.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type { Warning } from "@knightcode/app-server-protocol";
import { CONFIG_DIR_NAME } from "../config.ts";
import {
	FileSettingsStorage,
	InMemorySettingsStorage,
	type Settings,
	SettingsManager,
	type SettingsScope,
} from "../core/settings-manager.ts";
import { SETTINGS_DEFAULTS } from "../core/settings-defaults.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "../core/trust-manager.ts";
import { resolvePath } from "../utils/paths.ts";

const versionOf = (content: string | undefined) =>
	content === undefined ? "none" : createHash("sha256").update(content).digest("hex");

/** Line and column of a JSON parse error, from either message style JSON.parse produces. */
export function positionOf(content: string, error: unknown): { line?: number; column?: number } {
	const message = error instanceof Error ? error.message : "";
	const lineColumn = /line (\d+) column (\d+)/i.exec(message);
	if (lineColumn) return { line: Number(lineColumn[1]), column: Number(lineColumn[2]) };
	const position = /position (\d+)/i.exec(message);
	if (!position) return {};
	const lines = content.slice(0, Number(position[1])).split("\n");
	return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Every set leaf records the last layer that set it; absent leaves use defaults. */
function originsOf(global: Settings, project: Settings): Record<string, SettingsScope> {
	const origins: Record<string, SettingsScope> = {};
	const walk = (value: unknown, prefix: string, origin: SettingsScope) => {
		if (typeof value === "object" && value !== null && !Array.isArray(value)) {
			for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key, origin);
		} else if (prefix) origins[prefix] = origin;
	};
	walk(global, "", "global");
	walk(project, "", "project");
	return origins;
}

function readContent(storage: FileSettingsStorage, scope: SettingsScope): string | undefined {
	let content: string | undefined;
	storage.withLock(scope, (current) => {
		content = current;
		return undefined;
	});
	return content;
}

/** A manager over exactly these bytes: the same parse, migration and merge the terminal applies. */
function managerOver(contents: Partial<Record<SettingsScope, string>>): SettingsManager {
	const memory = new InMemorySettingsStorage();
	for (const [scope, content] of Object.entries(contents) as [SettingsScope, string | undefined][])
		memory.withLock(scope, () => content);
	return SettingsManager.fromStorage(memory);
}

/** Whether a project's own files are read: it has nothing that needs trust, or the user trusted it. */
export function projectReadable(agentDir: string, cwd: string): boolean {
	return !hasTrustRequiringProjectResources(cwd) || new ProjectTrustStore(agentDir).get(cwd) === true;
}

/** An untrusted project's file is not read: it reports no settings and version "none". */
export function readSettings(agentDir: string, cwd: string | undefined, projectTrusted: boolean) {
	const storage = new FileSettingsStorage(cwd ?? process.cwd(), agentDir);
	const contents: Partial<Record<SettingsScope, string>> = { global: readContent(storage, "global") };
	if (cwd !== undefined && projectTrusted) contents.project = readContent(storage, "project");
	const manager = managerOver(contents);
	const paths = {
		global: join(resolvePath(agentDir), "settings.json"),
		...(cwd !== undefined ? { project: join(resolvePath(cwd), CONFIG_DIR_NAME, "settings.json") } : {}),
	};
	const errors = manager.drainErrors().map(({ scope, error }): Warning => ({
		source: "settings",
		path: paths[scope],
		message: error.message,
		...positionOf(contents[scope] ?? "", error),
	}));
	return {
		settings: manager.getSettings(),
		defaults: SETTINGS_DEFAULTS,
		origins: originsOf(manager.getGlobalSettings(), manager.getProjectSettings()),
		versions: {
			global: versionOf(contents.global),
			...(cwd !== undefined ? { project: versionOf(contents.project) } : {}),
		},
		paths,
		errors,
	};
}

/** Set (or, for null, delete) one leaf when the file still has `expectedVersion`. A corrupt file is never written. */
export function writeSetting(
	agentDir: string,
	cwd: string | undefined,
	scope: SettingsScope,
	keyPath: string[],
	value: unknown,
	expectedVersion?: string,
): { ok: boolean; version: string } {
	let result = { ok: false, version: "none" };
	new FileSettingsStorage(cwd ?? process.cwd(), agentDir).withLock(scope, (current) => {
		const version = versionOf(current);
		if (expectedVersion !== undefined && expectedVersion !== version) {
			result = { ok: false, version };
			return undefined;
		}
		const manager = managerOver({ [scope]: current });
		const [loadError] = manager.drainErrors();
		if (loadError) throw loadError.error;
		const data = (scope === "global" ? manager.getGlobalSettings() : manager.getProjectSettings()) as Record<
			string,
			unknown
		>;
		let node = data;
		for (const key of keyPath.slice(0, -1)) {
			const next = node[key];
			if (typeof next !== "object" || next === null || Array.isArray(next)) node[key] = {};
			node = node[key] as Record<string, unknown>;
		}
		const leaf = keyPath[keyPath.length - 1];
		if (value === null) delete node[leaf];
		else node[leaf] = value;
		const text = JSON.stringify(data, null, 2);
		result = { ok: true, version: versionOf(text) };
		return text;
	});
	return result;
}
