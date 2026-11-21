/** Revisioned editor transactions over store-owned drafts; active adapters are keyed by mount identity. */
import type {
	experimental_ComposerController,
	experimental_ComposerTarget,
	experimental_EditorAdapter,
	experimental_EditorAttachment,
	experimental_EditorResult,
	experimental_EditorSelection,
} from "@knightcodeai/cli/desktop";
import { composerDraftOf, getState, setComposerDraft } from "../store.ts";

interface ActiveEditor {
	owner: AbortSignal;
	adapter: experimental_EditorAdapter;
	revision: number;
	baseText: string;
}

interface EditorSession {
	mount?: ActiveEditor;
	locks: Set<object>;
}

const sessions = new Map<string, EditorSession>();
const activity = new Set<() => void>();

/** Wait for this epoch's existing native composition; new actions are gated separately. */
export function whenEditorsIdle(owner: AbortSignal, transaction: AbortSignal): Promise<void> {
	const signal = AbortSignal.any([owner, transaction]);
	const composing = () =>
		[...sessions.values()].some(
			(session) => session.mount?.owner === owner && session.mount.adapter.experimental_read().composing,
		);
	if (signal.aborted) return Promise.reject(new Error("Editor readiness revoked."));
	if (!composing()) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const finish = () => {
			if (!signal.aborted && composing()) return;
			activity.delete(finish);
			signal.removeEventListener("abort", finish);
			if (signal.aborted) reject(new Error("Editor readiness revoked."));
			else resolve();
		};
		activity.add(finish);
		signal.addEventListener("abort", finish, { once: true });
	});
}

function editorActivity(): void {
	for (const listener of activity) listener();
}
const roots = new Map<
	string,
	{ canSubmit(): boolean; submit(alternate: boolean): experimental_EditorResult; stop(): void }
>();

/** Bind root-owned submission services without giving an editor ownership of the session. */
export function mountComposerActions(
	target: experimental_ComposerTarget,
	actions: { canSubmit(): boolean; submit(alternate: boolean): experimental_EditorResult; stop(): void },
	signal: AbortSignal,
) {
	const key = composerKey(target);
	if (signal.aborted) return { dispose() {} };
	roots.set(key, actions);
	const dispose = () => {
		signal.removeEventListener("abort", dispose);
		if (roots.get(key) === actions) roots.delete(key);
	};
	signal.addEventListener("abort", dispose, { once: true });
	return { dispose };
}

/**
 * Layout-effect body for a composer root's lifetime. Abort is deferred one microtask so React's dev
 * StrictMode cleanup + synchronous remount keeps the same live controller; unmount or replacement aborts.
 */
export function retainComposerLifetime(
	active: { current: AbortController | undefined },
	lifetime: AbortController,
): () => void {
	active.current = lifetime;
	return () => {
		if (active.current === lifetime) active.current = undefined;
		queueMicrotask(() => {
			if (active.current !== lifetime) lifetime.abort();
		});
	};
}

/** Use the same explicit draft identity as the host store's composer. */
export const composerKey = (target: experimental_ComposerTarget): string =>
	"threadId" in target ? `thread:${target.threadId}` : `new:${target.cwd ?? ""}`;

