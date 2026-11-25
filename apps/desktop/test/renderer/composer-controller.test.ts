import { describe, expect, test, vi } from "vitest";
import type { experimental_EditorAdapter, experimental_EditorState } from "@knightcodeai/cli/desktop";

vi.hoisted(() => Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } }));
vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => () => {}, onServerRequest: () => () => {}, onHostEvent: () => () => {} },
	RequestError: class extends Error {},
}));
import {
	composerController as createController,
	mountEditor as attach,
	mountComposerActions,
} from "../../src/renderer/extensions/composer-controller.ts";

const lifetime = new AbortController();
const composerController = (target: Parameters<typeof createController>[0]) =>
	createController(target, lifetime.signal);
const attachEditor = (target: Parameters<typeof attach>[0], adapter: experimental_EditorAdapter) =>
	attach(target, adapter, lifetime.signal);
function mountEditor(...args: Parameters<typeof attachEditor>) {
	const result = attachEditor(...args);
	if (result.status !== "mounted") throw new Error("Editor mount unexpectedly busy");
	return result.mount;
}
import {
	composerDraftOf,
	getState,
	setComposerDraft,
	queueComposerRestoration,
	applyComposerRestorations,
} from "../../src/renderer/store.ts";

function editor(text: string, start: number, end = start) {
	let state: experimental_EditorState = {
		text,
		selection: { start, end, direction: "forward" },
		focused: true,
		composing: false,
	};
	const adapter: experimental_EditorAdapter = {
		experimental_read: () => state,
		experimental_apply: (next) => {
			state = { ...state, ...next };
		},
		experimental_focus: () => {
			state = { ...state, focused: true };
		},
		experimental_caretAnchor: () => ({ x: 4, y: 8, width: 0, height: 16 }),
	};
	return {
		adapter,
		read: () => state,
		update: (patch: Partial<experimental_EditorState>) => {
			state = { ...state, ...patch };
		},
	};
}

let id = 0;
function target() {
	return { threadId: `composer-${++id}` };
}

