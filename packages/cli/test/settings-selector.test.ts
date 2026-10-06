import { setKeybindings, type SettingsList } from "@knightcode/tui";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import {
	type SettingsCallbacks,
	type SettingsConfig,
	SettingsSelectorComponent,
} from "../src/modes/interactive/components/settings-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import { createHarness, type Harness } from "./suite/harness.ts";

function openSettings(harness: Harness): SettingsList {
	const showSettingsSelector = (InteractiveMode.prototype as unknown as { showSettingsSelector(): void })
		.showSettingsSelector;
	let list: SettingsList | undefined;
	showSettingsSelector.call({
		session: harness.session,
		settingsManager: harness.settingsManager,
		themeController: { getThemeSelection: () => "dark", getTerminalTheme: () => "dark" },
		hideThinkingBlock: false,
		ui: { mode: "fullscreen" },
		showSelector(create: (done: () => void) => { component: SettingsSelectorComponent; focus: SettingsList }) {
			list = create(() => {}).focus;
		},
	});
	if (!list) throw new Error("Settings selector did not open");
	return list;
}

describe("SettingsSelectorComponent", () => {
	let harness: Harness | undefined;
	beforeAll(() => {
		initTheme("dark");
		setKeybindings(new KeybindingsManager());
	});

	afterEach(() => {
		harness?.cleanup();
		harness = undefined;
		vi.unstubAllEnvs();
	});

	it("defaults automatic updates to on and saves toggles through /settings", async () => {
		harness = await createHarness();
		const list = openSettings(harness);
		for (const character of "Automatic updates") list.handleInput(character);
		expect(stripAnsi(list.render(160).join("\n"))).toMatch(/Automatic updates\s+true/);

		list.handleInput("\r");
		await harness.settingsManager.flush();
		expect(harness.settingsManager.getGlobalSettings().autoUpdate).toBe(false);
		expect(harness.settingsManager.getAutoUpdate()).toBe(false);
		expect(stripAnsi(list.render(160).join("\n"))).toMatch(/Automatic updates\s+false/);

		await harness.settingsManager.reload();
		const reopened = openSettings(harness);
		reopened.selectItem("auto-update");
		expect(stripAnsi(reopened.render(160).join("\n"))).toMatch(/Automatic updates\s+false/);

		reopened.handleInput("\r");
		await harness.settingsManager.flush();
		expect(harness.settingsManager.getGlobalSettings().autoUpdate).toBe(true);
		expect(harness.settingsManager.getAutoUpdate()).toBe(true);
		expect(stripAnsi(reopened.render(160).join("\n"))).toMatch(/Automatic updates\s+true/);
	});

	it.each([true, false])("shows the saved preference %s and explains environment overrides", async (enabled) => {
		vi.stubEnv("KNIGHTCODE_DISABLE_AUTO_UPDATE", "1");
		harness = await createHarness({ settings: { autoUpdate: enabled } });
		const list = openSettings(harness);
		list.selectItem("auto-update");
		const output = stripAnsi(list.render(160).join("\n"));
		expect(output).toMatch(new RegExp(`Automatic updates\\s+${enabled}`));
		expect(output).toContain("KNIGHTCODE_DISABLE_AUTO_UPDATE");
		expect(output).toContain("KNIGHTCODE_SKIP_VERSION_CHECK");
	});

	it("cycles through fullscreen settings", () => {
		const onExitOutputChange = vi.fn();
		const onScrollbarChange = vi.fn();
		const onCopyOnSelectChange = vi.fn();
		const onWheelScrollLinesChange = vi.fn();
		const config = {
			fullscreenExitOutput: "transcript",
			fullscreenScrollbar: "auto",
			fullscreenCopyOnSelect: true,
			fullscreenWheelScrollLines: 7,
			warnings: {},
			defaultModel: "not set",
			availableDefaultModels: [],
			availableThinkingLevels: [],
			modelThinkingLevels: {},
			availableThemes: [],
		} as unknown as SettingsConfig;
		const callbacks = {
			onFullscreenExitOutputChange: onExitOutputChange,
			onFullscreenScrollbarChange: onScrollbarChange,
			onFullscreenCopyOnSelectChange: onCopyOnSelectChange,
			onFullscreenWheelScrollLinesChange: onWheelScrollLinesChange,
		} as unknown as SettingsCallbacks;

		const cycle = (label: string, count: number) => {
			const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();
			for (const character of label) list.handleInput(character);
			for (let i = 0; i < count; i++) list.handleInput("\r");
		};

		cycle("Fullscreen exit output", 2);
		expect(onExitOutputChange.mock.calls.flat()).toEqual(["resume-hint", "transcript"]);
		cycle("Fullscreen scrollbar", 3);
		expect(onScrollbarChange.mock.calls.flat()).toEqual(["always", "hidden", "auto"]);
		cycle("Fullscreen copy on select", 2);
		expect(onCopyOnSelectChange.mock.calls.flat()).toEqual([false, true]);
		// Custom values from settings.json stay in the cycle.
		cycle("Fullscreen wheel scrolling", 3);
		expect(onWheelScrollLinesChange.mock.calls.flat()).toEqual([10, "auto", 1]);
	});

	it("keeps the configured fixed theme marked while browsing", () => {
		const config = {
			defaultModel: "not set",
			availableDefaultModels: [],
			modelThinkingLevels: {},
			currentTheme: "dark",
			terminalTheme: "dark",
			availableThemes: ["system", "dark", "light"],
			warnings: {},
		} as unknown as SettingsConfig;
		const callbacks = { onThemePreview: vi.fn(), onCancel: () => {} } as unknown as SettingsCallbacks;
		const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

		list.selectItem("theme");
		list.handleInput("\r");
		let output = stripAnsi(list.render(120).join("\n"));
		expect(output).toMatch(/ {4}system +Theme created from your terminal's colors\n {4}automatic +Use separate themes/);
		expect(output).toContain("→ ✓ dark");

		list.handleInput("\x1b[B");
		output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("  ✓ dark");
		expect(output).toContain("→   light");
	});

	it("keeps a configured automatic theme marked while browsing", () => {
		const config = {
			defaultModel: "not set",
			availableDefaultModels: [],
			modelThinkingLevels: {},
			currentTheme: "light/dark",
			terminalTheme: "dark",
			availableThemes: ["dark", "light", "other"],
			warnings: {},
		} as unknown as SettingsConfig;
		const callbacks = { onThemePreview: vi.fn(), onCancel: () => {} } as unknown as SettingsCallbacks;
		const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

		list.selectItem("theme");
		list.handleInput("\r");
		list.handleInput("\r");
		let output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("→ ✓ light");

		list.handleInput("\x1b[B");
		output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("  ✓ light");
		expect(output).toContain("→   other");
	});

	it("keeps the configured per-model thinking level marked while browsing", async () => {
		harness = await createHarness({
			models: [{ id: "thinking-model", reasoning: true }],
		});
		const model = harness.getModel("thinking-model")!;
		const modelKey = `${model.provider}/${model.id}`;
		const config = {
			defaultModel: modelKey,
			availableDefaultModels: [model],
			thinkingLevel: "high",
			modelThinkingLevels: { [modelKey]: "medium" },
		} as unknown as SettingsConfig;
		const callbacks = { onCancel: () => {} } as unknown as SettingsCallbacks;
		const list = new SettingsSelectorComponent(config, callbacks).getSettingsList();

		list.selectItem("model-thinking");
		list.handleInput("\r");
		list.handleInput("\r");

		let output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("→ ✓ medium");
		expect(output).toContain("    (clear override)");

		list.handleInput("\x1b[B");
		output = stripAnsi(list.render(120).join("\n"));
		expect(output).toContain("  ✓ medium");
		expect(output).toContain("→   high");
	});
});
