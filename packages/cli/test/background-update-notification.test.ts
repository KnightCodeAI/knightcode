import { type Component, Container, Text, visibleWidth } from "@knightcode/tui";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { getMarkdownTheme, initTheme, theme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import type { BackgroundUpdateState } from "../src/utils/background-update.ts";

const methods = InteractiveMode.prototype as unknown as {
	showBackgroundUpdateNotification(state: BackgroundUpdateState): void;
	renderWidgets(): void;
	showStatus(message: string): void;
	renderWidgetContainer(container: Container, widgets: Map<string, Component>, spacer: boolean, leading: boolean): void;
};

function fixture() {
	return {
		isInitialized: true,
		isShuttingDown: false,
		updateState: undefined as BackgroundUpdateState | undefined,
		updateNotice: undefined as Component | undefined,
		updateNoteVersion: undefined as string | undefined,
		chatContainer: new Container(),
		getMarkdownThemeWithSettings: getMarkdownTheme,
		widgetContainerAbove: new Container(),
		widgetContainerBelow: new Container(),
		extensionWidgetsAbove: new Map<string, Component>(),
		extensionWidgetsBelow: new Map<string, Component>(),
		ui: { requestRender: vi.fn() },
		renderWidgetContainer: methods.renderWidgetContainer,
		renderWidgets: vi.fn(function (this: object) {
			methods.renderWidgets.call(this);
		}),
		showStatus: vi.fn(function (this: object, message: string) {
			methods.showStatus.call(this, message);
		}),
		showNewVersionNotification: vi.fn(),
		updateTerminalTitle: vi.fn(),
		sessionManager: { isPersisted: () => false },
	};
}

function render(container: Container): string {
	return container.children.flatMap((child) => child.render(120)).join("\n");
}

describe("update notices", () => {
	beforeAll(() => initTheme("dark"));

	it("keeps the same notice visible when the download finishes", () => {
		const target = fixture();
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "downloading" });
		const notice = target.updateNotice;
		expect(stripAnsi(notice!.render(120).join("\n")).trim()).toBe("Downloading v1.0.1");
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "ready" });
		expect(target.updateNotice).toBe(notice);
		expect(stripAnsi(notice!.render(120).join("\n")).trim()).toBe("Restart for v1.0.1");
		expect(target.widgetContainerAbove.children.at(-1)).toBe(notice);
		expect(target.widgetContainerBelow.render(120)).toEqual([]);
		expect(stripAnsi(render(target.chatContainer))).toContain("Restart: knightcode");
	});

	it("keeps the notice directly above the input, after extension widgets", () => {
		const target = fixture();
		target.extensionWidgetsAbove.set("above", new Text("Above widget", 0, 0));
		target.extensionWidgetsBelow.set("below", new Text("Below widget", 0, 0));
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "downloading" });
		const lines = target.widgetContainerAbove.render(40).map(stripAnsi);
		expect(lines.at(-2)?.trim()).toBe("Above widget");
		expect(lines.at(-1)).toBe(" ".repeat(21) + "Downloading v1.0.1 ");
		expect(stripAnsi(render(target.widgetContainerBelow)).trim()).toBe("Below widget");
	});

	it.each([
		{ phase: "downloading", text: "Downloading v1.0.1", color: "muted" },
		{ phase: "verifying", text: "Verifying v1.0.1", color: "muted" },
		{ phase: "ready", text: "Restart for v1.0.1", color: "success" },
		{ phase: "failed", text: "v1.0.1 failed · knightcode update", color: "error" },
		{ phase: "waiting", text: "v1.0.1 updating elsewhere", color: "warning" },
	] as const)("renders a concise, colored $phase notice", ({ phase, text, color }) => {
		const target = fixture();
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase });
		const lines = target.updateNotice!.render(80);
		expect(lines).toHaveLength(1);
		expect(stripAnsi(lines[0]!).trim()).toBe(text);
		expect(lines[0]).toContain(theme.fg(color, text));
		expect(visibleWidth(lines[0]!)).toBe(80);
		expect(stripAnsi(lines[0]!)).toMatch(/\S $/);
	});

	it.each([0, 1, 8, 20, 40, 120])("fits one right-aligned line at width %s without ellipses", (width) => {
		const target = fixture();
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "downloading" });
		const lines = target.updateNotice!.render(width);
		expect(lines).toHaveLength(1);
		expect(visibleWidth(lines[0]!)).toBe(width);
		expect(stripAnsi(lines[0]!)).not.toMatch(/\.\.\.|…/);
	});

	it("recolors the ready notice when the theme changes", () => {
		const target = fixture();
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "ready" });
		const darkLine = target.updateNotice!.render(80)[0];
		try {
			initTheme("light");
			target.widgetContainerAbove.invalidate();
			const lightLine = target.updateNotice!.render(80)[0];
			expect(lightLine).not.toBe(darkLine);
			expect(lightLine).toContain(theme.fg("success", "Restart for v1.0.1"));
		} finally {
			initTheme("dark");
		}
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
		expect(stripAnsi(render(target.widgetContainerAbove)).trim()).toBe("");
		expect(target.widgetContainerBelow.render(120)).toEqual([]);
		expect(target.showNewVersionNotification).toHaveBeenCalledOnce();
	});

	it("shows the manual banner again when an hourly check finds a newer release", () => {
		const target = fixture();
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "available" });
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.2" }, phase: "available" });
		expect(target.showNewVersionNotification).toHaveBeenCalledTimes(2);
		expect(target.showNewVersionNotification).toHaveBeenLastCalledWith(expect.objectContaining({ version: "1.0.2" }));
	});

	it("does not repeat a release note when the download falls back to the manual banner", () => {
		const target = fixture();
		const release = { version: "1.0.1", note: "Breaking: config moved" };
		methods.showBackgroundUpdateNotification.call(target, { release, phase: "downloading" });
		expect(render(target.chatContainer)).toContain("Breaking: config moved");
		methods.showBackgroundUpdateNotification.call(target, { release, phase: "available" });
		expect(target.showNewVersionNotification).toHaveBeenCalledWith({ version: "1.0.1", note: undefined });
	});

	it("does not repaint a stopped TUI", () => {
		const target = fixture();
		target.isInitialized = false;
		methods.showBackgroundUpdateNotification.call(target, { release: { version: "1.0.1" }, phase: "ready" });
		expect(target.renderWidgets).not.toHaveBeenCalled();
		expect(target.showStatus).not.toHaveBeenCalled();
	});
});
