/** Shared composer lifetime, editor dispatch, contribution hosts and composition-safe provider mounting. */
import { experimental_controllers } from "@knightcodeai/cli/desktop";
import type {
	experimental_ComposerProps,
	experimental_ComposerState,
	experimental_ComposerHost,
	experimental_EditorAdapter,
	experimental_EditorMount,
	experimental_CommandContext,
} from "@knightcodeai/cli/desktop";
import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";
import { client } from "../client.ts";
import { useBinding } from "../keys.ts";
import {
	queueComposerRestoration,
	composerDraftOf,
	errorText,
	getState,
	setComposerDraft,
	toast,
	useStore,
} from "../store.ts";
import { composerKey, mountEditor, mountComposerActions } from "./composer-controller.ts";
import { useComposerBehavior } from "./composer-behavior.tsx";
import { desktopExtensions } from "./runtime.ts";
import { externalState } from "./external.ts";
import { SurfaceEntry } from "./surface.tsx";
import { startupLayout } from "./startup.ts";

interface Binding {
	handle: experimental_EditorMount;
	report(): void;
}
interface RootLifetime {
	state: { current: experimental_ComposerState };
	signal: AbortSignal;
	composing: { current: boolean };
	binding: { current: Binding | undefined };
	hosts: Map<experimental_ComposerHost, object>;
	hadEditor: boolean;
}
const Root = createContext<RootLifetime | undefined>(undefined);
const StateContext = createContext<experimental_ComposerState | undefined>(undefined);
const HOSTS = ["actions", "banners", "chips", "addMenu", "sendMenu", "suggestions", "popups"] as const;
const SURFACES = {
	actions: "composerActions",
	banners: "composerBanners",
	chips: "composerChips",
	addMenu: "composerAddMenu",
	sendMenu: "composerSendMenu",
	suggestions: "composerSuggestions",
	popups: "composerPopups",
} as const;

function useRoot(): RootLifetime {
	const root = useContext(Root);
	if (!root) throw new Error("Composer controls require experimental_ComposerRoot.");
	return root;
}

/** Read shared behavior; replacements never recreate submission, queue or suggestion rules. */
export function useComposer(): experimental_ComposerState {
	const state = useContext(StateContext);
	if (!state) throw new Error("Composer controls require experimental_ComposerRoot.");
	return state;
}

/** Bind one adapter; the returned handle belongs to this exact mount, never a later editor. */
export function useComposerEditor(
	adapter: experimental_EditorAdapter | undefined,
): experimental_EditorMount | undefined {
	const root = useRoot();
	const target = root.state.current.target;
	const key = composerKey(target);
	const draft = useStore((s) => composerDraftOf(s, key));
	const attached = useRef<Binding | undefined>(undefined);
	const [handle, setHandle] = useState<experimental_EditorMount>();
	useLayoutEffect(() => {
		if (!adapter) return;
		if (root.binding.current) throw new Error("Composer provider must mount exactly one editor.");
		const result = mountEditor(
			target,
			{
				...adapter,
				experimental_read: () => {
					const state = adapter.experimental_read();
					return { ...state, composing: root.composing.current || state.composing };
				},
			},
			root.signal,
		);
		if (result.status !== "mounted") throw new Error(`Composer editor attachment ${result.status}`);
		let revision = root.state.current.controller.experimental_getSnapshot().revision;
		const bound: experimental_EditorMount = {
			experimental_report: (expected) => {
				const reported = result.mount.experimental_report(expected);
				if (reported.status === "applied") revision = reported.revision;
				return reported;
			},
			experimental_sync: () => {
				const synced = result.mount.experimental_sync();
				if (synced.status === "applied") revision = synced.revision;
				return synced;
			},
			dispose: () => {
				result.mount.dispose();
				if (root.binding.current === binding) root.binding.current = undefined;
				if (attached.current === binding) attached.current = undefined;
			},
		};
		const binding: Binding = {
			handle: bound,
			report: () => {
				bound.experimental_report(revision);
			},
		};
		attached.current = binding;
		root.binding.current = binding;
		setHandle(bound);
		if (!root.hadEditor || root.state.current.controller.experimental_getSnapshot().focused)
			root.state.current.controller.experimental_focus();
		root.hadEditor = true;
		const selection = () => binding.report();
		document.addEventListener("selectionchange", selection);
		return () => {
			document.removeEventListener("selectionchange", selection);
			bound.dispose();
		};
	}, [adapter, root, key]);
	useLayoutEffect(() => {
		attached.current?.handle.experimental_sync();
	}, [draft.revision, root]);
	return handle;
}

function RequiredHosts({ children }: { children: ReactNode }) {
	const root = useRoot();
	const [missing, setMissing] = useState(false);
	useLayoutEffect(() => {
		for (const host of HOSTS)
			if (!root.hosts.has(host)) throw new Error(`Composer provider must mount the ${host} contribution host.`);
	}, [root]);
	useEffect(() => {
		// Callback refs settle before the first frame; a provider without an adapter is not a usable replacement.
		const frame = requestAnimationFrame(() => {
			if (!root.binding.current) setMissing(true);
		});
		return () => cancelAnimationFrame(frame);
	}, [root]);
	if (missing) throw new Error("Composer provider must mount an editor adapter.");
	return children;
}

