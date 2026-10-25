/**
 * The composer (desktop-shell.md section 9.4), shaped like Codex's (measured 2026-10-19): a 22px-cornered field on
 * the composer fill with a faint inner ring; the text at 14px; + and the approval mode at the bottom left, the model
 * and Send at the bottom right, all 28px. For a new thread a utility bar sits on its top edge with the project chip
 * and the environment gear. Send queues while a turn runs (or steers, by preference); a queued message can be sent
 * as a steer, deleted, or taken back into the field to edit (Codex's queue rows). `@` finds files, `/` lists commands,
 * + offers attachments, all in one panel above the field; pasted, picked or dropped images go to the server as paths,
 * and other dropped files become `@` mentions.
 */

import type { ApprovalMode, ImageInput, ThinkingLevel, WorkspaceRequest } from "@knightcode/app-server-protocol";
import {
	ArrowUp,
	Check,
	FileText,
	Folder,
	ImagePlus,
	Lightbulb,
	MoreHorizontal,
	Pencil,
	Plus,
	Sparkles,
	Square,
	SquareSlash,
	Trash2,
	X,
} from "./icons.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.ts";
import { basename, mentionPath, tokens } from "../format.ts";
import { matches, useBinding } from "../keys.ts";
import {
	interrupt,
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
import { Button, IconButton } from "./button.tsx";
import { Tooltip } from "./tooltip.tsx";
import { ApprovalPicker, ModelPicker, ProjectChip } from "./composer-pickers.tsx";
import { CommentsChip, WorkspacePopover } from "./git.tsx";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu.tsx";

/** A row in the panel above the composer: an insertion for `@` and `/`, or an action from the + menu. */
interface Suggestion {
	key: string;
	label: string;
	detail?: string;
	insert?: string;
	run?: () => void;
	section?: string;
	icon: keyof typeof SUGGESTION_ICONS;
}

const SUGGESTION_ICONS = {
	file: FileText,
	folder: Folder,
	command: SquareSlash,
	skill: Sparkles,
	image: ImagePlus,
	plan: Lightbulb,
};

/** An attached image as a thumbnail; the file name shows on hover. */
function ImageChip({ path, onRemove }: { path: string; onRemove: () => void }) {
	const [src, setSrc] = useState<string>();
	useEffect(() => {
		void client.host("host/image/thumbnail", { path }).then(({ dataUrl }) => setSrc(dataUrl));
	}, [path]);
	return (
		<Tooltip content={basename(path)}>
			<span className="group relative size-14 overflow-hidden rounded-lg border border-line bg-ghost-hover">
				{src ? (
					<img src={src} alt={basename(path)} className="size-full object-cover" />
				) : (
					<ImagePlus size={16} className="m-auto mt-[19px] text-secondary" />
				)}
				{/* Its label stays unspoken on hover: the thumbnail's own tooltip already shows. */}
				<button
					type="button"
					aria-label="Remove image"
					onClick={onRemove}
					className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
				>
					<X size={11} />
				</button>
			</span>
		</Tooltip>
	);
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * Codex's queued message row: its text on one line, then Steer (send it into the running turn now), Delete, and a …
 * menu with Edit message (take it back into the field). A message already steering only shows its text.
 */
function QueuedRow({
	text,
	steering,
	attachments,
	onSteer,
	onDelete,
	onEdit,
}: {
	text: string;
	steering: boolean;
	/** Images or review comments: steering or editing would carry the text only, so only Delete is offered. */
	attachments?: number;
	onSteer: () => void;
	onDelete: () => void;
	onEdit: () => void;
}) {
	return (
		<div className="flex min-h-7 items-center gap-2 text-base text-secondary">
			<Tooltip content={text} overflow>
				<span className="min-w-0 flex-1 truncate leading-5">
					{steering ? <span className="me-2 text-sm text-tertiary">Steering</span> : null}
					{text}
				</span>
			</Tooltip>
			{steering ? null : (
				<div className="flex shrink-0 items-center gap-0.5">
					{attachments ? null : (
						<Tooltip content="Submit without interrupting the model">
							<Button color="secondary" size="xs" pill onClick={onSteer} className="px-2">
								Steer
							</Button>
						</Tooltip>
					)}
					<IconButton label="Delete queued message" size="xs" round onClick={onDelete}>
						<Trash2 size={14} />
					</IconButton>
					{attachments ? null : (
						<Menu>
							<MenuTrigger>
								<IconButton label="Queued message actions" size="xs" round>
									<MoreHorizontal size={14} />
								</IconButton>
							</MenuTrigger>
							<MenuContent align="end" side="top" minWidth={0}>
								<MenuItem icon={<Pencil />} onSelect={onEdit}>
									Edit message
								</MenuItem>
							</MenuContent>
						</Menu>
					)}
				</div>
			)}
		</div>
	);
}

/** The `@` or `/` token the caret is in, if any. */
function tokenAt(text: string, caret: number): { kind: "@" | "/"; start: number; query: string } | undefined {
	const before = text.slice(0, caret);
	const at = /(^|\s)@([^\s@]*)$/.exec(before);
	if (at) return { kind: "@", start: before.length - at[2]!.length - 1, query: at[2]! };
	const slash = /^\/(\S*)$/.exec(before);
	if (slash) return { kind: "/", start: 0, query: slash[1]! };
	return undefined;
}

export function Composer({
	threadId,
	project,
}: {
	threadId?: string;
	/** A new thread's project, owned by the home screen (its title names it too). */
	project?: { cwd: string | undefined; onChange: (cwd: string) => void };
}) {
	const view = useStore((s) => (threadId ? s.held[threadId] : undefined));
	const models = useStore((s) => s.models);
	const defaultModel = useStore((s) => s.defaultModel);
	const prefs = useStore(selectPreferences);
	const [text, setText] = useState("");
	const [images, setImages] = useState<string[]>([]);
	const cwd = project?.cwd;
	const [draftModel, setDraftModel] = useState<{ provider: string; id: string } | undefined>();
	const [draftThinking, setDraftThinking] = useState<ThinkingLevel | undefined>();
	const [draftMode, setDraftMode] = useState<ApprovalMode>("ask");
	const [workspace, setWorkspace] = useState<WorkspaceRequest>({ mode: "local" });
	const [suggestions, setSuggestions] = useState<
		{ items: Suggestion[]; truncated: boolean; start: number } | undefined
	>();
	const [selected, setSelected] = useState(0);
	const [dragging, setDragging] = useState(false);
	const ref = useRef<HTMLTextAreaElement>(null);
	const searchId = useMemo(() => `composer-${crypto.randomUUID()}`, []);
	const commands = useRef<{ name: string; description: string }[] | undefined>(undefined);
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
		if (!threadId || !waiting) return;
		const taken = takeAttachments(threadId);
		if (!taken) return;
		setImages((list) => [...list, ...taken.images.filter((p) => !list.includes(p))]);
		if (taken.text) setText((t) => (t.trim() ? `${t}\n${taken.text}` : taken.text));
		ref.current?.focus();
	}, [threadId, waiting]);
	useEffect(() => {
		// A new thread's commands come from its project, and so do a worktree's base branch and environment.
		commands.current = undefined;
		setWorkspace((w) => (w.mode === "worktree" ? { mode: "worktree" } : w));
	}, [cwd]);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 300)}px`;
	}, [text]);

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
	const canSend = hasContent && (threadId ? true : Boolean(cwd && model));

	const refreshSuggestions = async (value: string, caret: number) => {
		const token = tokenAt(value, caret);
		if (!token) return setSuggestions(undefined);
		if (token.kind === "/") {
			const target = threadId ? { threadId } : workdir ? { cwd: workdir } : undefined;
			if (!target) return setSuggestions(undefined);
			commands.current ??= await listCommands(target);
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
			return setSuggestions(items.length ? { items, truncated: false, start: token.start } : undefined);
		}
		if (!workdir || token.query.length === 0) return setSuggestions(undefined);
		try {
			const result = await searchFiles(workdir, token.query, searchId);
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
			setSuggestions(items.length ? { items, truncated: result.truncated, start: token.start } : undefined);
		} catch {
			// A superseded search rejects; the newer one answers.
		}
	};

	const accept = (suggestion: Suggestion) => {
		if (suggestion.run) {
			setSuggestions(undefined);
			suggestion.run();
			return;
		}
		const el = ref.current;
		const caret = el?.selectionStart ?? text.length;
		const start = suggestions?.start ?? caret;
		const insert = suggestion.insert ?? "";
		const next = text.slice(0, start) + insert + text.slice(caret);
		setText(next);
		setSuggestions(undefined);
		requestAnimationFrame(() => {
			const pos = start + insert.length;
			el?.focus();
			el?.setSelectionRange(pos, pos);
		});
	};

	/** `alternate` is the Mod+Enter action: the opposite of the "while running" preference. */
	const submit = (alternate: boolean) => {
		const value = text.trim();
		if (!hasContent) return;
		const attached: ImageInput[] = images.map((path) => ({ path }));
		if (!threadId) {
			if (!cwd || !model) return;
			setText("");
			setImages([]);
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
			).catch((error: unknown) => {
				setText(value);
				setImages(images);
				toast(error instanceof Error ? error.message : String(error), "error");
			});
			return;
		}
		setText("");
		setImages([]);
		const steering = running && (prefs.whileRunning === "steer") !== alternate;
		void (steering ? steer(threadId, value, attached) : send(threadId, value, attached));
	};

	useBinding(
		"desktop.turn.interrupt",
		() => {
			if (threadId) void interrupt(threadId);
		},
		running && text.length === 0 && !view?.requests.length && !suggestions,
	);

	const attachFiles = async () => {
		const { paths } = await client.host("host/dialog/openFiles", { images: true });
		if (paths.length) setImages((list) => [...list, ...paths]);
	};

	/** The + menu: Codex's "Add" panel above the composer, sharing the suggestion panel and its keys. */
	const toggleAddMenu = async () => {
		if (suggestions?.items[0]?.section === "Add") return setSuggestions(undefined);
		const target = threadId ? { threadId } : workdir ? { cwd: workdir } : undefined;
		if (target) commands.current ??= await listCommands(target);
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
					const next = text.startsWith("/plan ") ? text : `/plan ${text}`;
					setText(next);
					requestAnimationFrame(() => {
						ref.current?.focus();
						ref.current?.setSelectionRange(next.length, next.length);
					});
				},
			});
		setSelected(0);
		setSuggestions({ items, truncated: false, start: ref.current?.selectionStart ?? text.length });
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
		const paths = files.map((file) => window.knightcode.pathForFile(file)).filter(Boolean);
		const pictures = paths.filter((path) => IMAGE_FILE.test(path));
		if (pictures.length) setImages((list) => [...list, ...pictures.filter((p) => !list.includes(p))]);
		const mentions = paths.filter((path) => !IMAGE_FILE.test(path)).map((path) => `@${mentionPath(path, workdir)} `);
		if (!mentions.length) return;
		const caret = ref.current?.selectionStart ?? text.length;
		const before = text.slice(0, caret);
		const insert = (before && !/\s$/.test(before) ? " " : "") + mentions.join("");
		setText(before + insert + text.slice(caret));
		requestAnimationFrame(() => {
			ref.current?.focus();
			ref.current?.setSelectionRange(caret + insert.length, caret + insert.length);
		});
	};
	const carriesFiles = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");
	const modKey = window.knightcode.platform === "darwin" ? "⌘" : "Ctrl";

	return (
		<div data-composer className="@container mx-auto w-full max-w-3xl px-4 pt-1.5 pb-4">
			<div ref={boxRef} className="relative">
				{/* A new thread's utility bar, tucked under the composer's top edge (Codex's): the project and the
				    environment. The suggestion panel takes its place while open. */}
				{project ? (
					<div
						className={`relative mx-[13px] -mb-1 rounded-t-[20px] bg-composer-bar px-1 pb-1 ${suggestions ? "invisible" : ""}`}
					>
						<div role="group" aria-label="Composer utility bar" className="flex items-center gap-2 py-[5px] ps-0.5">
							<ProjectChip cwd={cwd} onChange={project.onChange} />
							<div className="flex-1" />
							<WorkspacePopover cwd={cwd} value={workspace} onChange={setWorkspace} />
						</div>
					</div>
				) : null}
				<div
					data-dragging={dragging || undefined}
					onDragOver={(event) => {
						if (!carriesFiles(event)) return;
						event.preventDefault();
						event.dataTransfer.dropEffect = "copy";
						setDragging(true);
					}}
					onDragLeave={(event) => {
						if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
					}}
					onDrop={(event) => {
						if (!carriesFiles(event)) return;
						event.preventDefault();
						setDragging(false);
						drop([...event.dataTransfer.files]);
					}}
					className="relative rounded-composer bg-composer shadow-[var(--kc-composer-ring)]"
				>
					{/* The "/", "@" and "+" panel: as wide as the composer, 8px above it, as Codex's. */}
					{suggestions ? (
						<div className="kc-menu kc-menu-solid absolute inset-x-0 bottom-full mb-2 flex max-h-80 flex-col overflow-hidden">
							<div ref={panelRef} className="min-h-0 overflow-y-auto">
								{suggestions.items.map((s, i) => {
									const Icon = SUGGESTION_ICONS[s.icon];
									return (
										<div key={s.key}>
											{s.section && s.section !== suggestions.items[i - 1]?.section ? (
												<div className="kc-menu-label">{s.section}</div>
											) : null}
											<button
												type="button"
												data-active={i === selected}
												onMouseDown={(e) => {
													e.preventDefault();
													accept(s);
												}}
												onMouseEnter={() => setSelected(i)}
												className="kc-row gap-2 text-ink"
											>
												<Icon size={16} className="shrink-0" />
												<span className="shrink-0">{s.label}</span>
												{s.detail ? <span className="min-w-0 truncate text-tertiary">{s.detail}</span> : null}
											</button>
										</div>
									);
								})}
								{suggestions.truncated ? (
									<div className="px-2 py-1 text-xs text-tertiary">Some files may be missing</div>
								) : null}
							</div>
						</div>
					) : null}
					{dragging ? (
						<div className="kc-drop-target pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-composer text-base font-semibold text-ink">
							Drop files to attach
						</div>
					) : null}
					{queued.length > 0 ? (
						<div className="flex flex-col gap-1 border-b border-line px-4 py-2">
							{queued.map((q, i) => (
								<QueuedRow
									key={q.id ?? `s${i}`}
									text={q.text}
									steering={q.steer}
									attachments={"attachments" in q ? q.attachments : undefined}
									onSteer={() => {
										if (!threadId || !q.id) return;
										void removeQueued(threadId, q.id).then((removed) =>
											removed ? steer(threadId, q.text) : undefined,
										);
									}}
									onDelete={() => threadId && q.id && void removeQueued(threadId, q.id)}
									onEdit={() => {
										if (!threadId || !q.id) return;
										void removeQueued(threadId, q.id).then((removed) => {
											if (removed) takeBack(q.text);
										});
									}}
								/>
							))}
						</div>
					) : null}
					{threadId ? (
						<div className="flex flex-wrap gap-2 px-4 pt-3 empty:hidden">
							<CommentsChip threadId={threadId} />
						</div>
					) : null}
					{images.length > 0 ? (
						<div className="flex flex-wrap gap-2 px-4 pt-3">
							{images.map((path) => (
								<ImageChip
									key={path}
									path={path}
									onRemove={() => setImages((list) => list.filter((p) => p !== path))}
								/>
							))}
						</div>
					) : null}
					<div className="px-2 pt-[14px]">
						<textarea
							ref={ref}
							value={text}
							rows={1}
							aria-label="Message"
							onChange={(e) => {
								setText(e.target.value);
								void refreshSuggestions(e.target.value, e.target.selectionStart);
							}}
							onPaste={(event) => {
								if (![...event.clipboardData.items].some((item) => item.type.startsWith("image/"))) return;
								event.preventDefault();
								void client
									.host("host/clipboard/readImage", {})
									.then(({ path }) => {
										if (path) setImages((list) => [...list, path]);
									})
									.catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), "error"));
							}}
							onKeyDown={(event) => {
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
									submit(false);
								} else if (prefs.sendKey === "enter" && matches(event, "desktop.composer.steer")) {
									event.preventDefault();
									submit(true);
								}
							}}
							placeholder={
								running
									? // Mod+Enter does the other only when Enter sends; with Mod+Enter as the send key it has none.
										prefs.whileRunning === "queue"
										? `Queue a follow-up${prefs.sendKey === "enter" ? ` · ${modKey}+Enter to steer` : ""}`
										: `Steer the turn${prefs.sendKey === "enter" ? ` · ${modKey}+Enter to queue` : ""}`
									: threadId
										? "Work with KnightCode"
										: "Do anything"
							}
							className="selectable block max-h-[300px] min-h-11 w-full resize-none bg-transparent px-3 text-base leading-5 outline-none placeholder:text-tertiary focus-visible:outline-none"
						/>
					</div>
					<div className="flex items-center gap-[5px] px-2 pt-[5px] pb-[7px]">
						<IconButton
							label="Add files and more"
							round
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => void toggleAddMenu()}
							aria-expanded={suggestions?.items[0]?.section === "Add"}
							className="!text-ink"
						>
							<Plus size={16} />
						</IconButton>
						<ApprovalPicker
							mode={mode}
							threadKey={threadId ?? searchId}
							onChange={(m) => (threadId ? void updateSettings(threadId, { approvalMode: m }) : setDraftMode(m))}
						/>
						<div className="flex-1" />
						{prefs.showContextUsage !== false && view?.usage?.contextTokens && view.usage.contextWindow ? (
							<Tooltip
								content={`${tokens(view.usage.contextTokens)} of ${tokens(view.usage.contextWindow)} tokens · $${view.usage.cost.toFixed(2)} this thread`}
							>
								<span
									className="mr-1 flex text-tertiary"
									aria-label={`${Math.round((view.usage.contextTokens / view.usage.contextWindow) * 100)}% of context used`}
								>
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75}>
										<circle cx="8" cy="8" r="5.5" strokeOpacity={0.3} />
										<circle
											cx="8"
											cy="8"
											r="5.5"
											pathLength={100}
											strokeDasharray={`${Math.min(100, (view.usage.contextTokens / view.usage.contextWindow) * 100)} 100`}
											transform="rotate(-90 8 8)"
										/>
									</svg>
								</span>
							</Tooltip>
						) : null}
						<ModelPicker
							model={model}
							thinking={thinking}
							onChange={({ model: m, thinking: level }) => {
								const choice = m && { provider: m.provider, id: m.id };
								if (threadId) return void updateSettings(threadId, { model: choice, thinkingLevel: level });
								if (choice) setDraftModel(choice);
								if (level) setDraftThinking(level);
							}}
						/>
						{running && !hasContent ? (
							<Tooltip content="Stop">
								<Button
									variant="accent"
									pill
									uniform
									aria-label="Stop"
									onClick={() => threadId && void interrupt(threadId)}
								>
									<Square size={14} fill="currentColor" />
								</Button>
							</Tooltip>
						) : (
							<Tooltip content={running ? (prefs.whileRunning === "queue" ? "Queue" : "Steer") : "Send"}>
								<Button
									variant="accent"
									pill
									uniform
									aria-label={running ? (prefs.whileRunning === "queue" ? "Queue" : "Steer") : "Send"}
									disabled={!canSend}
									onClick={() => submit(false)}
								>
									{running ? <Check size={14} strokeWidth={1.7} /> : <ArrowUp size={16} strokeWidth={1.6} />}
								</Button>
							</Tooltip>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
