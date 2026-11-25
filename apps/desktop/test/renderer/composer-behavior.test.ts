/** Attachments invalidate suggestions without retaining their keyboard precedence. */
import type * as React from "react";
import type { experimental_ComposerState } from "@knightcodeai/cli/desktop";
import { expect, test, vi } from "vitest";
const hooks = vi.hoisted(() => ({ stateIndex: 0, revision: 0 }));
vi.hoisted(() =>
	Object.assign(globalThis, {
		window: { knightcode: { platform: "win32" }, addEventListener() {}, removeEventListener() {} },
	}),
);
vi.mock("react", async (original) => ({
	...(await original<typeof React>()),
	useMemo: (create: () => unknown) => create(),
	useRef: (current: unknown) => ({ current }),
	useEffect() {},
	useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
	useState: (initial: unknown) => [
		hooks.stateIndex++ === 5
			? { items: [{ key: "cmd", label: "cmd", insert: "/cmd " }], truncated: false, start: 0, revision: hooks.revision }
			: initial,
		() => {},
	],
}));
vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => () => {}, onServerRequest: () => () => {}, onHostEvent: () => () => {} },
	RequestError: class extends Error {},
}));
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { useComposerBehavior } from "../../src/renderer/extensions/composer-behavior.tsx";
import { setComposerDraft, composerDraftOf, getState } from "../../src/renderer/store.ts";

test("an image paste hides stale slash suggestions and Enter dispatches the send command", () => {
	const dispose = initializeDesktopExtensions();
	class Editor {
		closest() {
			return this;
		}
	}
	vi.stubGlobal("HTMLElement", Editor);
	try {
		const key = "thread:paste-suggestion";
		setComposerDraft(key, (draft) => ({ ...draft, text: "/cmd", selection: { start: 4, end: 4, direction: "none" } }));
		hooks.revision = composerDraftOf(getState(), key).revision;
		hooks.stateIndex = 0;
		const signal = new AbortController().signal;
		expect(useComposerBehavior({ threadId: "paste-suggestion" }, signal).suggestions).toBeDefined();
		setComposerDraft(key, (draft) => ({ ...draft, images: ["/paste.png"] }));
		hooks.stateIndex = 0;
		const behavior = useComposerBehavior({ threadId: "paste-suggestion" }, signal);
		expect(behavior.suggestions).toBeUndefined();
		const command = vi
			.spyOn(globalThis.__knightcodeDesktop!.experimental_controllers, "experimental_runCommand")
			.mockReturnValue(true);
		// React event boundary: supply only the fields the key matcher consumes.
		behavior.onKeyDown({
			target: new Editor(),
			key: "Enter",
			code: "Enter",
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			nativeEvent: { isComposing: false },
			getModifierState: () => false,
			preventDefault() {},
		} as unknown as Parameters<experimental_ComposerState["onKeyDown"]>[0]);
		expect(command).toHaveBeenCalledWith("builtin.composer/send", expect.anything());
	} finally {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
		dispose();
	}
});
