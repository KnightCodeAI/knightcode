/** Reload feedback belongs to the host and does not replace or abort the old presentation. */
import { defineDesktopExtension } from "@knightcodeai/cli/desktop";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } });
});
vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => () => {}, onServerRequest: () => () => {}, onHostEvent: () => () => {} },
	RequestError: class extends Error {},
}));
import { FrontendActivation } from "../../src/renderer/extensions/activation.ts";
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { ExtensionRegistry } from "../../src/renderer/extensions/registry.ts";
import { SurfaceEntry } from "../../src/renderer/extensions/surface.tsx";

test("a ready provider's built-in fallback preserves sibling registrations and its matching backend epoch", () => {
	const dispose = initializeDesktopExtensions();
	const report = vi.fn();
	const registry = new ExtensionRegistry(report);
	const activation = new FrontendActivation(
		{ owner: "example", revision: "revision", epoch: "epoch", window: "server:1", mount: "mount" },
		globalThis.__knightcodeDesktop!,
		() => registry.invalidate(),
	);
	const prepared = registry.prepare(
		"example",
		defineDesktopExtension((app) => {
			app.experimental_registerProvider({ id: "home", surface: "home", experimental_render: () => null });
			app.experimental_registerCommand({ id: "sibling", label: () => "Sibling", experimental_run() {} });
		}),
		"revision",
		activation,
	);
	try {
		activation.publish();
		prepared.commit();
		activation.ready();
		const entry = registry.resolveProvider("home", "example/home", undefined, { sidebarOpen: true })!;
		entry.reportError(new Error("recoverable provider"), "fallback");
		expect(activation.admitted()).toBe(true);
		expect(registry.commands({ sidebarOpen: true }).map((entry) => entry.id)).toEqual(["example/sibling"]);
		expect(report).toHaveBeenCalledWith("example", expect.any(Error), "revision");
	} finally {
		prepared.dispose();
		activation.dispose();
		dispose();
	}
});

test("a quiesced root retains its rendered content with host-owned inert feedback and exact epoch metadata", async () => {
	const dispose = initializeDesktopExtensions();
	const registry = new ExtensionRegistry();
	const activation = new FrontendActivation(
		{ owner: "example", revision: "a".repeat(64), epoch: "epoch", window: "server:1", mount: "mount" },
		globalThis.__knightcodeDesktop!,
		() => registry.invalidate(),
	);
	const prepared = registry.prepare(
		"example",
		defineDesktopExtension((app) => {
			app.experimental_registerProvider({
				id: "home",
				surface: "home",
				experimental_render: () => <span>retained content</span>,
			});
		}),
		activation.binding.revision,
		activation,
	);
	try {
		activation.publish();
		prepared.commit();
		activation.ready();
		const entry = registry.resolveProvider("home", "example/home", undefined, { sidebarOpen: true })!;
		const view = () => renderToStaticMarkup(<SurfaceEntry entry={entry} context={{ sidebarOpen: true }} />);
		expect(view()).not.toContain('inert=""');
		await activation.quiesce(new AbortController().signal);
		const html = view();
		expect(html).toContain("retained content");
		expect(html).toContain('inert=""');
		expect(html).toContain('data-kc-epoch="epoch"');
		expect(html).toContain("Updating extension");
		expect(activation.signal.aborted).toBe(false);
		activation.ready();
		expect(view()).not.toContain('inert=""');
	} finally {
		prepared.dispose();
		activation.dispose();
		dispose();
	}
});
