/**
 * The composer (desktop-shell.md section 9.4), shaped like Codex's: one rounded field with attach and
 * the approval mode at the bottom left, the model and Send at the bottom right. Send queues while a
 * turn runs (or steers, by preference); `@` finds files, `/` lists commands; pasted or picked images
 * go to the server as paths.
 */

import type { ApprovalMode, ImageInput, ThinkingLevel } from "@knightcode/app-server-protocol";
import {
	ArrowUp,
	Check,
	ChevronDown,
	FileText,
	FolderOpen,
	FolderPlus,
	Hand,
	ImagePlus,
	Plus,
	ShieldAlert,
	ShieldCheck,
	Slash,
	Square,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.ts";
import { basename, tokens } from "../format.ts";
import { matches, useBinding } from "../keys.ts";
import {
	addProject,
	interrupt,
	listCommands,
	type ModelInfo,
	removeQueued,
	searchFiles,
	selectPreferences,
	selectProjects,
	send,
	startThread,
	steer,
	updateSettings,
	useStore,
} from "../store.ts";
import { MenuItem, Popover } from "./popover.tsx";

const MODES: { mode: ApprovalMode; name: string; detail: string; icon: typeof Hand }[] = [
	{ mode: "ask", name: "Ask for approval", detail: "Ask before running commands or editing files", icon: Hand },
	{ mode: "autoEdit", name: "Auto-edit", detail: "Edit files freely, ask before running commands", icon: ShieldCheck },
	{ mode: "fullAccess", name: "Full access", detail: "Run commands and edit files without asking", icon: ShieldAlert },
];

const LEVEL_NAMES: Record<string, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Max",
};

/** Full access asks once per thread (section 9.4). */
const fullAccessConfirmed = new Set<string>();

function ApprovalPicker({
	mode,
	threadKey,
	onChange,
}: {
	mode: ApprovalMode;
	threadKey: string;
	onChange: (mode: ApprovalMode) => void;
}) {
	const { allowFullAccess } = useStore(selectPreferences);
	const [confirming, setConfirming] = useState(false);
	const current = MODES.find((m) => m.mode === mode) ?? MODES[0]!;
	const Icon = current.icon;
	return (
		<Popover
			trigger={() => (
				<button
					type="button"
					className={`flex h-8 items-center gap-1.5 rounded-full px-2.5 hover:bg-hover ${mode === "fullAccess" ? "text-danger" : "text-muted"}`}
				>
					<Icon size={15} /> {current.name}
				</button>
			)}
		>
			{(close) =>
				confirming ? (
					<div className="w-72 p-2.5">
						<div className="mb-3">KnightCode will run commands and edit files without asking.</div>
						<div className="flex justify-end gap-2">
							<button
								type="button"
								onClick={() => setConfirming(false)}
								className="rounded-lg px-3 py-1.5 hover:bg-hover"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => {
									fullAccessConfirmed.add(threadKey);
									setConfirming(false);
									close();
									onChange("fullAccess");
								}}
								className="rounded-lg bg-danger px-3 py-1.5 font-medium text-white"
							>
								Allow full access
							</button>
						</div>
					</div>
				) : (
					<div className="w-80">
						<div className="px-2.5 pt-1.5 pb-1 text-[12px] font-medium text-faint">How should KnightCode act?</div>
						{MODES.filter((m) => m.mode !== "fullAccess" || allowFullAccess || mode === "fullAccess").map(
							({ mode: m, name, detail, icon: ModeIcon }) => (
								<MenuItem
									key={m}
									checked={m === mode}
									danger={m === "fullAccess"}
									onClick={() => {
										if (m === "fullAccess" && mode !== "fullAccess" && !fullAccessConfirmed.has(threadKey)) {
											setConfirming(true);
											return;
										}
										close();
										onChange(m);
									}}
								>
									<div className="flex items-start gap-2.5">
										<ModeIcon size={15} className="mt-0.5 shrink-0" />
										<div>
											<div>{name}</div>
											<div className="text-[12px] text-muted">{detail}</div>
										</div>
									</div>
								</MenuItem>
							),
						)}
					</div>
				)
			}
		</Popover>
	);
}

