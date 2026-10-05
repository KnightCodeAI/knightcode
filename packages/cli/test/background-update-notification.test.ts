import { Container } from "@knightcode/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import type { ThemedText } from "../src/modes/interactive/components/themed-text.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import type { BackgroundUpdateState } from "../src/utils/background-update.ts";

const methods = InteractiveMode.prototype as unknown as {
	showBackgroundUpdateNotification(state: BackgroundUpdateState): void;
	renderWidgetContainer(
		container: Container,
		widgets: Map<string, ThemedText>,
		spacer: boolean,
		leading: boolean,
	): void;
};

function fixture() {
	return {
		isInitialized: true,
		isShuttingDown: false,
		updateState: undefined as BackgroundUpdateState | undefined,
		updateNotice: undefined as ThemedText | undefined,
		widgetContainerBelow: new Container(),
		renderWidgets: vi.fn(),
		showStatus: vi.fn(),
		showNewVersionNotification: vi.fn(),
		updateTerminalTitle: vi.fn(),
		sessionManager: { isPersisted: () => false },
	};
}

describe("update notices", () => {
	beforeAll(() => initTheme("dark"));

	it("keeps the same notice visible when the download finishes", () => {
		const target = fixture();
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "downloading" });
		const notice = target.updateNotice;
		expect(notice?.render(120).join("\n")).toContain("Downloading KnightCode 1.0.1");
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "ready" });
		expect(target.updateNotice).toBe(notice);
		expect(notice?.render(120).join("\n")).toContain("restart to apply");
		methods.renderWidgetContainer.call(target, target.widgetContainerBelow, new Map(), false, false);
		expect(target.widgetContainerBelow.children).toEqual([notice]);
	});

	it("does not repeat the manual update banner on each hourly check", () => {
		const target = fixture();
		const state = { release: { version: "1.0.1" }, phase: "available" } as const;
		methods.showBackgroundUpdateNotification.call(target, state);
		methods.showBackgroundUpdateNotification.call(target, state);
		expect(target.showNewVersionNotification).toHaveBeenCalledOnce();
	});

	it("falls back to the manual banner when the worker cannot update this install", () => {
		const target = fixture();
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "downloading" });
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "available" });
		expect(target.updateNotice).toBeUndefined();
		expect(target.showNewVersionNotification).toHaveBeenCalledOnce();
	});

	it("does not repaint a stopped TUI", () => {
		const target = fixture();
		target.isInitialized = false;
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "ready" });
		expect(target.renderWidgets).not.toHaveBeenCalled();
		expect(target.showStatus).not.toHaveBeenCalled();
	});
});
