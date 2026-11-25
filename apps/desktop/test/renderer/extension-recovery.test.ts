/** The host-owned extension recovery notice stays clear of the thread header and can be dismissed until a new failure. */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } });
});
vi.mock("../../src/renderer/client.ts", () => ({
	client: {
		onNotification: () => () => {},
		onServerRequest: () => () => {},
		onHostEvent: () => () => {},
		host: () => Promise.resolve({}),
	},
	RequestError: class extends Error {},
}));

import { reportExternal } from "../../src/renderer/extensions/external.ts";
import { dismissRecovery, NativeExtensionRecovery } from "../../src/renderer/extensions/settings.tsx";

const render = () => renderToStaticMarkup(createElement(NativeExtensionRecovery, { context: { sidebarOpen: true } }));

test("the recovery notice sits below the thread header row and offers Dismiss", () => {
	reportExternal("external-a", "rev-1", "load", "setup failed");
	const html = render();
	expect(html).toContain("A desktop extension failed.");
	expect(html).toContain(">Dismiss<");
	// The thread header's actions occupy the row at 56px (top-14); the notice must start below it.
	expect(html).not.toMatch(/\btop-14\b/);
	expect(html).toMatch(/\btop-28\b/);
});

test("dismissing hides the notice until a different failure arrives", () => {
	reportExternal("external-a", "rev-1", "load", "setup failed");
	dismissRecovery();
	expect(render()).toBe("");
	// The same failure reported again stays dismissed.
	reportExternal("external-a", "rev-1", "load", "setup failed");
	expect(render()).toBe("");
	// A new failure (another owner, or a new message) shows the notice again.
	reportExternal("external-b", "rev-1", "render", "render failed");
	expect(render()).toContain("A desktop extension failed.");
	dismissRecovery();
	expect(render()).toBe("");
	// Recovery clears the failure; a later failure of the same owner is new again.
	reportExternal("external-a", "rev-1", "active", "");
	reportExternal("external-b", "rev-1", "active", "");
	expect(render()).toBe("");
	reportExternal("external-a", "rev-2", "load", "setup failed");
	expect(render()).toContain("A desktop extension failed.");
});
