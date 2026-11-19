/** S8: settings sections, settings services, appearance API, theme previews in owned portals, zoom feedback. */
import {
	defineDesktopExtension,
	experimental_appearance,
	experimental_settingsServices,
	experimental_useZoom,
} from "@knightcodeai/cli/desktop";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, expect, test, vi } from "vitest";

const hostEvents = vi.hoisted(() => {
	const listeners = new Set<(event: { event: string; factor?: number }) => void>();
	Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } });
	return listeners;
});
const requests = vi.hoisted(() => [] as [string, unknown][]);
vi.mock("../../src/renderer/client.ts", () => ({
	client: {
		onNotification: () => () => {},
		onServerRequest: () => () => {},
		onHostEvent: (listener: (event: { event: string; factor?: number }) => void) => {
			hostEvents.add(listener);
			return () => hostEvents.delete(listener);
		},
		request: (method: string, params: unknown) => {
			requests.push([method, params]);
			return Promise.resolve({});
		},
		host: async (method: string) =>
			method === "host/state/read" ? (await import("../../src/shared/host-protocol.ts")).DEFAULT_STATE : {},
	},
	RequestError: class extends Error {},
}));
// Server rendering has no store snapshot; sections receive the same explicit context the host passes.
vi.mock("../../src/renderer/extensions/command-context.ts", () => ({
	useCommandContext: () => ({ sidebarOpen: true }),
}));

import { FrontendActivation } from "../../src/renderer/extensions/activation.ts";
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { desktopExtensions } from "../../src/renderer/extensions/runtime.ts";
import { SettingsSections, ThemeScope } from "../../src/renderer/extensions/settings-host.tsx";
import { ThemeProvider, usePortalOwnership } from "../../src/renderer/extensions/surface.tsx";
import { getState } from "../../src/renderer/store.ts";

const context = { sidebarOpen: true };

// The store loads desktop state when the server reports ready; preference writes need it.
beforeAll(async () => {
	for (const listener of hostEvents) listener({ event: "server/state", state: "ready" } as never);
	await vi.waitFor(() => expect(getState().desktop).toBeDefined());
});

test("built-in settings register every page as a section plus the shell and column providers", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const pages = desktopExtensions
			.getSnapshot()
			.flatMap((entry) => (entry.kind === "settingsSection" ? [entry.contribution.page] : []));
		expect(pages.toSorted()).toEqual(
			[
				"general",
				"appearance",
				"models",
				"shortcuts",
				"configuration",
				"tools",
				"mcp",
				"extensions",
				"plugins",
				"worktrees",
				"about",
			].toSorted(),
		);
		expect(desktopExtensions.getSnapshot().flatMap((entry) => (entry.kind === "provider" ? [entry.id] : []))).toEqual(
			expect.arrayContaining(["builtin.settings/default", "builtin.settings/nav"]),
		);
	} finally {
		dispose();
	}
});

test("external sections order after built-ins, and the recovery page admits only built-in sections", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const handle = desktopExtensions.register(
			"example",
			defineDesktopExtension((app) => {
				for (const page of ["general", "extensions"] as const)
					app.experimental_registerSettingsSection({
						id: `extra-${page}`,
						page,
						experimental_render: () => createElement("p", null, `extra ${page}`),
					});
			}),
		);
		expect(desktopExtensions.settingsSections("general", context, false).map((s) => s.id)).toEqual([
			"builtin.settings/general",
			"example/extra-general",
		]);
		expect(desktopExtensions.settingsSections("extensions", context, true).map((s) => s.id)).toEqual([
			"builtin.settings/extensions",
		]);
		handle.dispose();
		expect(desktopExtensions.settingsSections("general", context, false).map((s) => s.id)).toEqual([
			"builtin.settings/general",
		]);
	} finally {
		dispose();
	}
});

test("each section mounts at its own ownership root, after the page's built-in body", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const handle = desktopExtensions.register(
			"owned",
			defineDesktopExtension((app) => {
				app.experimental_registerSettingsSection({
					id: "notes",
					page: "archived",
					experimental_render: () => createElement("p", null, "owned section"),
				});
			}),
		);
		const html = renderToStaticMarkup(createElement(SettingsSections, { page: "archived" }));
		expect(html).toMatch(/data-kc-owner="owned"[^>]*>[^]*owned section/);
		handle.dispose();
		expect(renderToStaticMarkup(createElement(SettingsSections, { page: "archived" }))).not.toContain("owned section");
	} finally {
		dispose();
	}
});

test("a declarative section without a backend says so instead of reading another store", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const handle = desktopExtensions.register(
			"schema",
			defineDesktopExtension((app) => {
				app.experimental_registerSettingsSection({
					id: "options",
					page: "archived",
					title: "Schema options",
					fields: [{ key: "enabled", title: "Enabled", kind: "switch" }],
				});
			}),
		);
		const html = renderToStaticMarkup(createElement(SettingsSections, { page: "archived" }));
		expect(html).toContain("Schema options");
		expect(html).toContain("This section needs a desktop backend.");
		handle.dispose();
	} finally {
		dispose();
	}
});

