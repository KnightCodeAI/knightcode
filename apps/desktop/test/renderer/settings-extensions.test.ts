/** S8: settings sections, settings services, appearance API, theme previews in owned portals, zoom feedback. */
import {
	defineDesktopExtension,
	experimental_appearance,
	experimental_settingsServices,
	experimental_useZoom,
} from "@knightcodeai/cli/desktop";
import type * as React from "react";
import { createElement, type EffectCallback } from "react";
import { DEFAULT_STATE } from "../../src/shared/host-protocol.ts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, expect, test, vi } from "vitest";

const hostEvents = vi.hoisted(() => {
	const listeners = new Set<(event: { event: string; factor?: number }) => void>();
	Object.assign(globalThis, {
		window: { addEventListener() {}, removeEventListener() {}, knightcode: { platform: "win32" } },
	});
	return listeners;
});
const requests = vi.hoisted(() => [] as [string, unknown][]);
const folder = vi.hoisted(() => ({ path: "" }));
const configMount = vi.hoisted(() => ({ layout: undefined as EffectCallback | undefined, enabled: false }));
vi.mock("react", async (original) => {
	const react = await original<typeof React>();
	return {
		...react,
		useLayoutEffect: (effect: EffectCallback, deps?: readonly unknown[]) => {
			if (configMount.enabled) configMount.layout = effect;
			else react.useLayoutEffect(effect, deps);
		},
		useState: (initial: unknown) =>
			react.useState(
				configMount.enabled ? { cwd: undefined, read: { settings: {}, defaults: {}, origins: {} } } : initial,
			),
	};
});
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
		host: async (method: string) => {
			if (method === "host/state/read") return DEFAULT_STATE;
			if (method === "host/dialog/openFolder") return { path: folder.path };
			return {};
		},
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
import { SettingsSections, settingsScopeChoices, ThemeScope } from "../../src/renderer/extensions/settings-host.tsx";
import { ThemeProvider, usePortalOwnership } from "../../src/renderer/extensions/surface.tsx";
import { addProject, getState, removeProject } from "../../src/renderer/store.ts";

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

test("an external activation cannot grant project or plugin trust or full access through settings services", async () => {
	const dispose = initializeDesktopExtensions();
	try {
		const activation = new FrontendActivation(
			{ owner: "external-x", revision: "r1", epoch: "e1", window: "w", mount: "m" },
			globalThis.__knightcodeDesktop!,
			() => {},
		);
		activation.publish();
		activation.ready();
		const services = activation.sdk.experimental_settingsServices();
		requests.length = 0;
		await expect(services.experimental_request("project/trust/set", { cwd: "C:/p", trusted: true })).rejects.toThrow(
			/trust/,
		);
		await expect(
			services.experimental_request("plugin/set", { scope: "global", name: "p", trust: true }),
		).rejects.toThrow(/trust/);
		await expect(
			services.experimental_request("plugin/install", { scope: "global", source: "s", trust: true }),
		).rejects.toThrow(/trust/);
		expect(requests).toEqual([]);
		await services.experimental_request("plugin/set", { scope: "global", name: "p", enabled: false });
		expect(requests.map(([method]) => method)).toEqual(["plugin/set"]);
		const before = getState().desktop?.preferences?.allowFullAccess;
		expect(services.experimental_setPreference("allowFullAccess", !before)).toBe(false);
		expect(getState().desktop?.preferences?.allowFullAccess).toBe(before);
		// The built-in pages keep the host's own decisions.
		expect(experimental_settingsServices().experimental_setPreference("allowFullAccess", !before)).toBe(true);
		experimental_settingsServices().experimental_setPreference("allowFullAccess", before!);
		activation.dispose();
	} finally {
		dispose();
	}
});

test.each(["dispose", "unmount"])("a saved config writer cannot write after %s", async (retire) => {
	const dispose = initializeDesktopExtensions();
	const activation = new FrontendActivation(
		{ owner: "writer", revision: "r", epoch: "e", window: "w", mount: "m" },
		globalThis.__knightcodeDesktop!,
		() => {},
	);
	try {
		activation.publish();
		activation.ready();
		let saved: ((key: string, value: unknown) => Promise<void>) | undefined;
		const Probe = () => {
			saved = activation.sdk.experimental_settingsControls().experimental_useConfigFile(undefined)?.write;
			return null;
		};
		configMount.enabled = true;
		renderToStaticMarkup(createElement(Probe));
		const unmount = configMount.layout?.();
		const writes = () => requests.filter(([method]) => method === "config/write");
		requests.length = 0;
		await saved!("draft", "live");
		expect(writes()).toHaveLength(1);
		if (retire === "dispose") activation.dispose();
		else if (typeof unmount === "function") unmount();
		await saved!("draft", "retired");
		expect(writes()).toHaveLength(1);
	} finally {
		configMount.enabled = false;
		configMount.layout = undefined;
		activation.dispose();
		dispose();
	}
});

test("scoped schema sections offer app, each project and its live threads as explicit backend selectors", () => {
	const projects = [{ path: "C:/work/a", name: "Alpha" }, { path: "C:/work/b" }];
	const threads = [
		{ id: "t1", name: "Fix login", cwd: "C:/wt/a-1", projectCwd: "C:/work/a", archived: false },
		{ id: "t2", name: "Old", cwd: "C:/work/a", projectCwd: "C:/work/a", archived: true },
		{ id: "t3", name: "Docs", cwd: "C:/work/b", projectCwd: "C:/work/b", archived: false },
	];
	expect(settingsScopeChoices(["app"], projects, threads)).toEqual([
		{ value: "app", label: "App", selector: { scope: "app" } },
	]);
	expect(settingsScopeChoices(["app", "project"], projects, threads).map((choice) => choice.selector)).toEqual([
		{ scope: "app" },
		{ scope: "project", cwd: "C:/work/a" },
		{ scope: "project", cwd: "C:/work/b" },
	]);
	const all = settingsScopeChoices(["app", "project", "thread"], projects, threads);
	expect(all.map((choice) => choice.label)).toEqual(["App", "Alpha", "Alpha › Fix login", "b", "b › Docs"]);
	// A thread's data belongs to its project, also when it runs in a worktree elsewhere.
	expect(all[2]!.selector).toEqual({ scope: "thread", cwd: "C:/work/a", threadId: "t1" });
	expect(new Set(all.map((choice) => choice.value)).size).toBe(all.length);
});

test("a project-only schema section with two projects draws a picker; an app-only one does not", async () => {
	const dispose = initializeDesktopExtensions();
	const paths = ["C:/settings-a", "C:/settings-b"];
	try {
		for (const path of paths) {
			folder.path = path;
			await addProject();
		}
		const handle = desktopExtensions.register(
			"scoped",
			defineDesktopExtension((app) => {
				app.experimental_registerSettingsSection({
					id: "scoped",
					page: "archived",
					title: "Scoped options",
					scopes: ["project"],
					fields: [{ key: "enabled", title: "Enabled", kind: "switch" }],
				});
				app.experimental_registerSettingsSection({
					id: "plain",
					page: "archived",
					title: "Plain options",
					fields: [{ key: "enabled", title: "Enabled", kind: "switch" }],
				});
			}),
		);
		const html = renderToStaticMarkup(createElement(SettingsSections, { page: "archived" }));
		expect(html.match(/aria-label="Settings scope"/g)).toHaveLength(1);
		handle.dispose();
	} finally {
		for (const path of paths) removeProject(path);
		dispose();
	}
});