/** Create a facade over an explicit draft, never a selected-thread pointer. */
export function composerController(
	target: experimental_ComposerTarget,
	signal: AbortSignal,
	admitted: () => boolean = () => true,
): experimental_ComposerController {
	const key = composerKey(target);
	const snapshot = () => composerDraftOf(getState(), key);
	const ready = (): { status: "ready"; mount: ActiveEditor } | experimental_EditorResult => {
		if (signal.aborted || !admitted()) return { status: "unavailable" };
		const session = sessions.get(key);
		if (!session?.mount) return { status: "unavailable" };
		if (session.mount.adapter.experimental_read().composing) return { status: "busy" };
		if (session.locks.size) return { status: "locked" };
		if (session.mount.revision !== snapshot().revision) return { status: "stale", revision: snapshot().revision };
		return { status: "ready", mount: session.mount };
	};
	const apply = (range: experimental_EditorSelection, text: string, revision: number): experimental_EditorResult => {
		const active = ready();
		if (active.status !== "ready") return active;
		const before = snapshot();
		if (before.revision !== revision) return { status: "stale", revision: before.revision };
		if (!validRange(range, before.text)) return { status: "unavailable" };
		const inserted = text.replace(/\r\n?/g, "\n");
		const next = before.text.slice(0, range.start) + inserted + before.text.slice(range.end);
		const pos = range.start + inserted.length;
		const selection: experimental_EditorSelection = { start: pos, end: pos, direction: "none" };
		setComposerDraft(key, (d) => ({ ...d, text: next, selection }));
		active.mount.adapter.experimental_apply({ text: next, selection });
		active.mount.revision = snapshot().revision;
		active.mount.baseText = next;
		return { status: "applied", revision: active.mount.revision };
	};
	const select = (range: experimental_EditorSelection, revision: number): experimental_EditorResult => {
		const active = ready();
		if (active.status !== "ready") return active;
		const draft = snapshot();
		if (draft.revision !== revision) return { status: "stale", revision: draft.revision };
		if (!validRange(range, draft.text)) return { status: "unavailable" };
		setComposerDraft(key, (d) => ({ ...d, selection: range }));
		active.mount.adapter.experimental_apply({ text: draft.text, selection: range });
		return { status: "applied", revision };
	};
	return {
		experimental_getSnapshot: snapshot,
		experimental_canSubmit: () => ready().status === "ready" && (roots.get(key)?.canSubmit() ?? false),
		experimental_submit: (alternate = false) => {
			const active = ready();
			if (active.status !== "ready") return active;
			const actions = roots.get(key);
			if (!actions?.canSubmit()) return { status: "unavailable" };
			return actions.submit(alternate);
		},
		experimental_stop: () => {
			const active = ready();
			if (active.status !== "ready") return active;
			const actions = roots.get(key);
			if (!actions) return { status: "unavailable" };
			actions.stop();
			return { status: "applied", revision: snapshot().revision };
		},
		experimental_replace: apply,
		experimental_insert: (text, revision) => {
			const active = ready();
			if (active.status !== "ready") return active;
			const selection = active.mount.adapter.experimental_read().selection;
			return selection ? apply(selection, text, revision) : { status: "unavailable" };
		},
		experimental_select: select,
		experimental_focus: () => {
			const active = ready();
			if (active.status !== "ready") return active;
			const adapter = active.mount.adapter;
			const selection = adapter.experimental_read().selection;
			if (!selection) return { status: "unavailable" };
			adapter.experimental_focus();
			adapter.experimental_apply({ text: snapshot().text, selection });
			setComposerDraft(key, (d) => ({ ...d, selection, focused: true }));
			return { status: "applied", revision: snapshot().revision };
		},
		experimental_focusEnd: () => {
			const active = ready();
			if (active.status !== "ready") return active;
			const draft = snapshot();
			const result = select({ start: draft.text.length, end: draft.text.length, direction: "none" }, draft.revision);
			if (result.status === "applied") {
				active.mount.adapter.experimental_focus();
				setComposerDraft(key, (d) => ({ ...d, focused: true }));
			}
			return result;
		},
		experimental_caretAnchor: () =>
			signal.aborted || !admitted() ? undefined : sessions.get(key)?.mount?.adapter.experimental_caretAnchor(),
		experimental_lock: (owner) => {
			if (signal.aborted || owner.aborted || !admitted()) return { dispose() {} };
			const session = sessions.get(key) ?? { locks: new Set<object>() };
			sessions.set(key, session);
			const identity = {};
			session.locks.add(identity);
			setComposerDraft(key, (d) => ({ ...d, locked: true }));
			const dispose = () => {
				signal.removeEventListener("abort", dispose);
				owner.removeEventListener("abort", dispose);
				if (!session.locks.delete(identity)) return;
				setComposerDraft(key, (d) => ({ ...d, locked: session.locks.size > 0 }));
				if (!session.mount && !session.locks.size && sessions.get(key) === session) sessions.delete(key);
			};
			signal.addEventListener("abort", dispose, { once: true });
			owner.addEventListener("abort", dispose, { once: true });
			return { dispose };
		},
	};
}