describe("canonical composer editor transactions", () => {
	test("a failed new-thread submission retains newer typing and waits for its composition to finish", () => {
		const key = `thread:${target().threadId}`;
		setComposerDraft(key, (d) => ({
			...d,
			text: "new typing",
			images: ["/new.png"],
			selection: { start: 3, end: 3, direction: "none" },
			composing: true,
		}));
		queueComposerRestoration(key, { text: "original", images: ["/old.png"] });
		expect(applyComposerRestorations(key)).toBe(false);
		expect(composerDraftOf(getState(), key).text).toBe("new typing");
		setComposerDraft(key, (d) => ({ ...d, composing: false }));
		expect(applyComposerRestorations(key)).toBe(true);
		expect(composerDraftOf(getState(), key)).toMatchObject({
			text: "original\n\nnew typing",
			images: ["/old.png", "/new.png"],
			selection: { start: 13, end: 13, direction: "none" },
			revision: 2,
		});
		expect(applyComposerRestorations(key)).toBe(false);
	});
	test("submission is mediated by the live root and reports refusal instead of an invented send", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const editorMount = mountEditor(t, e.adapter);
		let permitted = false;
		const sent: boolean[] = [];
		const actions = mountComposerActions(
			t,
			{
				canSubmit: () => permitted,
				submit: (alternate) => {
					sent.push(alternate);
					return { status: "applied", revision: 0 };
				},
				stop() {},
			},
			lifetime.signal,
		);
		expect(c.experimental_submit()).toEqual({ status: "unavailable" });
		expect(sent).toEqual([]);
		permitted = true;
		expect(c.experimental_submit(true).status).toBe("applied");
		expect(sent).toEqual([true]);
		e.update({ composing: true });
		expect(c.experimental_submit()).toEqual({ status: "busy" });
		expect(sent).toEqual([true]);
		e.update({ composing: false });
		actions.dispose();
		expect(c.experimental_submit()).toEqual({ status: "unavailable" });
		editorMount.dispose();
	});
	test("image-only restoration does not invent text before a newer draft", () => {
		const key = `thread:${target().threadId}`;
		setComposerDraft(key, (d) => ({ ...d, text: "newer" }));
		queueComposerRestoration(key, { text: "", images: ["/retained.png"] });
		expect(applyComposerRestorations(key)).toBe(true);
		expect(composerDraftOf(getState(), key)).toMatchObject({ text: "newer", images: ["/retained.png"] });
	});

	test("restoration waits for input locks and never invents a selection", () => {
		const key = `thread:${target().threadId}`;
		setComposerDraft(key, (d) => ({ ...d, text: "newer", locked: true }));
		queueComposerRestoration(key, { text: "rejected", images: [] });
		expect(applyComposerRestorations(key)).toBe(false);
		setComposerDraft(key, (d) => ({ ...d, locked: false }));
		expect(applyComposerRestorations(key)).toBe(true);
		expect(composerDraftOf(getState(), key).text).toBe("rejected\n\nnewer");
		expect(composerDraftOf(getState(), key).selection).toBeUndefined();
	});

	test("unchanged native selection reports preserve the store snapshot and do not rerender a streaming composer", () => {
		const t = target();
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		const before = getState();
		e.update({ selection: { start: 0, end: 0, direction: "forward" } });
		mount.experimental_report(0);
		expect(getState()).toBe(before);
		mount.dispose();
	});

	test("all draft writers advance the canonical revision only for content changes", () => {
		const key = `thread:${target().threadId}`;
		expect(composerDraftOf(getState(), key).revision).toBe(0);
		setComposerDraft(key, (d) => ({ ...d, text: "hello" }));
		expect(composerDraftOf(getState(), key).revision).toBe(1);
		setComposerDraft(key, (d) => ({ ...d }));
		expect(composerDraftOf(getState(), key).revision).toBe(1);
		setComposerDraft(key, (d) => ({ ...d, images: ["/image.png"] }));
		expect(composerDraftOf(getState(), key).revision).toBe(2);
	});

	test("a content writer invalidates its captured selection instead of moving it to new text", () => {
		const key = `thread:${target().threadId}`;
		setComposerDraft(key, (d) => ({ ...d, text: "longer", selection: { start: 4, end: 6, direction: "none" } }));
		setComposerDraft(key, (d) => ({ ...d, text: "a" }));
		expect(composerDraftOf(getState(), key).selection).toBeUndefined();
	});

	test("inserts at the UTF-16 selection and synchronizes the editor without an echo revision", () => {
		const t = target();
		const c = composerController(t);
		setComposerDraft(`thread:${t.threadId}`, (d) => ({ ...d, text: "A😀BC" }));
		const e = editor("A😀BC", 1, 3);
		const mount = mountEditor(t, e.adapter);
		expect(c.experimental_insert("x", 1)).toEqual({ status: "applied", revision: 2 });
		expect(e.read().text).toBe("AxBC");
		expect(e.read().selection).toEqual({ start: 2, end: 2, direction: "none" });
		expect(mount.experimental_report(2)).toEqual({ status: "applied", revision: 2 });
		expect(c.experimental_getSnapshot().revision).toBe(2);
		mount.dispose();
	});

	test("replacement normalizes Windows line endings before computing UTF-16 cursor offsets", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		expect(c.experimental_insert("a\r\n😀\rb", 0)).toEqual({ status: "applied", revision: 1 });
		expect(c.experimental_getSnapshot()).toMatchObject({
			text: "a\n😀\nb",
			selection: { start: 6, end: 6, direction: "none" },
		});
		expect(mount.experimental_report(1)).toEqual({ status: "applied", revision: 1 });
		mount.dispose();
	});

	test("refuses a captured range after newer typing and refuses stale editor reports", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		e.update({ text: "new", selection: { start: 3, end: 3, direction: "none" } });
		expect(mount.experimental_report(0)).toEqual({ status: "applied", revision: 1 });
		expect(c.experimental_replace({ start: 0, end: 0, direction: "none" }, "old", 0)).toEqual({
			status: "stale",
			revision: 1,
		});
		e.update({ text: "stale" });
		expect(mount.experimental_report(0)).toEqual({ status: "stale", revision: 1 });
		expect(c.experimental_getSnapshot().text).toBe("new");
		mount.dispose();
	});

	test("does not apply an adapter's old selection to an externally changed draft", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		setComposerDraft(`thread:${t.threadId}`, (d) => ({ ...d, text: "newer" }));
		expect(c.experimental_insert("x", 1)).toEqual({ status: "stale", revision: 1 });
		expect(c.experimental_getSnapshot().text).toBe("newer");
		expect(mount.experimental_sync()).toEqual({ status: "applied", revision: 1 });
		expect(e.read().text).toBe("newer");
		mount.dispose();
	});

	test("reading a newer revision does not authorize an unsynchronized adapter to overwrite its text", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		setComposerDraft(`thread:${t.threadId}`, (d) => ({ ...d, text: "new canonical draft" }));
		expect(mount.experimental_report(1)).toEqual({ status: "stale", revision: 1 });
		expect(c.experimental_getSnapshot().text).toBe("new canonical draft");
		mount.dispose();
	});

	test("native typing can merge an attachment-only revision without losing an IME candidate", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		e.update({ composing: true });
		mount.experimental_report(0);
		setComposerDraft(`thread:${t.threadId}`, (d) => ({ ...d, images: ["/annotation.png"] }));
		e.update({ text: "candidate", selection: { start: 9, end: 9, direction: "none" }, composing: false });
		expect(mount.experimental_report(0)).toEqual({ status: "applied", revision: 2 });
		expect(c.experimental_getSnapshot()).toMatchObject({
			text: "candidate",
			images: ["/annotation.png"],
			composing: false,
		});
		mount.dispose();
	});

	test("synchronization refuses to overwrite a composing editor", () => {
		const t = target();
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		e.update({ text: "candidate", composing: true });
		setComposerDraft(`thread:${t.threadId}`, (d) => ({ ...d, text: "external" }));
		expect(mount.experimental_sync()).toEqual({ status: "busy" });
		expect(e.read().text).toBe("candidate");
		mount.dispose();
	});

	test("invalid adapter selection ranges never enter the canonical draft", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		e.update({ text: "a", selection: { start: 0, end: 20, direction: "none" } });
		expect(mount.experimental_report(0)).toEqual({ status: "unavailable" });
		expect(c.experimental_getSnapshot().text).toBe("");
		mount.dispose();
	});

	test("never invents an end selection when unavailable and never edits during composition", () => {
		const t = target();
		const c = composerController(t);
		expect(c.experimental_insert("x", 0)).toEqual({ status: "unavailable" });
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		e.update({ selection: undefined });
		expect(c.experimental_insert("x", 0)).toEqual({ status: "unavailable" });
		e.update({ composing: true });
		expect(c.experimental_focusEnd()).toEqual({ status: "busy" });
		expect(c.experimental_replace({ start: 0, end: 0, direction: "none" }, "x", 0)).toEqual({ status: "busy" });
		mount.dispose();
	});

	test("input locks are shared and released idempotently without releasing another lock", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		const owner = new AbortController();
		const a = c.experimental_lock(owner.signal);
		const b = composerController(t).experimental_lock(owner.signal);
		expect(c.experimental_insert("x", 0)).toEqual({ status: "locked" });
		e.update({ text: "blocked" });
		expect(mount.experimental_report(0)).toEqual({ status: "locked" });
		a.dispose();
		a.dispose();
		expect(c.experimental_insert("x", 0)).toEqual({ status: "locked" });
		b.dispose();
		expect(c.experimental_insert("x", 0)).toEqual({ status: "applied", revision: 1 });
		mount.dispose();
	});

	test("invalid initial adapter ranges never enter the canonical draft", () => {
		const t = target();
		const e = editor("", 0, 20);
		expect(attachEditor(t, e.adapter)).toEqual({ status: "unavailable" });
		expect(composerController(t).experimental_getSnapshot().selection).toBeUndefined();
	});

	test("failed adapter initialization cannot leave a live editor behind", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		expect(() =>
			attachEditor(t, {
				...e.adapter,
				experimental_read: () => {
					throw new Error("editor failed");
				},
			}),
		).toThrow("editor failed");
		expect(c.experimental_focus()).toEqual({ status: "unavailable" });
		const mount = mountEditor(t, e.adapter);
		expect(c.experimental_insert("recovered", 0).status).toBe("applied");
		mount.dispose();
	});

	test("a lock acquired during composition never applies text over the active IME candidate", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		const owner = new AbortController();
		const lock = c.experimental_lock(owner.signal);
		e.update({ text: "candidate", composing: true });
		expect(mount.experimental_report(0)).toEqual({ status: "locked" });
		expect(e.read().text).toBe("candidate");
		expect(c.experimental_getSnapshot()).toMatchObject({ text: "", composing: true });
		e.update({ composing: false });
		expect(mount.experimental_report(0)).toEqual({ status: "locked" });
		expect(e.read().text).toBe("");
		expect(c.experimental_getSnapshot().composing).toBe(false);
		lock.dispose();
		mount.dispose();
	});

	test("a retired mount cannot detach or report over its replacement", () => {
		const t = target();
		const c = composerController(t);
		const a = mountEditor(t, editor("", 0).adapter);
		const b = mountEditor(t, editor("", 0).adapter);
		a.dispose();
		expect(a.experimental_report(0)).toEqual({ status: "unavailable" });
		expect(c.experimental_insert("B", 0)).toEqual({ status: "applied", revision: 1 });
		b.dispose();
		expect(c.experimental_focus()).toEqual({ status: "unavailable" });
	});

	test("locks end with their owner's abort signal and cannot leak into the next editor mount", () => {
		const t = target();
		const c = composerController(t);
		const owner = new AbortController();
		const lock = c.experimental_lock(owner.signal);
		const mount = mountEditor(t, editor("", 0).adapter);
		expect(c.experimental_insert("x", 0).status).toBe("locked");
		owner.abort();
		expect(c.experimental_insert("x", 0).status).toBe("applied");
		lock.dispose();
		mount.dispose();
	});

	test("a provider cannot attach a second editor while the first is composing", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const a = mountEditor(t, e.adapter);
		e.update({ composing: true });
		expect(attachEditor(t, editor("", 0).adapter)).toEqual({ status: "busy" });
		e.update({ composing: false });
		expect(c.experimental_insert("A", 0).status).toBe("applied");
		a.dispose();
	});

	test("focus commands update canonical focus even before the editor emits another event", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		e.update({ focused: false });
		const mount = mountEditor(t, e.adapter);
		expect(c.experimental_getSnapshot().focused).toBe(false);
		expect(c.experimental_focus().status).toBe("applied");
		expect(c.experimental_getSnapshot().focused).toBe(true);
		e.update({ focused: false });
		mount.experimental_report(0);
		expect(c.experimental_focusEnd().status).toBe("applied");
		expect(c.experimental_getSnapshot().focused).toBe(true);
		mount.dispose();
	});

	test("retiring a composing mount clears composition state but keeps the draft and attachments", () => {
		const t = target();
		const c = composerController(t);
		const e = editor("", 0);
		const mount = mountEditor(t, e.adapter);
		e.update({ text: "candidate", selection: { start: 9, end: 9, direction: "none" }, composing: true });
		mount.experimental_report(0);
		setComposerDraft(`thread:${t.threadId}`, (d) => ({ ...d, images: ["/retained.png"] }));
		mount.dispose();
		expect(c.experimental_getSnapshot()).toMatchObject({
			text: "candidate",
			images: ["/retained.png"],
			composing: false,
		});
	});

	test.each(["read", "apply", "focus", "caretAnchor"] as const)(
		"a throwing %s retires the adapter without losing the draft",
		(callback) => {
			const t = target();
			const c = composerController(t);
			const e = editor("saved", 5);
			setComposerDraft(`thread:${t.threadId}`, (d) => ({ ...d, text: "saved", images: ["/kept.png"] }));
			const owner = new AbortController();
			const failure = vi.fn();
			const attached = attach(t, e.adapter, owner.signal, owner.signal, failure);
			expect(attached.status).toBe("mounted");
			const error = new Error("adapter failed");
			vi.spyOn(e.adapter, `experimental_${callback}`).mockImplementation(() => {
				throw error;
			});
			if (callback === "caretAnchor") expect(c.experimental_caretAnchor()).toBeUndefined();
			else if (callback === "apply")
				expect(c.experimental_insert(" new", c.experimental_getSnapshot().revision).status).toBe("unavailable");
			else expect(c.experimental_focus().status).toBe("unavailable");
			expect(failure).toHaveBeenCalledExactlyOnceWith(error);
			expect(c.experimental_getSnapshot()).toMatchObject({ text: "saved", images: ["/kept.png"], composing: false });
			const fallback = editor("", 0);
			const fallbackMount = mountEditor(t, fallback.adapter);
			expect(fallback.read().text).toBe("saved");
			fallbackMount.dispose();
		},
	);

	test("focus preserves selection, focus-end moves it, and caret anchors come from the active adapter", () => {
		const t = target();
		const c = composerController(t);
		setComposerDraft(`thread:${t.threadId}`, (d) => ({ ...d, text: "abc" }));
		const e = editor("abc", 1, 2);
		const mount = mountEditor(t, e.adapter);
		expect(c.experimental_focus().status).toBe("applied");
		expect(e.read().selection).toEqual({ start: 1, end: 2, direction: "forward" });
		expect(c.experimental_caretAnchor()).toEqual({ x: 4, y: 8, width: 0, height: 16 });
		expect(c.experimental_focusEnd().status).toBe("applied");
		expect(e.read().selection).toEqual({ start: 3, end: 3, direction: "none" });
		mount.dispose();
	});
});
import { retainComposerLifetime } from "../../src/renderer/extensions/composer-controller.ts";

describe("composer root lifetime", () => {
	const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

	test("survives a dev StrictMode cleanup and immediate remount", async () => {
		const active = { current: undefined as AbortController | undefined };
		const lifetime = new AbortController();
		retainComposerLifetime(active, lifetime)();
		retainComposerLifetime(active, lifetime);
		await tick();
		expect(lifetime.signal.aborted).toBe(false);
	});

	test("aborts on unmount and when a new target replaces it", async () => {
		const active = { current: undefined as AbortController | undefined };
		const first = new AbortController();
		const second = new AbortController();
		retainComposerLifetime(active, first)();
		retainComposerLifetime(active, second);
		await tick();
		expect(first.signal.aborted).toBe(true);
		retainComposerLifetime(active, second)();
		await tick();
		expect(second.signal.aborted).toBe(true);
	});
});