function ModelPicker({
	model,
	thinking,
	onModel,
	onThinking,
}: {
	model: ModelInfo | undefined;
	thinking: ThinkingLevel | undefined;
	onModel: (model: ModelInfo) => void;
	onThinking: (level: ThinkingLevel) => void;
}) {
	const models = useStore((s) => s.models);
	const [query, setQuery] = useState("");
	const groups = useMemo(() => {
		const q = query.toLowerCase();
		const map = new Map<string, ModelInfo[]>();
		for (const m of models) {
			if (q && !`${m.name} ${m.id} ${m.providerName}`.toLowerCase().includes(q)) continue;
			map.set(m.providerName, [...(map.get(m.providerName) ?? []), m]);
		}
		return [...map];
	}, [models, query]);
	const levels = model?.thinkingLevels ?? [];
	return (
		<Popover
			align="right"
			trigger={() => (
				<button type="button" className="flex h-8 items-center gap-1.5 rounded-full px-2.5 hover:bg-hover">
					<span className="text-ink">{model ? model.name : "Choose a model"}</span>
					{model && thinking && levels.length > 1 ? (
						<span className="text-muted">{LEVEL_NAMES[thinking] ?? thinking}</span>
					) : null}
					<ChevronDown size={13} className="text-muted" />
				</button>
			)}
		>
			{(close) => (
				<div className="w-80">
					{levels.length > 1 ? (
						<div className="border-b border-line px-2.5 pt-2 pb-2.5">
							<div className="mb-1.5 flex justify-between text-[12px]">
								<span className="font-medium text-faint">Thinking</span>
								<span className="text-muted">{thinking ? (LEVEL_NAMES[thinking] ?? thinking) : "Default"}</span>
							</div>
							<div className="flex gap-1">
								{levels.map((level) => (
									<button
										key={level}
										type="button"
										title={LEVEL_NAMES[level] ?? level}
										onClick={() => onThinking(level)}
										className={`h-1.5 flex-1 rounded-full ${thinking && levels.indexOf(level) <= levels.indexOf(thinking) ? "bg-accent" : "bg-hover hover:bg-line-strong"}`}
									/>
								))}
							</div>
						</div>
					) : null}
					<input
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search models"
						className="mx-1 my-1.5 w-[calc(100%-0.5rem)] rounded-lg border border-line bg-surface px-2.5 py-1.5 outline-none focus:border-line-strong"
					/>
					<div className="max-h-72 overflow-y-auto">
						{groups.length === 0 ? (
							<div className="px-2.5 py-2 text-muted">No models. Sign in to a provider in Settings.</div>
						) : null}
						{groups.map(([provider, list]) => (
							<div key={provider}>
								<div className="px-2.5 pt-2 pb-1 text-[12px] font-medium text-faint">{provider}</div>
								{list.map((m) => (
									<MenuItem
										key={`${m.provider}/${m.id}`}
										checked={model?.provider === m.provider && model.id === m.id}
										onClick={() => {
											close();
											onModel(m);
										}}
									>
										<div className="flex items-baseline justify-between gap-2">
											<span>{m.name}</span>
											<span className="text-[12px] text-faint">{tokens(m.contextWindow)}</span>
										</div>
									</MenuItem>
								))}
							</div>
						))}
					</div>
				</div>
			)}
		</Popover>
	);
}

function ProjectPicker({ cwd, onChange }: { cwd: string | undefined; onChange: (cwd: string) => void }) {
	const projects = useStore(selectProjects);
	return (
		<Popover
			trigger={() => (
				<button
					type="button"
					className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-muted hover:bg-hover hover:text-ink"
				>
					<FolderOpen size={15} /> {cwd ? basename(cwd) : "Choose a project"} <ChevronDown size={13} />
				</button>
			)}
		>
			{(close) => (
				<div className="w-72">
					{projects.map((p) => (
						<MenuItem
							key={p.path}
							checked={p.path === cwd}
							onClick={() => {
								close();
								onChange(p.path);
							}}
						>
							<div>{p.name ?? basename(p.path)}</div>
							<div className="truncate text-[12px] text-faint">{p.path}</div>
						</MenuItem>
					))}
					<MenuItem
						onClick={() => {
							close();
							void addProject().then((path) => path && onChange(path));
						}}
					>
						<span className="flex items-center gap-2 text-muted">
							<FolderPlus size={14} /> Add a folder…
						</span>
					</MenuItem>
				</div>
			)}
		</Popover>
	);
}

