import { experimental_controllers } from "@knightcodeai/cli/desktop";
import { expect, test, vi } from "vitest";

vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener: () => {}, removeEventListener: () => {} } });
});
vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => {}, onServerRequest: () => {}, onHostEvent: () => {} },
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
