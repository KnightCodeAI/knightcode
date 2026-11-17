/** Host-owned composer transactions, suggestions, queue operations and picker bindings, independent of its editor. */

import type { ApprovalMode, ImageInput, ThinkingLevel, WorkspaceRequest } from "@knightcode/app-server-protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.ts";
import { basename, mentionPath } from "../format.ts";
import { matches } from "../keys.ts";
import {
	interrupt,
	getState,
	composerDraftOf,
	setComposerDraft,
	queueComposerRestoration,
	applyComposerRestorations,
	listCommands,
	removeQueued,
	searchFiles,
	selectPreferences,
	send,
	startingThinking,
	startThread,
	steer,
	takeAttachments,
	toast,
	updateSettings,
	useStore,
} from "../store.ts";
import { ApprovalPicker, ModelPicker, ProjectChip } from "../components/composer-pickers.tsx";
import { CommentsChip, WorkspacePopover } from "../components/git.tsx";

import {
	experimental_composer,
	experimental_controllers,
	type experimental_EditorResult,
	type experimental_ComposerProps,
	type experimental_ComposerState,
	type experimental_ComposerSuggestion as Suggestion,
} from "@knightcodeai/cli/desktop";
import { composerKey } from "./composer-controller.ts";
const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
/** The `@` or `/` token the caret is in, if any. */
function tokenAt(text: string, caret: number): { kind: "@" | "/"; start: number; query: string } | undefined {
	const before = text.slice(0, caret);
	const at = /(^|\s)@([^\s@]*)$/.exec(before);
	if (at) return { kind: "@", start: before.length - at[2]!.length - 1, query: at[2]! };
	const slash = /^\/(\S*)$/.exec(before);
	if (slash) return { kind: "/", start: 0, query: slash[1]! };
	return undefined;
}