/** Contributions retain their original owner/revision and their explicit composer context. */
export function ComposerContributions({ host }: { host: experimental_ComposerHost }) {
	const root = useRoot();
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
	useLayoutEffect(() => {
		if (root.hosts.has(host)) throw new Error(`Duplicate composer contribution host: ${host}`);
		const identity = {};
		root.hosts.set(host, identity);
		return () => {
			if (root.hosts.get(host) === identity) root.hosts.delete(host);
		};
	}, [root, host]);
	const { target } = root.state.current;
	const context: experimental_CommandContext = {
		sidebarOpen: getState().sidebarOpen,
		composer: target,
		...("threadId" in target
			? { thread: { id: target.threadId, cwd: getState().held[target.threadId]?.thread.cwd ?? "" } }
			: { cwd: target.cwd }),
	};
	return (
		<div data-kc-composer-host={host} style={{ display: "contents" }}>
			{desktopExtensions.slots(SURFACES[host], context).map((entry) => (
				<SurfaceEntry key={entry.sequence} entry={entry} context={context} />
			))}
		</div>
	);
}

// DOM-event boundary: events from a nested menu/popup are not edits to the registered editor.
function fromEditor(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("[data-kc-editor]") !== null;
}

/** Root state outlives provider switches; IME completion precedes editor replacement and shortcut dispatch. */
export function ComposerRoot(props: experimental_ComposerProps) {
	const key = composerKey(props.threadId ? { threadId: props.threadId } : { cwd: props.project?.cwd });
	const lifetime = useMemo(() => new AbortController(), [key]);
	const state = useComposerBehavior(props, lifetime.signal);
	const latest = useRef(state);
	latest.current = state;
	const root = useMemo<RootLifetime>(
		() => ({
			state: latest,
			signal: lifetime.signal,
			composing: { current: false },
			binding: { current: undefined },
			hosts: new Map(),
			hadEditor: false,
		}),
		[lifetime],
	);
	const draft = useStore((s) => composerDraftOf(s, key));
	const preferences = useSyncExternalStore(externalState.subscribe, externalState.getProviders);
	const boot = useSyncExternalStore(startupLayout.subscribe, startupLayout.getSnapshot);
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
	const context: experimental_CommandContext = {
		sidebarOpen: getState().sidebarOpen,
		composer: state.target,
		...(props.threadId
			? { thread: { id: props.threadId, cwd: getState().held[props.threadId]?.thread.cwd ?? "" } }
			: { cwd: props.project?.cwd }),
	};
	const preferred = preferences.window.composer ?? preferences.app.composer ?? boot.providers.composer;
	const selected = desktopExtensions.resolveProvider("composer", "builtin.composer/default", preferred, context);
	const fallback = desktopExtensions.resolveProvider("composer", "builtin.composer/default", undefined, context);
	const [committed, setCommitted] = useState(selected);
	useLayoutEffect(() => {
		if (!root.composing.current && !draft.composing) setCommitted(selected);
	}, [selected, draft.composing, root]);
	useLayoutEffect(
		() =>
			mountComposerActions(
				state.target,
				{
					canSubmit: () => latest.current.canSend,
					submit: (alternate) => latest.current.submit(alternate),
					stop: () => latest.current.stop(),
				},
				lifetime.signal,
			).dispose,
		[key, lifetime],
	);
	useLayoutEffect(() => () => lifetime.abort(), [lifetime]);
	useBinding(
		"desktop.turn.interrupt",
		() => {
			experimental_controllers().experimental_runCommand("builtin.composer/stop", context);
		},
		state.canStop &&
			state.text.length === 0 &&
			!state.suggestions &&
			!(props.threadId && getState().held[props.threadId]?.requests.length),
	);
	const report = (event: { target: EventTarget | null }) => {
		if (fromEditor(event.target)) root.binding.current?.report();
	};
	const builtIn = fallback ? <SurfaceEntry entry={fallback} context={context} /> : null;
	const active = committed ?? selected;
	const pending = boot.grace && !!preferred && preferred !== "builtin.composer/default" && selected?.id !== preferred;
	const deferred = !!draft.composing && active !== selected;
	return (
		<Root.Provider value={root}>
			<StateContext.Provider value={state}>
				<div
					style={{ display: "contents" }}
					data-kc-composer-pending={deferred ? "composition" : undefined}
					onBeforeInput={(event) => {
						if (fromEditor(event.target) && draft.locked) event.preventDefault();
					}}
					onInput={(event) => {
						if (!fromEditor(event.target)) return;
						report(event);
						const next = state.controller.experimental_getSnapshot();
						if (next.selection) void state.refreshSuggestions(next.text, next.selection.start);
					}}
					onSelect={report}
					onFocus={report}
					onBlur={report}
					onCompositionStart={(event) => {
						if (fromEditor(event.target)) {
							root.composing.current = true;
							report(event);
						}
					}}
					onCompositionEnd={(event) => {
						if (fromEditor(event.target)) {
							root.composing.current = false;
							report(event);
						}
					}}
					onPaste={(event) => {
						if (!fromEditor(event.target)) return;
						if (draft.locked || root.composing.current) {
							event.preventDefault();
							return;
						}
						if (![...event.clipboardData.items].some((item) => item.type.startsWith("image/"))) return;
						event.preventDefault();
						void client
							.host("host/clipboard/readImage", {})
							.then(({ path }) => {
								if (!path || lifetime.signal.aborted) return;
								if (latest.current.controller.experimental_getSnapshot().locked)
									queueComposerRestoration(key, { text: "", images: [path] });
								else setComposerDraft(key, (d) => ({ ...d, images: [...d.images, path] }));
							})
							.catch((error) => toast(errorText(error), "error"));
					}}
				>
					{pending ? (
						<div role="status" aria-label="Loading composer" data-kc-skeleton="composer" className="min-h-24" />
					) : active ? (
						<SurfaceEntry
							key={active.sequence}
							entry={active}
							context={context}
							fallback={builtIn}
							wrap={RequiredHosts}
						/>
					) : (
						builtIn
					)}
				</div>
			</StateContext.Provider>
		</Root.Provider>
	);
}