/** Attach one active editor; an old disposer/report can never act on its replacement. */
export function mountEditor(
	target: experimental_ComposerTarget,
	adapter: experimental_EditorAdapter,
	signal: AbortSignal,
	owner: AbortSignal = signal,
): experimental_EditorAttachment {
	if (signal.aborted) return { status: "unavailable" };
	const key = composerKey(target);
	const session = sessions.get(key) ?? { locks: new Set<object>() };
	if (session.mount?.adapter.experimental_read().composing) return { status: "busy" };
	const initialDraft = composerDraftOf(getState(), key);
	const mount: ActiveEditor = { owner, adapter, revision: initialDraft.revision, baseText: initialDraft.text };
	session.mount = mount;
	sessions.set(key, session);
	const dispose = () => {
		signal.removeEventListener("abort", dispose);
		if (sessions.get(key)?.mount !== mount) return;
		delete session.mount;
		if (!session.locks.size) sessions.delete(key);
		setComposerDraft(key, (d) => ({ ...d, composing: false }));
		editorActivity();
	};
	signal.addEventListener("abort", dispose, { once: true });
	try {
		const draft = composerDraftOf(getState(), key);
		const initial = adapter.experimental_read();
		if (initial.selection && !validRange(initial.selection, initial.text)) {
			dispose();
			return { status: "unavailable" };
		}
		if (draft.selection || initial.text !== draft.text)
			adapter.experimental_apply({ text: draft.text, selection: draft.selection });
		else
			setComposerDraft(key, (d) => ({
				...d,
				selection: initial.selection,
				focused: initial.focused,
				composing: initial.composing,
			}));
	} catch (error) {
		dispose();
		throw error;
	}
	return {
		status: "mounted",
		mount: {
			experimental_sync: () => {
				if (sessions.get(key)?.mount !== mount) return { status: "unavailable" };
				if (adapter.experimental_read().composing) return { status: "busy" };
				const latest = composerDraftOf(getState(), key);
				adapter.experimental_apply({ text: latest.text, selection: latest.selection });
				mount.revision = latest.revision;
				mount.baseText = latest.text;
				return { status: "applied", revision: latest.revision };
			},
			experimental_report: (revision) => {
				if (sessions.get(key)?.mount !== mount) return { status: "unavailable" };
				const before = composerDraftOf(getState(), key);
				// Native typing may merge attachment changes, but never a different canonical text or an unapplied revision.
				if (revision !== mount.revision || (before.revision !== revision && before.text !== mount.baseText))
					return { status: "stale", revision: before.revision };
				const state = adapter.experimental_read();
				if (session.locks.size) {
					setComposerDraft(key, (d) => ({ ...d, focused: state.focused, composing: state.composing }));
					editorActivity();
					if (!state.composing) adapter.experimental_apply({ text: before.text, selection: before.selection });
					return { status: "locked" };
				}
				if (state.selection && !validRange(state.selection, state.text)) return { status: "unavailable" };
				setComposerDraft(key, (d) => ({ ...d, ...state }));
				editorActivity();
				mount.revision = composerDraftOf(getState(), key).revision;
				mount.baseText = state.text;
				return { status: "applied", revision: mount.revision };
			},
			dispose,
		},
	};
}

// Range bounds are declaration policy: number types cannot express valid UTF-16 offsets.
function validRange(range: experimental_EditorSelection, text: string): boolean {
	return (
		Number.isInteger(range.start) &&
		Number.isInteger(range.end) &&
		range.start >= 0 &&
		range.end >= range.start &&
		range.end <= text.length
	);
}
