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
	ChevronLeft,
	ChevronRight,
	CircleAlert,
	FileText,
	Folder,
	FolderOpen,
	FolderPlus,
	Hand,
	ImagePlus,
	Lightbulb,
	Plus,
	Search,
	ShieldCheck,
	Sparkles,
	Square,
	SquareSlash,
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
import { MenuCaption, MenuItem, Popover } from "./popover.tsx";

const MODES: { mode: ApprovalMode; name: string; detail: string; icon: typeof Hand }[] = [
	{ mode: "ask", name: "Ask for approval", detail: "Ask before running commands or editing files", icon: Hand },
	{ mode: "autoEdit", name: "Auto-edit", detail: "Edit files freely, ask before running commands", icon: ShieldCheck },
	{ mode: "fullAccess", name: "Full access", detail: "Run commands and edit files without asking", icon: CircleAlert },
];

const LEVEL_NAMES: Record<string, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
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
			trigger={(open) => (
				<button
					type="button"
					className={`flex h-7 items-center gap-1.5 rounded-full px-2 text-[13px] hover:bg-row ${open ? "bg-row" : ""} ${mode === "fullAccess" ? "text-caution" : "text-muted hover:text-ink"}`}
				>
					<Icon size={16} /> {current.name}
				</button>
			)}
		>
			{(close) =>
				confirming ? (
					<div className="w-[300px] p-2">
						<div className="text-[13px] font-medium text-ink">Allow full access?</div>
						<div className="mt-1 text-[12px] leading-4 text-desc">
							KnightCode will run commands and edit files in this thread without asking.
						</div>
						<div className="mt-3 flex justify-end gap-1.5">
							<button
								type="button"
								onClick={() => setConfirming(false)}
								className="h-7 rounded-full border border-hairline px-3 text-[13px] text-ink hover:bg-row"
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
								className="h-7 rounded-full bg-caution px-3 text-[13px] font-medium text-on-accent hover:opacity-90"
							>
								Allow full access
							</button>
						</div>
					</div>
				) : (
					<div className="w-[390px]">
						<MenuCaption>How should KnightCode act?</MenuCaption>
						{MODES.filter((m) => m.mode !== "fullAccess" || allowFullAccess || mode === "fullAccess").map(
							({ mode: m, name, detail, icon: ModeIcon }) => (
								<MenuItem
									key={m}
									icon={<ModeIcon size={16} />}
									description={detail}
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
									{name}
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
	const levels = model?.thinkingLevels ?? [];
	const effort = model && thinking && levels.length > 1 ? (LEVEL_NAMES[thinking] ?? thinking) : undefined;
	return (
		<Popover
			align="right"
			trigger={(open) => (
				<button
					type="button"
					className={`flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] hover:bg-row ${open ? "bg-row" : ""}`}
				>
					<span className="font-medium text-ink">{model ? model.name : "Choose a model"}</span>
					{effort ? <span className="font-medium text-desc">{effort}</span> : null}
					<ChevronDown size={14} className="text-desc" />
				</button>
			)}
		>
			{(close) => (
				<ModelMenu
					model={model}
					thinking={thinking}
					onModel={(m) => {
						close();
						onModel(m);
					}}
					onThinking={onThinking}
				/>
			)}
		</Popover>
	);
}

/**
 * Codex's model picker: the effort slider first, the model list one step away behind the header. Lives inside
 * the popover, so it starts on the slider each time the menu opens.
 */
function ModelMenu({
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
	const levels = model?.thinkingLevels ?? [];
	const [view, setView] = useState<"effort" | "list">(model && levels.length > 1 ? "effort" : "list");
	if (view === "effort" && model) {
		const level = thinking && levels.includes(thinking) ? thinking : levels[0]!;
		return (
			<div className="w-[254px]">
				<button type="button" onClick={() => setView("list")} className="kc-row justify-center text-[14px] font-medium">
					<span className="truncate text-ink">{model.name}</span>
					<span className="-ml-1 text-desc">{LEVEL_NAMES[level] ?? level}</span>
					<ChevronRight size={12} className="-ml-1 text-desc" />
				</button>
				<EffortSlider levels={levels} value={level} onChange={onThinking} />
			</div>
		);
	}
	return <ModelList model={model} onModel={onModel} onBack={model && levels.length > 1 ? () => setView("effort") : undefined} />;
}

/** Reasoning effort as Codex draws it: a pill track, a dot per level, a white knob over a native range input. */
function EffortSlider({
	levels,
	value,
	onChange,
}: {
	levels: readonly ThinkingLevel[];
	value: ThinkingLevel;
	onChange: (level: ThinkingLevel) => void;
}) {
	const index = Math.max(0, levels.indexOf(value));
	const last = levels.length - 1;
	// Positions run between the knob's centre at either end, 14px in from each side.
	const at = (i: number) => `calc(14px + (100% - 28px) * ${i / last})`;
	return (
		<div className="relative mx-2 mt-1 mb-2 h-6">
			<div className="absolute inset-0 rounded-full bg-track" />
			<div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `calc(${at(index)} + 14px)` }} />
			{levels.map((level, i) => (
				<span
					key={level}
					className={`absolute top-[10px] size-1 -translate-x-1/2 rounded-full ${i <= index ? "bg-white/30" : "bg-desc"}`}
					style={{ left: at(i) }}
				/>
			))}
			<span
				className="pointer-events-none absolute top-[-2px] size-7 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgb(0_0_0/0.3)] transition-[left] duration-150"
				style={{ left: at(index) }}
			/>
			<input
				type="range"
				min={0}
				max={last}
				step={1}
				value={index}
				aria-label="Reasoning effort"
				aria-valuetext={LEVEL_NAMES[value] ?? value}
				onChange={(e) => onChange(levels[Number(e.target.value)]!)}
				className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
			/>
		</div>
	);
}

function ModelList({
	model,
	onModel,
	onBack,
}: {
	model: ModelInfo | undefined;
	onModel: (model: ModelInfo) => void;
	onBack: (() => void) | undefined;
}) {
	const models = useStore((s) => s.models);
	const [query, setQuery] = useState("");
	const list = useRef<HTMLDivElement>(null);
	useEffect(() => {
		list.current?.querySelector("[data-checked]")?.scrollIntoView({ block: "center" });
	}, []);
	const groups = useMemo(() => {
		const q = query.toLowerCase();
		const map = new Map<string, ModelInfo[]>();
		for (const m of models) {
			if (q && !`${m.name} ${m.id} ${m.providerName}`.toLowerCase().includes(q)) continue;
			map.set(m.providerName, [...(map.get(m.providerName) ?? []), m]);
		}
		return [...map];
	}, [models, query]);
	return (
		<div className="flex max-h-[min(420px,70vh)] w-[280px] flex-col">
			<div className="flex items-center gap-1 px-2 pt-1 pb-1">
				{onBack ? (
					<button type="button" title="Back" onClick={onBack} className="-ml-1 rounded-full p-0.5 text-desc hover:text-ink">
						<ChevronLeft size={14} />
					</button>
				) : null}
				<span className="text-[13px] text-desc">Select model</span>
			</div>
			<label className="mx-1 mb-1 flex items-center gap-2 rounded-[15px] bg-row px-2 py-[5px] text-[13px]">
				<Search size={14} className="shrink-0 text-desc" />
				<input
					autoFocus
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search models"
					className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-desc focus-visible:outline-none"
				/>
			</label>
			<div ref={list} className="min-h-0 overflow-y-auto">
				{groups.length === 0 ? (
					<div className="px-2 py-1.5 text-[13px] text-desc">
						{models.length ? "No matching models" : "No models. Sign in to a provider in Settings."}
					</div>
				) : null}
				{groups.map(([provider, list]) => (
					<div key={provider}>
						<div className="px-2 pt-2 pb-1 text-[12px] text-desc">{provider}</div>
						{list.map((m) => (
							<MenuItem
								key={`${m.provider}/${m.id}`}
								checked={model?.provider === m.provider && model.id === m.id}
								onClick={() => onModel(m)}
							>
								<span title={`${tokens(m.contextWindow)} context`}>{m.name}</span>
							</MenuItem>
						))}
					</div>
				))}
			</div>
		</div>
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

/** The `@` or `/` token the caret is in, if any. */
/** An attached image as a thumbnail; the file name shows on hover. */
function ImageChip({ path, onRemove }: { path: string; onRemove: () => void }) {
	const [src, setSrc] = useState<string>();
	useEffect(() => {
		void client.host("host/image/thumbnail", { path }).then(({ dataUrl }) => setSrc(dataUrl));
	}, [path]);
	return (
		<span title={basename(path)} className="group relative size-14 overflow-hidden rounded-lg border border-line bg-hover">
			{src ? (
				<img src={src} alt={basename(path)} className="size-full object-cover" />
			) : (
				<ImagePlus size={16} className="m-auto mt-[19px] text-muted" />
			)}
			<button
				type="button"
				title="Remove image"
				onClick={onRemove}
				className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
			>
				<X size={11} />
			</button>
		</span>
	);
}

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
		// A new thread's commands come from its project.
		commands.current = undefined;
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
	const thinking = thread?.thinkingLevel ?? draftThinking;
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
	const modKey = window.knightcode.platform === "darwin" ? "⌘" : "Ctrl";

	return (
		<div className="mx-auto w-full max-w-3xl px-4 pb-4">
			{!threadId ? (
				<div className="mb-1.5 flex items-center gap-1">
					<ProjectPicker cwd={cwd} onChange={setCwd} />
				</div>
			) : null}
			<div ref={boxRef} className="relative">
				{suggestions ? (
					<div className="absolute inset-x-0 bottom-full z-20 mb-1 flex max-h-80 flex-col overflow-hidden rounded-[20px] bg-panel p-1 shadow-[0_0_0_1px_var(--kc-hairline),var(--kc-menu-shadow)]">
						<div ref={panelRef} className="min-h-0 overflow-y-auto">
							{suggestions.items.map((s, i) => {
								const Icon = SUGGESTION_ICONS[s.icon];
								return (
									<div key={s.key}>
										{s.section && s.section !== suggestions.items[i - 1]?.section ? (
											<div className="px-2 pt-1 pb-1 text-[13px] text-desc">{s.section}</div>
										) : null}
										<button
											type="button"
											data-active={i === selected}
											onMouseDown={(e) => {
												e.preventDefault();
												accept(s);
											}}
											onMouseEnter={() => setSelected(i)}
											className="kc-row text-ink"
										>
											<Icon size={16} className="shrink-0" />
											<span className="shrink-0">{s.label}</span>
											{s.detail ? <span className="min-w-0 truncate text-desc">{s.detail}</span> : null}
										</button>
									</div>
								);
							})}
							{suggestions.truncated ? (
								<div className="px-2 py-1 text-[12px] text-desc">Some files may be missing</div>
							) : null}
						</div>
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
								<ImageChip
									key={path}
									path={path}
									onRemove={() => setImages((list) => list.filter((p) => p !== path))}
								/>
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
						<button
							type="button"
							title="Add"
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => void toggleAddMenu()}
							className={`flex size-7 items-center justify-center rounded-full text-muted hover:bg-row hover:text-ink ${suggestions?.items[0]?.section === "Add" ? "bg-row text-ink" : ""}`}
						>
							<Plus size={18} />
						</button>
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
