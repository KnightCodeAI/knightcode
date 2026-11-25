import { defineDesktopExtension, type experimental_CommandContext } from "@knightcodeai/cli/desktop";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import commands from "../../src/renderer/builtins/commands/index.ts";
import feedback from "../../src/renderer/builtins/feedback/index.tsx";
import { ExtensionRegistry } from "../../src/renderer/extensions/registry.ts";
import { ContributionRoot, SurfaceHost } from "../../src/renderer/extensions/surface.tsx";

const context: experimental_CommandContext = { sidebarOpen: true };

test("quick actions retain labels, order, availability and explicit terminal target", () => {
	const calls: unknown[] = [];
	Object.assign(globalThis, {
		__knightcodeDesktop: {
			experimental_controllers: {
				experimental_showNew: () => calls.push("new"),
				experimental_toggleTerminal: (thread: unknown) => calls.push(thread),
			},
		},
	});
	const registry = new ExtensionRegistry();
	registry.register("builtin.commands", commands);
	expect(registry.commands(context).map((entry) => entry.contribution.label(context))).toEqual([
		"New thread",
		"Open folder",
		"Hide sidebar",
		"Settings",
		"Keyboard shortcuts",
	]);
	const target = { ...context, thread: { id: "A", cwd: "/A" } };
	const entries = registry.commands(target);
	expect(entries.map((entry) => entry.contribution.label(target))).toEqual([
		"New thread",
		"Open folder",
		"Hide sidebar",
		"Toggle terminal",
		"New terminal",
		"Settings",
		"Keyboard shortcuts",
	]);
	registry.runCommand(entries[0]!, target);
	registry.runCommand(entries[3]!, target);
	expect(calls).toEqual(["new", { id: "A", cwd: "/A" }]);
	expect(entries[2]!.contribution.label({ sidebarOpen: false })).toBe("Show sidebar");
});

test("feedback is a registered provider using host-owned notifications and SDK controls", () => {
	Object.assign(globalThis, {
		__knightcodeDesktop: {
			experimental_useToasts: () => [1, 2, 3, 4].map((id) => ({ id, kind: "info", text: `toast ${id}` })),
			experimental_useZoom: () => ({ factor: 1, changes: 0 }),
			experimental_controls: { experimental_IconButton: () => null },
			experimental_Icon: () => createElement("svg"),
			experimental_Button: (props: { children: string }) =>
				createElement("button", { "aria-label": "Close" }, props.children),
		},
	});
	const registry = new ExtensionRegistry();
	registry.register("builtin.feedback", feedback);
	const html = renderToStaticMarkup(
		createElement(SurfaceHost, {
			registry,
			surface: "feedback",
			builtin: "builtin.feedback/toasts",
			context,
		}),
	);
	expect(html).toContain('data-kc-owner="builtin.feedback"');
	expect(html).toContain('aria-label="Notifications"');
	expect(html).not.toContain("toast 1");
	for (const id of [2, 3, 4]) expect(html).toContain(`toast ${id}`);
});

test("surface host mounts the built-in default plus ordered additive roots with original ownership", () => {
	const registry = new ExtensionRegistry();
	for (const owner of ["external", "builtin"])
		registry.register(
			owner,
			defineDesktopExtension((app) => {
				app.experimental_registerProvider({ id: "view", surface: "feedback", experimental_render: () => owner });
				app.experimental_registerSlot({ id: "slot", surface: "feedback", experimental_render: () => `${owner} slot` });
			}),
		);
	const render = (preferred?: string) =>
		renderToStaticMarkup(
			createElement(SurfaceHost, {
				registry,
				surface: "feedback",
				builtin: "builtin/view",
				context,
				preferred,
			}),
		);
	const normal = render();
	expect(normal).toContain('data-kc-owner="builtin" style="display:contents">builtin</div>');
	expect(normal.indexOf("builtin slot")).toBeLessThan(normal.indexOf("external slot"));
	expect(render("missing/view")).toBe(normal);
	expect(render("external/view")).toContain('data-kc-owner="external" style="display:contents">external</div>');
});

test("command roots contain a render boundary and preserve the row layout", () => {
	const registry = new ExtensionRegistry();
	registry.register(
		"owner",
		defineDesktopExtension((app) => {
			app.experimental_registerCommand({ id: "go", label: () => "Go", experimental_run: vi.fn() });
		}),
	);
	expect(
		renderToStaticMarkup(createElement(ContributionRoot, { entry: registry.commands(context)[0]!, children: "row" })),
	).toBe('<div data-kc-owner="owner" style="display:contents">row</div>');
});