interface Suggestion {
	key: string;
	label: string;
	detail?: string;
	insert: string;
	icon: "file" | "command";
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

export function Composer({ threadId, newCwd }: { threadId?: string; newCwd?: string }) {
	const view = useStore((s) => (threadId ? s.held[threadId] : undefined));
	const models = useStore((s) => s.models);
	const defaultModel = useStore((s) => s.defaultModel);
	const projects = useStore(selectProjects);
	const prefs = useStore(selectPreferences);
	const [text, setText] = useState("");
	const [images, setImages] = useState<string[]>([]);
	const [cwd, setCwd] = useState<string | undefined>(newCwd ?? projects[0]?.path);
	const [draftModel, setDraftModel] = useState<{ provider: string; id: string } | undefined>();
	const [draftThinking, setDraftThinking] = useState<ThinkingLevel | undefined>();
	const [draftMode, setDraftMode] = useState<ApprovalMode>("ask");
	const [suggestions, setSuggestions] = useState<
		{ items: Suggestion[]; truncated: boolean; start: number } | undefined
	>();
	const [selected, setSelected] = useState(0);
	const ref = useRef<HTMLTextAreaElement>(null);
	const searchId = useMemo(() => `composer-${crypto.randomUUID()}`, []);
	const commands = useRef<{ name: string; description: string }[] | undefined>(undefined);

	useEffect(() => {
		if (newCwd) setCwd(newCwd);
	}, [newCwd]);
	useEffect(() => {
		if (!cwd && projects[0]) setCwd(projects[0].path);
	}, [cwd, projects]);
	useEffect(() => {
		ref.current?.focus();
		commands.current = undefined;
	}, [threadId]);
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
	const thinking = thread?.thinkingLevel ?? draftThinking;
	const mode = thread?.approvalMode ?? draftMode;
	const hasContent = text.trim().length > 0 || images.length > 0;
	const canSend = hasContent && (threadId ? true : Boolean(cwd && model));

	const refreshSuggestions = async (value: string, caret: number) => {
		const token = tokenAt(value, caret);
		if (!token) return setSuggestions(undefined);
		if (token.kind === "/") {
			if (!threadId) return setSuggestions(undefined);
			commands.current ??= await listCommands(threadId);
			const q = token.query.toLowerCase();
			const items = commands.current
				.filter((c) => c.name.toLowerCase().includes(q))
				.slice(0, 30)
				.map((c): Suggestion => ({
					key: c.name,
					label: `/${c.name}`,
					detail: c.description,
					insert: `/${c.name} `,
					icon: "command",
				}));
			setSelected(0);
			return setSuggestions(items.length ? { items, truncated: false, start: token.start } : undefined);
		}
		if (!workdir || token.query.length === 0) return setSuggestions(undefined);
		try {
			const result = await searchFiles(workdir, token.query, searchId);
			const items = result.files.map((f): Suggestion => ({
				key: f.path,
				label: basename(f.path),
				detail: f.path,
				insert: `@${f.path} `,
				icon: "file",
			}));
			setSelected(0);
			setSuggestions(items.length ? { items, truncated: result.truncated, start: token.start } : undefined);
		} catch {
			// A superseded search rejects; the newer one answers.
		}
	};

	const accept = (suggestion: Suggestion) => {
		const el = ref.current;
		const caret = el?.selectionStart ?? text.length;
		const start = suggestions?.start ?? caret;
		const next = text.slice(0, start) + suggestion.insert + text.slice(caret);
		setText(next);
		setSuggestions(undefined);
		requestAnimationFrame(() => {
			const pos = start + suggestion.insert.length;
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
				},
				attached,
			);
			return;
		}
		setText("");
		setImages([]);
		const steering = running && (prefs.whileRunning === "steer") !== alternate;
		void (steering ? steer(threadId, value) : send(threadId, value, attached));
	};

	useBinding(
		"desktop.turn.interrupt",
		() => threadId && void interrupt(threadId),
		running && text.length === 0 && !view?.approvals.length && !suggestions,
	);

	const attachFiles = async () => {
		const { paths } = await client.host("host/dialog/openFiles", { images: true });
		if (paths.length) setImages((list) => [...list, ...paths]);
	};

	const queued = view
		? [
				...view.queue.steering.map((t) => ({ id: undefined, text: t, steer: true })),
				...view.queue.followUp.map((e) => ({ ...e, steer: false })),
			]
		: [];
	const modKey = window.knightcode.platform === "darwin" ? "⌘" : "Ctrl";

