import { defineDesktopExtension, experimental_controllers } from "@knightcodeai/cli/desktop";
import { FrontendActivation } from "../../src/renderer/extensions/activation.ts";
import { expect, test, vi } from "vitest";

vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener: () => {}, removeEventListener: () => {} } });
});
vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => () => {}, onServerRequest: () => () => {}, onHostEvent: () => () => {} },
	RequestError: class extends Error {},
}));

import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { desktopExtensions } from "../../src/renderer/extensions/runtime.ts";
import { getState, navigate } from "../../src/renderer/store.ts";

test("SDK notification posting, dismissal and expiry use the existing store and survive presenter teardown", () => {
	vi.useFakeTimers();
	const dispose = initializeDesktopExtensions();
	try {
		const controller = experimental_controllers();
		controller.experimental_notify("SDK confirmation", "success");
		expect(getState().toasts).toMatchObject([{ text: "SDK confirmation", kind: "success" }]);
		const id = getState().toasts[0]!.id;
		controller.experimental_dismissToast(id);
		expect(getState().toasts).toEqual([]);
		controller.experimental_notify("retained notice");
		dispose();
		expect(getState().toasts).toMatchObject([{ text: "retained notice", kind: "info" }]);
		expect(desktopExtensions.getSnapshot()).toEqual([]);
		vi.advanceTimersByTime(5000);
		expect(getState().toasts).toEqual([]);
		dispose();
		expect(globalThis.__knightcodeDesktop).toBeUndefined();
	} finally {
		dispose();
		vi.useRealTimers();
	}
});

test("all structural built-ins register synchronously before external work", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const surfaces = desktopExtensions
			.getSnapshot()
			.flatMap((entry) => (entry.kind === "provider" ? [entry.contribution.surface] : []));
		expect(surfaces.toSorted()).toEqual(
			[
				"feedback",
				"home",
				"layout",
				"navigation",
				"threadList",
				"titleBar",
				"composer",
				"threadHeader",
				"requests",
				"terminal",
				"code",
				"diff",
			].toSorted(),
		);
	} finally {
		dispose();
	}
});

test("default workspace renderers use the public editor engine instead of an unused null provider", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const context = { sidebarOpen: true, workspace: { threadId: "t", cwd: "/repo", projectCwd: "/repo" } };
		for (const surface of ["code", "diff"] as const) {
			const entry = desktopExtensions.resolveProvider(surface, `builtin.workspace/${surface}`, undefined, context);
			expect(entry?.contribution.experimental_render({ context, signal: entry.signal })).not.toBeNull();
		}
	} finally {
		dispose();
	}
});

test("SDK command dispatch uses the owned registry and refuses disposed actions", () => {
	const dispose = initializeDesktopExtensions();
	const seen: string[] = [];
	const handle = desktopExtensions.register(
		"command-facade",
		defineDesktopExtension((app) => {
			app.experimental_registerCommand({
				id: "capture",
				label: () => "Capture",
				experimental_run: (context) => {
					seen.push(context.thread!.id);
				},
			});
		}),
	);
	try {
		navigate({ kind: "thread", id: "B" });
		const context = { sidebarOpen: true, thread: { id: "A", cwd: "/A" } };
		expect(experimental_controllers().experimental_runCommand("command-facade/capture", context)).toBe(true);
		expect(seen).toEqual(["A"]);
		handle.dispose();
		expect(experimental_controllers().experimental_runCommand("command-facade/capture", context)).toBe(false);
		expect(seen).toEqual(["A"]);
	} finally {
		handle.dispose();
		dispose();
	}
});

test("host navigation cannot enter a page whose extension epoch is gated", async () => {
	const dispose = initializeDesktopExtensions();
	const activation = new FrontendActivation(
		{ owner: "gated-page", revision: "a", epoch: "epoch", window: "window", mount: "mount" },
		globalThis.__knightcodeDesktop!,
		() => desktopExtensions.invalidate(),
	);
	const registration = desktopExtensions.prepare(
		"gated-page",
		defineDesktopExtension((app) => {
			app.experimental_registerPage({ id: "page", label: "Page", experimental_render: () => null });
		}),
		"a",
		activation,
	);
	try {
		activation.publish();
		registration.commit();
		activation.ready();
		expect(experimental_controllers().experimental_openPage("gated-page/page")).toBe(true);
		await activation.quiesce(new AbortController().signal);
		expect(desktopExtensions.pages({ sidebarOpen: true }).some((entry) => entry.id === "gated-page/page")).toBe(true);
		expect(experimental_controllers().experimental_openPage("gated-page/page")).toBe(false);
	} finally {
		registration.dispose();
		activation.dispose();
		dispose();
	}
});

test("SDK navigation controllers share the host navigation state", () => {
	const dispose = initializeDesktopExtensions();
	try {
		navigate({ kind: "new", cwd: "/fixture" });
		experimental_controllers().experimental_showSettings("shortcuts");
		expect(getState().view).toEqual({ kind: "settings", page: "shortcuts" });
		experimental_controllers().experimental_showNew();
		expect(getState().view).toEqual({ kind: "new" });
	} finally {
		dispose();
	}
});
