/** Activation authority adds epoch revocation without replacing the window, editor or lock lifetimes. */
import {
	experimental_controllers,
	type experimental_EditorAdapter,
	type experimental_EditorState,
} from "@knightcodeai/cli/desktop";
import { afterEach, expect, test, vi } from "vitest";

vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } });
});
vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => () => {}, onServerRequest: () => () => {}, onHostEvent: () => () => {} },
	RequestError: class extends Error {},
}));

import { FrontendActivation } from "../../src/renderer/extensions/activation.ts";
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { getState, navigate } from "../../src/renderer/store.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
	vi.restoreAllMocks();
});
function fixture(epoch: string) {
	const dispose = initializeDesktopExtensions();
	cleanups.push(dispose);
	const binding = { owner: "example", revision: "a".repeat(64), epoch, window: "server:1", mount: `mount-${epoch}` };
	const activation = new FrontendActivation(binding, globalThis.__knightcodeDesktop!, () => {});
	cleanups.push(() => activation.dispose());
	return { activation, binding };
}
function adapter(): experimental_EditorAdapter {
	let state: experimental_EditorState = {
		text: "",
		selection: { start: 0, end: 0, direction: "none" },
		focused: false,
		composing: false,
	};
	return {
		experimental_read: () => state,
		experimental_apply: (edit) => {
			state = { ...state, ...edit };
		},
		experimental_focus() {},
		experimental_caretAnchor: () => undefined,
	};
}

test("prepared and published-but-gated helpers cannot act, while revocation leaves the window host alive", () => {
	const { activation } = fixture("one");
	navigate({ kind: "new", cwd: "/epoch-one" });
	const owned = activation.sdk.experimental_controllers();
	owned.experimental_showSettings("models");
	expect(getState().view).toEqual({ kind: "new", cwd: "/epoch-one" });
	activation.publish();
	owned.experimental_showSettings("models");
	expect(getState().view).toEqual({ kind: "new", cwd: "/epoch-one" });
	activation.ready();
	owned.experimental_showSettings("models");
	expect(getState().view).toEqual({ kind: "settings", page: "models" });
	activation.dispose();
	owned.experimental_showNew("/retired");
	expect(getState().view).toEqual({ kind: "settings", page: "models" });
	experimental_controllers().experimental_showNew("/window-still-alive");
	expect(getState().view).toEqual({ kind: "new", cwd: "/window-still-alive" });
});

test("saved shell and conversation services obey the same epoch gate as composer and navigation controllers", async () => {
	const { activation } = fixture("services");
	const panel = vi
		.spyOn(globalThis.__knightcodeDesktop!.experimental_conversationServices, "experimental_setPanelOpen")
		.mockImplementation(() => {});
	const palette = vi
		.spyOn(globalThis.__knightcodeDesktop!.experimental_shellServices, "experimental_setPaletteOpen")
		.mockImplementation(() => {});
	const fork = vi
		.spyOn(globalThis.__knightcodeDesktop!.experimental_conversationServices, "experimental_fork")
		.mockResolvedValue(undefined);
	const conversation = activation.sdk.experimental_conversationServices();
	const shell = activation.sdk.experimental_shellServices();
	conversation.experimental_setPanelOpen(true);
	shell.experimental_setPaletteOpen(true);
	await conversation.experimental_fork("A");
	expect(panel).not.toHaveBeenCalled();
	expect(palette).not.toHaveBeenCalled();
	expect(fork).not.toHaveBeenCalled();
	activation.publish();
	activation.ready();
	conversation.experimental_setPanelOpen(true);
	shell.experimental_setPaletteOpen(true);
	await conversation.experimental_fork("A");
	expect(panel).toHaveBeenCalledOnce();
	expect(palette).toHaveBeenCalledOnce();
	expect(fork).toHaveBeenCalledOnce();
	activation.dispose();
	conversation.experimental_setPanelOpen(false);
	shell.experimental_setPaletteOpen(false);
	await conversation.experimental_fork("A");
	expect(panel).toHaveBeenCalledOnce();
	expect(palette).toHaveBeenCalledOnce();
	expect(fork).toHaveBeenCalledOnce();
});