	return (
		<div className="mx-auto w-full max-w-3xl px-4 pb-4">
			{!threadId ? (
				<div className="mb-1.5 flex items-center gap-1">
					<ProjectPicker cwd={cwd} onChange={setCwd} />
				</div>
			) : null}
			<div className="relative">
				{suggestions ? (
					<div className="absolute right-0 bottom-full left-0 z-20 mb-2 max-h-72 overflow-y-auto rounded-2xl border border-line-strong bg-elevated p-1 shadow-2xl">
						{suggestions.items.map((s, i) => (
							<button
								key={s.key}
								type="button"
								onMouseDown={(e) => {
									e.preventDefault();
									accept(s);
								}}
								onMouseEnter={() => setSelected(i)}
								className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left ${i === selected ? "bg-hover" : ""}`}
							>
								{s.icon === "file" ? (
									<FileText size={15} className="shrink-0 text-muted" />
								) : (
									<Slash size={15} className="shrink-0 text-muted" />
								)}
								<span className="shrink-0">{s.label}</span>
								{s.detail ? <span className="min-w-0 truncate text-[12px] text-faint">{s.detail}</span> : null}
							</button>
						))}
						{suggestions.truncated ? (
							<div className="px-2.5 py-1 text-[12px] text-faint">Some files may be missing</div>
						) : null}
					</div>
				) : null}
				<div className="rounded-[26px] bg-composer shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
					{queued.length > 0 ? (
						<div className="space-y-1 border-b border-line px-4 py-2.5">
							{queued.map((q, i) => (
								<div key={q.id ?? `s${i}`} className="flex items-center gap-2 text-muted">
									<span className="text-[12px] text-faint">{q.steer ? "Steering" : "Queued"}</span>
									<span className="min-w-0 flex-1 truncate">{q.text}</span>
									{q.id ? (
										<button
											type="button"
											title="Remove"
											onClick={() => threadId && void removeQueued(threadId, q.id!)}
											className="rounded p-0.5 hover:bg-hover hover:text-ink"
										>
											<X size={13} />
										</button>
									) : null}
								</div>
							))}
						</div>
					) : null}
					{images.length > 0 ? (
						<div className="flex flex-wrap gap-2 px-4 pt-3">
							{images.map((path) => (
								<span key={path} className="flex items-center gap-1.5 rounded-lg bg-hover px-2 py-1 text-[12px]">
									<ImagePlus size={13} className="text-muted" />
									<span className="max-w-48 truncate">{basename(path)}</span>
									<button
										type="button"
										title="Remove"
										onClick={() => setImages((list) => list.filter((p) => p !== path))}
										className="text-faint hover:text-ink"
									>
										<X size={12} />
									</button>
								</span>
							))}
						</div>
					) : null}
					<textarea
						ref={ref}
						value={text}
						rows={1}
						onChange={(e) => {
							setText(e.target.value);
							void refreshSuggestions(e.target.value, e.target.selectionStart);
						}}
						onPaste={(event) => {
							if (![...event.clipboardData.items].some((item) => item.type.startsWith("image/"))) return;
							event.preventDefault();
							void client.host("host/clipboard/readImage", {}).then(({ path }) => {
								if (path) setImages((list) => [...list, path]);
							});
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
								? prefs.whileRunning === "queue"
									? `Queue a follow-up · ${modKey}+Enter to steer`
									: `Steer the turn · ${modKey}+Enter to queue`
								: threadId
									? "Ask for a follow-up"
									: "Ask KnightCode anything. @ for files"
						}
						className="selectable block max-h-[300px] w-full resize-none bg-transparent px-5 pt-4 pb-2 text-[15px] leading-relaxed outline-none placeholder:text-faint focus-visible:outline-none"
					/>
					<div className="flex items-center gap-0.5 px-2.5 pb-2.5">
						<Popover
							trigger={() => (
								<button
									type="button"
									title="Add"
									className="flex size-8 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-ink"
								>
									<Plus size={18} />
								</button>
							)}
						>
							{(close) => (
								<div className="w-56">
									<MenuItem
										onClick={() => {
											close();
											void attachFiles();
										}}
									>
										<span className="flex items-center gap-2">
											<ImagePlus size={15} /> Add images
										</span>
									</MenuItem>
								</div>
							)}
						</Popover>
						<ApprovalPicker
							mode={mode}
							threadKey={threadId ?? "new"}
							onChange={(m) => (threadId ? void updateSettings(threadId, { approvalMode: m }) : setDraftMode(m))}
						/>
						<div className="flex-1" />
						{view?.usage?.contextTokens && view.usage.contextWindow ? (
							<span
								className="mr-1 text-[12px] text-faint"
								title={`${tokens(view.usage.contextTokens)} of ${tokens(view.usage.contextWindow)} tokens · $${view.usage.cost.toFixed(2)} this thread`}
							>
								{Math.round((view.usage.contextTokens / view.usage.contextWindow) * 100)}% used
							</span>
						) : null}
						<ModelPicker
							model={model}
							thinking={thinking}
							onModel={(m) =>
								threadId
									? void updateSettings(threadId, { model: { provider: m.provider, id: m.id } })
									: setDraftModel({ provider: m.provider, id: m.id })
							}
							onThinking={(level) =>
								threadId ? void updateSettings(threadId, { thinkingLevel: level }) : setDraftThinking(level)
							}
						/>
						{running && !hasContent ? (
							<button
								type="button"
								title="Stop"
								onClick={() => threadId && void interrupt(threadId)}
								className="ml-1 flex size-8 items-center justify-center rounded-full bg-ink text-surface hover:opacity-90"
							>
								<Square size={11} fill="currentColor" />
							</button>
						) : (
							<button
								type="button"
								title={running ? (prefs.whileRunning === "queue" ? "Queue" : "Steer") : "Send"}
								disabled={!canSend}
								onClick={() => submit(false)}
								className="ml-1 flex size-8 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover disabled:bg-hover disabled:text-faint"
							>
								{running ? <Check size={15} strokeWidth={2.5} /> : <ArrowUp size={17} strokeWidth={2.5} />}
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