export function useComposerBehavior(
	{ threadId, project }: experimental_ComposerProps,
	signal: AbortSignal,
): experimental_ComposerState {
	const view = useStore((s) => (threadId ? s.held[threadId] : undefined));
	const models = useStore((s) => s.models);
	const defaultModel = useStore((s) => s.defaultModel);
	const prefs = useStore(selectPreferences);
	const cwd = project?.cwd;
	const target = useMemo(() => (threadId ? { threadId } : { cwd }), [threadId, cwd]);
	const draftKey = composerKey(target);
	const controller = useMemo(() => experimental_composer(target), [target]);
	const { text, images, composing, locked, restorations } = useStore((s) => composerDraftOf(s, draftKey));
	const setText = (value: string | ((current: string) => string)) =>
		setComposerDraft(draftKey, (draft) => ({
			...draft,
			text: typeof value === "function" ? value(draft.text) : value,
		}));
	const setImages = (value: string[] | ((current: string[]) => string[])) =>
		setComposerDraft(draftKey, (draft) => ({
			...draft,
			images: typeof value === "function" ? value(draft.images) : value,
		}));
	const [startState, setStarting] = useState({ key: draftKey, pending: false });
	const starting = startState.key === draftKey && startState.pending;
	const startingNow = useMemo(() => ({ current: false }), [target]);
	useEffect(() => {
		applyComposerRestorations(draftKey);
	}, [draftKey, restorations, composing, locked]);
	const [draftModel, setDraftModel] = useState<{ provider: string; id: string } | undefined>();
	const [draftThinking, setDraftThinking] = useState<ThinkingLevel | undefined>();
	const [draftMode, setDraftMode] = useState<ApprovalMode>("ask");
	const [workspace, setWorkspace] = useState<WorkspaceRequest>({ mode: "local" });
	const [suggestions, setSuggestions] = useState<
		{ items: Suggestion[]; truncated: boolean; start: number; revision: number } | undefined
	>();
	const [selected, setSelected] = useState(0);
	const [dragging, setDragging] = useState(false);
	const ref = useMemo(
		() => ({
			current: {
				get selectionStart() {
					return controller.experimental_getSnapshot().selection?.start;
				},
				get value() {
					return controller.experimental_getSnapshot().text;
				},
				focus() {
					controller.experimental_focus();
				},
				setSelectionRange(start: number, end: number) {
					controller.experimental_select(
						{ start, end, direction: "none" },
						controller.experimental_getSnapshot().revision,
					);
				},
			},
		}),
		[controller],
	);
	const searchId = useMemo(() => `composer-${crypto.randomUUID()}`, []);
	const commands = useMemo<{ current: { name: string; description: string }[] | undefined }>(
		() => ({ current: undefined }),
		[target],
	);
	const panelRef = useRef<HTMLDivElement>(null);
	const boxRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		panelRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
	}, [selected, suggestions]);
	useEffect(() => {
		if (!suggestions) return;
		const onDown = (event: MouseEvent) => {
			if (!boxRef.current?.contains(event.target as Node)) setSuggestions(undefined);
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [suggestions]);
	useEffect(() => {
		ref.current?.focus();
		commands.current = undefined;
	}, [threadId]);
	// An annotated preview region arrives as an image with the page's URL, as a paste would.
	const waiting = useStore((s) => (threadId ? s.attachments[threadId] : undefined));
	useEffect(() => {
		if (!threadId || !waiting || composing || locked) return;
		const taken = takeAttachments(threadId);
		if (!taken) return;
		setImages((list) => [...list, ...taken.images.filter((p) => !list.includes(p))]);
		if (taken.text) setText((t) => (t.trim() ? `${t}\n${taken.text}` : taken.text));
		ref.current?.focus();
	}, [threadId, waiting, composing, locked]);
	useEffect(() => {
		// A new thread's commands come from its project, and so do a worktree's base branch and environment.
		commands.current = undefined;
		setSuggestions(undefined);
		setWorkspace((w) => (w.mode === "worktree" ? { mode: "worktree" } : w));
	}, [cwd]);

	const thread = view?.thread;
	const workdir = thread?.cwd ?? cwd;
	const running = view?.turns.some((t) => t.status === "inProgress") ?? false;
	const selector =
		thread?.model ??
		draftModel ??
		(defaultModel
			? { provider: defaultModel.split("/")[0]!, id: defaultModel.slice(defaultModel.indexOf("/") + 1) }
			: undefined);
	const model = models.find((m) => m.provider === selector?.provider && m.id === selector.id);
	// A new thread takes the user's default level from settings unless they pick one here.
	const startLevel = useStore((s) => (model ? startingThinking(s, model) : undefined));
	const thinking = thread?.thinkingLevel ?? draftThinking ?? startLevel;
	const mode = thread?.approvalMode ?? draftMode;
	const hasContent = text.trim().length > 0 || images.length > 0;
	const canSend =
		hasContent &&
		!starting &&
		!composing &&
		!locked &&
		!view?.requests.length &&
		(threadId ? true : Boolean(cwd && model));
	const canStop = running && !composing && !locked;

	const refreshSuggestions = async (value: string, caret: number) => {
		if (signal.aborted) return;
		const revision = controller.experimental_getSnapshot().revision;
		const token = tokenAt(value, caret);
		if (!token) return setSuggestions(undefined);
		if (token.kind === "/") {
			const target = threadId ? { threadId } : workdir ? { cwd: workdir } : undefined;
			if (!target) return setSuggestions(undefined);
			const available = commands.current ?? (await listCommands(target));
			if (signal.aborted || controller.experimental_getSnapshot().revision !== revision) return;
			commands.current = available;
			const q = token.query.toLowerCase();
			// Commands A to Z, then skills, as Codex orders its list.
			const items = commands.current
				.filter((c) => c.name.toLowerCase().includes(q))
				.sort(
					(a, b) =>
						Number(a.name.startsWith("skill:")) - Number(b.name.startsWith("skill:")) || a.name.localeCompare(b.name),
				)
				.slice(0, 30)
				.map((c): Suggestion => {
					const skill = c.name.startsWith("skill:");
					return {
						key: c.name,
						label: skill ? c.name.slice("skill:".length) : c.name,
						detail: c.description,
						insert: `/${c.name} `,
						icon: skill ? "skill" : "command",
					};
				});
			setSelected(0);
			return setSuggestions(items.length ? { items, truncated: false, start: token.start, revision } : undefined);
		}
		if (!workdir || token.query.length === 0) return setSuggestions(undefined);
		try {
			const result = await searchFiles(workdir, token.query, searchId);
			if (signal.aborted || controller.experimental_getSnapshot().revision !== revision) return;
			const items = result.files.map((f): Suggestion => {
				const folder = /[\\/]$/.test(f.path);
				const path = f.path.replace(/[\\/]$/, "");
				const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
				const dir = cut < 0 ? "" : path.slice(0, cut);
				return {
					key: f.path,
					label: basename(path),
					detail: dir,
					insert: `@${f.path} `,
					icon: folder ? "folder" : "file",
				};
			});
			setSelected(0);
			setSuggestions(items.length ? { items, truncated: result.truncated, start: token.start, revision } : undefined);
		} catch {
			// A superseded search rejects; the newer one answers.
		}
	};

	const accept = (suggestion: Suggestion) => {
		if (signal.aborted) return;
		if (controller.experimental_getSnapshot().composing || controller.experimental_getSnapshot().locked) return;
		const draft = controller.experimental_getSnapshot();
		if (suggestions && suggestions.revision !== draft.revision) return;
		if (suggestion.run) {
			setSuggestions(undefined);
			suggestion.run();
			return;
		}
		if (!draft.selection || !suggestions) return;
		const result = controller.experimental_replace(
			{ start: suggestions.start, end: draft.selection.end, direction: "none" },
			suggestion.insert ?? "",
			suggestions.revision,
		);
		if (result.status !== "applied") return;
		setSuggestions(undefined);
		controller.experimental_focus();
	};

	/** `alternate` is the Mod+Enter action: the opposite of the "while running" preference. */
	const submit = (alternate: boolean): experimental_EditorResult => {
		if (signal.aborted) return { status: "unavailable" };
		const current = controller.experimental_getSnapshot();
		if (startingNow.current || current.composing) return { status: "busy" };
		if (current.locked || view?.requests.length) return { status: "locked" };
		if (!controller.experimental_canSubmit()) return { status: "unavailable" };
		const value = current.text.trim();
		const images = current.images;
		if (!value && !images.length) return { status: "unavailable" };
		const attached: ImageInput[] = images.map((path) => ({ path }));
		if (!threadId) {
			if (!cwd || !model) return { status: "unavailable" };
			startingNow.current = true;
			setStarting({ key: draftKey, pending: true });
			setComposerDraft(draftKey, (d) => ({
				...d,
				text: "",
				images: [],
				selection: { start: 0, end: 0, direction: "none" },
			}));
			void startThread(
				cwd,
				value,
				{
					model: { provider: model.provider, id: model.id },
					...(draftThinking ? { thinkingLevel: draftThinking } : {}),
					approvalMode: mode,
					...(workspace.mode === "worktree" ? { workspace } : {}),
				},
				attached,
			)
				.catch((error: unknown) => {
					queueComposerRestoration(draftKey, { text: current.text, images });
					toast(error instanceof Error ? error.message : String(error), "error");
				})
				.finally(() => {
					startingNow.current = false;
					if (!signal.aborted) setStarting({ key: draftKey, pending: false });
				});
		} else {
			setComposerDraft(draftKey, (d) => ({
				...d,
				text: "",
				images: [],
				selection: { start: 0, end: 0, direction: "none" },
			}));
			const steering = running && (prefs.whileRunning === "steer") !== alternate;
			void (steering ? steer(threadId, value, attached) : send(threadId, value, attached));
		}
		return { status: "applied", revision: controller.experimental_getSnapshot().revision };
	};

	const attachFiles = async () => {
		if (signal.aborted) return;
		const draft = controller.experimental_getSnapshot();
		if (draft.locked || draft.composing) return;
		const { paths } = await client.host("host/dialog/openFiles", { images: true });
		if (signal.aborted || !paths.length) return;
		if (controller.experimental_getSnapshot().locked) queueComposerRestoration(draftKey, { text: "", images: paths });
		else setImages((list) => [...list, ...paths]);
	};

	/** The + menu: Codex's "Add" panel above the composer, sharing the suggestion panel and its keys. */
	const toggleAddMenu = async () => {
		if (signal.aborted) return;
		if (controller.experimental_getSnapshot().composing || controller.experimental_getSnapshot().locked) return;
		if (suggestions?.items[0]?.section === "Add") return setSuggestions(undefined);
		const target = threadId ? { threadId } : workdir ? { cwd: workdir } : undefined;
		const available = target ? (commands.current ?? (await listCommands(target))) : [];
		if (signal.aborted) return;
		commands.current = available;
		const items: Suggestion[] = [
			{
				key: "add:images",
				section: "Add",
				icon: "image",
				label: "Images",
				detail: "Attach screenshots or pictures",
				run: () => void attachFiles(),
			},
		];
		if (commands.current?.some((c) => c.name === "plan"))
			items.push({
				key: "add:plan",
				section: "Add",
				icon: "plan",
				label: "Plan mode",
				detail: "Plan the work before changing anything",
				run: () => {
					if (signal.aborted) return;
					const draft = controller.experimental_getSnapshot();
					if (!draft.text.startsWith("/plan ")) {
						const result = controller.experimental_replace(
							{ start: 0, end: 0, direction: "none" },
							"/plan ",
							draft.revision,
						);
						if (result.status !== "applied") return;
					}
					controller.experimental_focusEnd();
				},
			});
		setSelected(0);
		setSuggestions({
			items,
			truncated: false,
			start: ref.current?.selectionStart ?? 0,
			revision: controller.experimental_getSnapshot().revision,
		});
		ref.current?.focus();
	};

	const queued = view
		? [
				...view.queue.steering.map((t) => ({ id: undefined, text: t, steer: true })),
				...view.queue.followUp.map((e) => ({ ...e, steer: false })),
			]
		: [];

	/** Put text at the start of the field, ahead of anything already typed, and focus its end. */
	const takeBack = (value: string) => {
		const draft = controller.experimental_getSnapshot();
		if (draft.composing || draft.locked) {
			queueComposerRestoration(draftKey, { text: value, images: [] });
			return;
		}
		// The latest text, not this render's: the caller may have awaited a round trip while the user typed.
		setText((current) => (current.trim() ? `${value}\n\n${current}` : value));
		requestAnimationFrame(() => {
			const field = ref.current;
			field?.focus();
			field?.setSelectionRange(field.value.length, field.value.length);
		});
	};

	/** Dropped files: images attach, anything else becomes an `@` mention at the caret. */
	const drop = (files: File[]) => {
		if (signal.aborted) return;
		if (controller.experimental_getSnapshot().composing || controller.experimental_getSnapshot().locked) return;
		const paths = files.map((file) => window.knightcode.pathForFile(file)).filter(Boolean);
		const pictures = paths.filter((path) => IMAGE_FILE.test(path));
		const mentions = paths.filter((path) => !IMAGE_FILE.test(path)).map((path) => `@${mentionPath(path, workdir)} `);
		const draft = controller.experimental_getSnapshot();
		// Attachments advance the revision too; insert first so a mixed drop does not stale its own selection.
		if (mentions.length && draft.selection) {
			const before = draft.text.slice(0, draft.selection.start);
			const insert = (before && !/\s$/.test(before) ? " " : "") + mentions.join("");
			const result = controller.experimental_insert(insert, draft.revision);
			if (result.status === "applied") controller.experimental_focus();
		}
		if (pictures.length) setImages((list) => [...list, ...pictures.filter((p) => !list.includes(p))]);
	};
	const carriesFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");
	const modKey = window.knightcode.platform === "darwin" ? "⌘" : "Ctrl";

	return {
		target,
		controller,
		text,
		images,
		threadId,
		project,
		running,
		hasContent,
		canSend,
		canStop,
		placeholder: running
			? prefs.whileRunning === "queue"
				? `Queue a follow-up${prefs.sendKey === "enter" ? ` · ${modKey}+Enter to steer` : ""}`
				: `Steer the turn${prefs.sendKey === "enter" ? ` · ${modKey}+Enter to queue` : ""}`
			: threadId
				? "Work with KnightCode"
				: "Do anything",
		whileRunning: prefs.whileRunning,
		usage: view?.usage,
		showContextUsage: prefs.showContextUsage !== false,
		parts: {
			project: (
				<ProjectChip
					cwd={cwd}
					onChange={(value) => {
						if (!signal.aborted) project?.onChange(value);
					}}
				/>
			),
			workspace: (
				<WorkspacePopover
					cwd={cwd}
					value={workspace}
					onChange={(value) => {
						if (!signal.aborted) setWorkspace(value);
					}}
				/>
			),
			comments: threadId ? <CommentsChip threadId={threadId} /> : null,
			permissions: (
				<ApprovalPicker
					mode={mode}
					threadKey={threadId ?? searchId}
					onChange={(m) => {
						if (signal.aborted) return;
						threadId ? void updateSettings(threadId, { approvalMode: m }) : setDraftMode(m);
					}}
				/>
			),
			model: (
				<ModelPicker
					model={model}
					thinking={thinking}
					onChange={({ model: m, thinking: level }) => {
						if (signal.aborted) return;
						const choice = m && { provider: m.provider, id: m.id };
						if (threadId) return void updateSettings(threadId, { model: choice, thinkingLevel: level });
						if (choice) setDraftModel(choice);
						if (level) setDraftThinking(level);
					}}
				/>
			),
		},
		queued,
		suggestions,
		selected,
		dragging,
		boxRef,
		panelRef,
		setSelected,
		accept,
		toggleAddMenu,
		submit,
		refreshSuggestions,
		dismissSuggestions: () => setSuggestions(undefined),
		stop: () => {
			const draft = controller.experimental_getSnapshot();
			if (!signal.aborted && threadId && !draft.composing && !draft.locked) void interrupt(threadId);
		},
		removeImage: (path) => {
			const draft = controller.experimental_getSnapshot();
			if (!signal.aborted && !draft.locked && !draft.composing) setImages((list) => list.filter((p) => p !== path));
		},
		queueSteer: (id, value) => {
			if (!signal.aborted && threadId)
				void removeQueued(threadId, id).then((removed) => (removed ? steer(threadId, value) : undefined));
		},
		queueDelete: (id) => {
			if (!signal.aborted && threadId) void removeQueued(threadId, id);
		},
		queueEdit: (id, value) => {
			const draft = controller.experimental_getSnapshot();
			if (!signal.aborted && !draft.composing && !draft.locked && threadId)
				void removeQueued(threadId, id).then((removed) => {
					if (removed) takeBack(value);
				});
		},
		dropProps: {
			onDragOver: (event) => {
				if (!carriesFiles(event)) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
				setDragging(true);
			},
			onDragLeave: (event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
			},
			onDrop: (event) => {
				if (!carriesFiles(event)) return;
				event.preventDefault();
				setDragging(false);
				drop([...event.dataTransfer.files]);
			},
		},
		onKeyDown: (event) => {
			if (!(event.target instanceof HTMLElement) || !event.target.closest("[data-kc-editor]")) return;
			if (controller.experimental_getSnapshot().composing || controller.experimental_getSnapshot().locked) return;

			if (event.nativeEvent.isComposing) return;
			if (suggestions) {
				if (matches(event, "desktop.picker.next")) {
					event.preventDefault();
					return setSelected((selected + 1) % suggestions.items.length);
				}
				if (matches(event, "desktop.picker.previous")) {
					event.preventDefault();
					return setSelected((selected - 1 + suggestions.items.length) % suggestions.items.length);
				}
				if (matches(event, "desktop.picker.accept")) {
					event.preventDefault();
					return accept(suggestions.items[selected]!);
				}
				if (matches(event, "desktop.picker.dismiss")) {
					event.preventDefault();
					return setSuggestions(undefined);
				}
			}
			const sendKey = prefs.sendKey === "enter" ? "desktop.composer.send" : "desktop.composer.steer";
			if (matches(event, sendKey)) {
				event.preventDefault();
				experimental_controllers().experimental_runCommand("builtin.composer/send", {
					sidebarOpen: getState().sidebarOpen,
					composer: target,
					...(thread ? { thread: { id: thread.id, cwd: thread.cwd } } : { cwd }),
				});
			} else if (prefs.sendKey === "enter" && matches(event, "desktop.composer.steer")) {
				event.preventDefault();
				experimental_controllers().experimental_runCommand("builtin.composer/alternate", {
					sidebarOpen: getState().sidebarOpen,
					composer: target,
					...(thread ? { thread: { id: thread.id, cwd: thread.cwd } } : { cwd }),
				});
			} else if (matches(event, "desktop.composer.newline")) {
				event.preventDefault();
				controller.experimental_insert("\n", controller.experimental_getSnapshot().revision);
			}
		},
	};
}