test("settings requests outside the allowlist are refused before reaching the app server", async () => {
	const dispose = initializeDesktopExtensions();
	try {
		requests.length = 0;
		const services = experimental_settingsServices();
		await services.experimental_request("config/read", {});
		await expect(services.experimental_request("thread/start" as "config/read", {} as never)).rejects.toThrow(
			"Unsupported settings method: thread/start",
		);
		expect(requests.map(([method]) => method)).toEqual(["config/read"]);
	} finally {
		dispose();
	}
});

test("appearance intents write preferences; a retired activation's handles go inert", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const app = experimental_appearance();
		expect(app.experimental_customize("dark", { accent: "#3566F0", background: "not-hex" })).toBe(true);
		expect(getState().desktop?.preferences?.appearance?.dark).toEqual({ accent: "#3566f0" });
		const activation = new FrontendActivation(
			{ owner: "theme", revision: "r1", epoch: "e1", window: "w", mount: "m" },
			globalThis.__knightcodeDesktop!,
			() => {},
		);
		activation.publish();
		activation.ready();
		const scoped = activation.sdk.experimental_appearance();
		expect(scoped.experimental_setMode("light")).toBe(true);
		expect(getState().desktop?.preferences?.theme).toBe("light");
		activation.dispose();
		expect(scoped.experimental_setMode("dark")).toBe(false);
		expect(getState().desktop?.preferences?.theme).toBe("light");
		const services = activation.sdk.experimental_settingsServices();
		expect(services.experimental_setPreference("allowFullAccess", true)).toBe(false);
	} finally {
		dispose();
	}
});

test("theme presets list with owner ids and apply only through the explicit appearance API", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const before = getState().desktop?.preferences?.appearance?.light;
		const handle = desktopExtensions.register(
			"presets",
			defineDesktopExtension((app) => {
				app.experimental_registerThemePreset({
					id: "sea",
					label: "Sea",
					theme: "light",
					customization: { accent: "#04bb9f" },
				});
			}),
		);
		expect(getState().desktop?.preferences?.appearance?.light).toEqual(before);
		const app = experimental_appearance();
		expect(app.experimental_applyPreset("presets/sea")).toBe(true);
		expect(getState().desktop?.preferences?.appearance?.light).toEqual({ accent: "#04bb9f" });
		handle.dispose();
		expect(app.experimental_applyPreset("presets/sea")).toBe(false);
	} finally {
		dispose();
	}
});

test("zoom feedback state follows host zoom events for the host lifetime, not the presenter's", () => {
	const dispose = initializeDesktopExtensions();
	try {
		for (const listener of hostEvents) listener({ event: "zoom", factor: 1.25 });
		let read: { factor: number; changes: number } | undefined;
		function Probe() {
			read = experimental_useZoom();
			return null;
		}
		renderToStaticMarkup(createElement(Probe));
		expect(read?.factor).toBe(1.25);
		expect(read?.changes).toBeGreaterThan(0);
	} finally {
		dispose();
	}
});

test("overlay roots opened inside a theme preview are marked with the previewed theme", () => {
	function Overlay() {
		return createElement("div", { ...usePortalOwnership(), id: "overlay" });
	}
	const inside = renderToStaticMarkup(
		createElement(ThemeProvider, { value: { theme: "light", tokens: {} }, children: createElement(Overlay) }),
	);
	const tokens = renderToStaticMarkup(
		createElement(ThemeProvider, {
			value: { theme: "dark", tokens: { "--kc-accent": "rgb(1 2 3)" } },
			children: createElement(Overlay),
		}),
	);
	expect(tokens).toContain("--kc-accent:rgb(1 2 3)");
	expect(inside).toContain('data-theme="light"');
	expect(renderToStaticMarkup(createElement(Overlay))).not.toContain("data-theme");
});

test("the theme preview applies the customization's derived tokens to its subtree only", () => {
	const html = renderToStaticMarkup(
		createElement(ThemeScope, { theme: "dark", customization: { accent: "#3566f0" }, children: "preview" }),
	);
	expect(html).toContain('data-theme="dark"');
	expect(html).toContain("--kc-accent:rgb(53 102 240)");
});

test("an extension preference write outside the preference schema is refused and changes nothing", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const services = experimental_settingsServices();
		const before = getState().desktop?.preferences;
		expect(services.experimental_setPreference("sendKey", "space" as "enter")).toBe(false);
		expect(services.experimental_setPreference("autoArchiveDays", "7" as unknown as number)).toBe(false);
		expect(getState().desktop?.preferences).toBe(before);
		expect(services.experimental_setPreference("autoArchiveDays", 7)).toBe(true);
		expect(getState().desktop?.preferences?.autoArchiveDays).toBe(7);
	} finally {
		dispose();
	}
});

test("keybinding writes need a known binding id and string keys", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const services = experimental_settingsServices();
		expect(services.experimental_setKeybinding("desktop.not-a-binding", ["Ctrl+K"])).toBe(false);
		expect(services.experimental_setKeybinding("desktop.palette", [1 as unknown as string])).toBe(false);
		expect(services.experimental_setKeybinding("desktop.palette", ["Ctrl+Shift+K"])).toBe(true);
		expect(getState().desktop?.preferences?.keybindings?.["desktop.palette"]).toEqual(["Ctrl+Shift+K"]);
		expect(services.experimental_setKeybinding("desktop.palette", undefined)).toBe(true);
	} finally {
		dispose();
	}
});