test("a captured composer project callback cannot change the view after epoch retirement", () => {
	const { activation } = fixture("project-callback");
	const host = globalThis.__knightcodeDesktop!;
	let selected = "/original";
	// This fixture exercises returned project callbacks; other composer fields are not invoked.
	const state = {
		target: { cwd: "/original" },
		project: {
			cwd: "/original",
			onChange: (cwd: string) => {
				selected = cwd;
			},
		},
		dropProps: {},
	} as ReturnType<typeof host.experimental_useComposer>;
	vi.spyOn(host, "experimental_useComposer").mockReturnValue(state);
	activation.publish();
	activation.ready();
	const captured = activation.sdk.experimental_useComposer();
	captured.project!.onChange("/active");
	expect(selected).toBe("/active");
	activation.dispose();
	captured.project!.onChange("/retired");
	expect(selected).toBe("/active");
});

test("quiescence gates a captured controller without aborting its editor, then resumes the same epoch", async () => {
	const { activation } = fixture("quiesce");
	activation.publish();
	activation.ready();
	const target = { cwd: "/epoch-quiesce" };
	const mounted = activation.sdk.experimental_attachComposerEditor(target, adapter());
	expect(mounted.status).toBe("mounted");
	const controller = activation.sdk.experimental_composer(target);
	expect(controller.experimental_insert("a", controller.experimental_getSnapshot().revision).status).toBe("applied");
	await activation.quiesce(new AbortController().signal);
	expect(activation.signal.aborted).toBe(false);
	expect(activation.sdk.experimental_attachComposerEditor(target, adapter()).status).toBe("unavailable");
	expect(controller.experimental_insert("blocked", controller.experimental_getSnapshot().revision).status).toBe(
		"unavailable",
	);
	activation.ready();
	expect(controller.experimental_insert("b", controller.experimental_getSnapshot().revision).status).toBe("applied");
	expect(controller.experimental_getSnapshot().text).toBe("ab");
});

test("quiescence waits for native composition to finish without discarding its canonical text", async () => {
	const { activation } = fixture("ime");
	activation.publish();
	activation.ready();
	const target = { cwd: "/epoch-ime" };
	let state: experimental_EditorState = {
		text: "",
		selection: { start: 0, end: 0, direction: "none" },
		focused: true,
		composing: false,
	};
	const editor = activation.sdk.experimental_attachComposerEditor(target, {
		experimental_read: () => state,
		experimental_apply: (edit) => {
			state = { ...state, ...edit };
		},
		experimental_focus() {},
		experimental_caretAnchor: () => undefined,
	});
	if (editor.status !== "mounted") throw new Error("Expected editor mount");
	const controller = activation.sdk.experimental_composer(target);
	const revision = controller.experimental_getSnapshot().revision;
	state = { ...state, text: "candidate", composing: true };
	editor.mount.experimental_report(revision);
	let settled = false;
	const pending = activation.quiesce(new AbortController().signal).then(() => {
		settled = true;
	});
	await Promise.resolve();
	expect(settled).toBe(false);
	state = { ...state, text: "committed", selection: { start: 9, end: 9, direction: "none" }, composing: false };
	editor.mount.experimental_report(controller.experimental_getSnapshot().revision);
	await pending;
	expect(controller.experimental_getSnapshot().text).toBe("committed");
	expect(activation.signal.aborted).toBe(false);
});

test("retired editor and lock disposers cannot mutate or unlock the next epoch on the same canonical draft", () => {
	const { activation: first, binding } = fixture("old");
	first.publish();
	first.ready();
	const target = { cwd: "/epoch-locks" };
	const editor = first.sdk.experimental_attachComposerEditor(target, adapter());
	if (editor.status !== "mounted") throw new Error("Expected editor mount");
	const oldController = first.sdk.experimental_composer(target);
	expect(oldController.experimental_insert("retained", oldController.experimental_getSnapshot().revision).status).toBe(
		"applied",
	);
	const oldLock = oldController.experimental_lock(new AbortController().signal);
	first.dispose();
	const next = new FrontendActivation(
		{ ...binding, epoch: "new", mount: "new-mount" },
		globalThis.__knightcodeDesktop!,
		() => {},
	);
	cleanups.push(() => next.dispose());
	next.publish();
	next.ready();
	expect(next.sdk.experimental_attachComposerEditor(target, adapter()).status).toBe("mounted");
	const current = next.sdk.experimental_composer(target);
	const lock = current.experimental_lock(new AbortController().signal);
	oldLock.dispose();
	editor.mount.dispose();
	expect(current.experimental_getSnapshot().locked).toBe(true);
	expect(oldController.experimental_insert("stale", current.experimental_getSnapshot().revision).status).toBe(
		"unavailable",
	);
	expect(editor.mount.experimental_report(current.experimental_getSnapshot().revision).status).toBe("unavailable");
	lock.dispose();
	expect(current.experimental_getSnapshot().text).toBe("retained");
	expect(current.experimental_getSnapshot().locked).toBe(false);
});
