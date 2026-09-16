import type { SettingItem } from "@knightcode/tui";
import type { Theme } from "@knightcodeai/cli";
import { SelectSubmenu } from "@knightcodeai/cli/modes/interactive/components/settings-submenu";
import { maskKey, TextSubmenu } from "../settings.ts";
import type { ToolSettings } from "../state.ts";

/** The /tools websearch rows: which provider to search with, and the key Brave needs. */
export function websearchSettings(current: ToolSettings, theme: Theme): SettingItem[] {
	const key = typeof current.braveApiKey === "string" ? current.braveApiKey : "";
	return [
		{
			id: "provider",
			label: "Provider",
			description: "DuckDuckGo needs no key but may rate-limit; Brave Search needs an API key.",
			currentValue: current.provider === "brave" ? "brave" : "duckduckgo",
			submenu: (currentValue, done) =>
				new SelectSubmenu(
					"Provider",
					"",
					[
						{ value: "duckduckgo", label: "DuckDuckGo", description: "No key needed; may rate-limit" },
						{ value: "brave", label: "Brave Search", description: "Needs an API key" },
					],
					currentValue,
					// Picking Brave with no key stored hands the cursor to the key row, which opens its prompt.
					(value) => done(value, value === "brave" && !current.braveApiKey ? { navigateTo: "braveApiKey" } : undefined),
					() => done(),
				),
		},
		{
			id: "braveApiKey",
			label: "Brave API key",
			description: "Get one at https://brave.com/search/api/ — the free plan is enough. Also read from BRAVE_API_KEY.",
			currentValue: key ? maskKey(key) : "not set",
			submenu: (_currentValue, done) =>
				new TextSubmenu(
					theme,
					"Brave API key",
					"Paste the key; submit empty to clear it",
					(value) => done(value),
					() => done(),
				),
		},
	];
}
