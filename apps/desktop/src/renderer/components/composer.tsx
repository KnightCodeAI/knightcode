/**
 * The composer (desktop-shell.md section 9.4): text, the approval mode and model pickers, Send that
 * becomes Queue while a turn runs, Mod+Enter to steer, Escape on an empty input to stop.
 */

import type { ApprovalMode, ThinkingLevel } from "@knightcode/app-server-protocol";
import {
	ArrowUp,
	ChevronDown,
	FolderOpen,
	FolderPlus,
	Hand,
	ShieldAlert,
	ShieldCheck,
	Square,
	X,
	Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { basename, tokens } from "../format.ts";
import { matches, useBinding } from "../keys.ts";
import {
	addProject,
	interrupt,
	type ModelInfo,
	removeQueued,
	send,
	startThread,
	steer,
	updateSettings,
	useStore,
	selectProjects,
} from "../store.ts";
import { MenuItem, Popover } from "./popover.tsx";

const MODES: { mode: ApprovalMode; name: string; detail: string; icon: typeof Hand }[] = [
	{ mode: "ask", name: "Ask", detail: "Ask before running commands or editing files", icon: Hand },
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

function ApprovalPicker({ mode, onChange }: { mode: ApprovalMode; onChange: (mode: ApprovalMode) => void }) {
	const current = MODES.find((m) => m.mode === mode) ?? MODES[0]!;
	const Icon = current.icon;
	return (
		<Popover
			trigger={() => (
				<button
					type="button"
					className={`flex items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-hover ${mode === "fullAccess" ? "text-danger" : "text-muted"}`}
				>
					<Icon size={14} /> {current.name} <ChevronDown size={12} />
				</button>
			)}
		>
			{(close) => (
				<div className="w-72">
					<div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium text-faint">How should KnightCode act?</div>
					{MODES.map(({ mode: m, name, detail, icon: ModeIcon }) => (
						<MenuItem
							key={m}
							checked={m === mode}
							danger={m === "fullAccess"}
							onClick={() => {
								close();
								onChange(m);
							}}
						>
							<div className="flex items-start gap-2">
								<ModeIcon size={14} className="mt-0.5 shrink-0" />
								<div>
									<div className="font-medium">{name}</div>
									<div className="text-[12px] text-muted">{detail}</div>
								</div>
							</div>
						</MenuItem>
					))}
				</div>
			)}
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
				<button type="button" className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-muted hover:bg-hover">
					<Zap size={14} />
					{model ? model.name : "Choose a model"}
					{model && thinking && levels.length > 1 ? (
						<span className="text-faint">· {LEVEL_NAMES[thinking] ?? thinking}</span>
					) : null}
					<ChevronDown size={12} />
				</button>
			)}
		>
			{(close) => (
				<div className="w-80">
					{levels.length > 1 ? (
						<div className="border-b border-line px-2.5 pt-2 pb-2.5">
							<div className="mb-1.5 text-[11px] font-medium text-faint">Thinking</div>
							<div className="flex gap-1">
								{levels.map((level) => (
									<button
										key={level}
										type="button"
										onClick={() => onThinking(level)}
										className={`flex-1 rounded-md px-1 py-1 text-[12px] ${level === thinking ? "bg-selected text-ink" : "text-muted hover:bg-hover"}`}
									>
										{LEVEL_NAMES[level] ?? level}
									</button>
								))}
							</div>
						</div>
					) : null}
					<input
						autoFocus
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search models"
						className="mx-1 my-1.5 w-[calc(100%-0.5rem)] rounded-md border border-line bg-shell px-2.5 py-1.5 outline-none focus:border-accent"
					/>
					<div className="max-h-72 overflow-y-auto">
						{groups.length === 0 ? (
							<div className="px-2.5 py-2 text-muted">No models. Sign in to a provider in the terminal first.</div>
						) : null}
						{groups.map(([provider, list]) => (
							<div key={provider}>
								<div className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-faint">{provider}</div>
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
											<span className="text-[11px] text-faint">{tokens(m.contextWindow)}</span>
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
			side="top"
			trigger={() => (
				<button type="button" className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-muted hover:bg-hover">
					<FolderOpen size={14} /> {cwd ? basename(cwd) : "Choose a project"} <ChevronDown size={12} />
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
							<div className="font-medium">{p.name ?? basename(p.path)}</div>
							<div className="truncate text-[11px] text-faint">{p.path}</div>
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

export function Composer({ threadId, newCwd }: { threadId?: string; newCwd?: string }) {
	const view = useStore((s) => (threadId ? s.held[threadId] : undefined));
	const models = useStore((s) => s.models);
	const defaultModel = useStore((s) => s.defaultModel);
	const projects = useStore(selectProjects);
	const [text, setText] = useState("");
	const [cwd, setCwd] = useState<string | undefined>(newCwd ?? projects[0]?.path);
	const [draftModel, setDraftModel] = useState<{ provider: string; id: string } | undefined>();
	const [draftThinking, setDraftThinking] = useState<ThinkingLevel | undefined>();
	const [draftMode, setDraftMode] = useState<ApprovalMode>("ask");
	const ref = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (newCwd) setCwd(newCwd);
	}, [newCwd]);
	useEffect(() => {
		if (!cwd && projects[0]) setCwd(projects[0].path);
	}, [cwd, projects]);
	useEffect(() => ref.current?.focus(), [threadId]);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 280)}px`;
	}, [text]);

	const thread = view?.thread;
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
	const canSend = text.trim().length > 0 && (threadId ? true : Boolean(cwd && model));

	const submit = (asSteer: boolean) => {
		const value = text.trim();
		if (!value) return;
		if (!threadId) {
			if (!cwd || !model) return;
			setText("");
			void startThread(cwd, value, {
				model: { provider: model.provider, id: model.id },
				...(draftThinking ? { thinkingLevel: draftThinking } : {}),
				approvalMode: mode,
			});
			return;
		}
		setText("");
		void (asSteer ? steer(threadId, value) : send(threadId, value));
	};

	useBinding(
		"desktop.turn.interrupt",
		() => threadId && void interrupt(threadId),
		running && text.length === 0 && !view?.approvals.length,
	);

	const queued = view
		? [
				...view.queue.steering.map((t) => ({ id: undefined, text: t, steer: true })),
				...view.queue.followUp.map((e) => ({ ...e, steer: false })),
			]
		: [];

	return (
		<div className="mx-auto w-full max-w-3xl px-4 pb-4">
			{!threadId ? (
				<div className="mb-1.5 flex items-center gap-1">
					<ProjectPicker cwd={cwd} onChange={setCwd} />
				</div>
			) : null}
			<div className="rounded-2xl border border-line-strong bg-elevated shadow-lg focus-within:border-accent/60">
				{queued.length > 0 ? (
					<div className="space-y-1 border-b border-line px-3 py-2">
						{queued.map((q, i) => (
							<div key={q.id ?? `s${i}`} className="flex items-center gap-2 text-muted">
								<span className="text-[11px] text-faint">{q.steer ? "Steering" : "Queued"}</span>
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
				<textarea
					ref={ref}
					value={text}
					rows={1}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing) return;
						if (matches(event, "desktop.composer.steer")) {
							event.preventDefault();
							submit(true);
						} else if (matches(event, "desktop.composer.send")) {
							event.preventDefault();
							submit(false);
						}
					}}
					placeholder={
						running
							? "Queue a follow-up, or Ctrl+Enter to steer"
							: threadId
								? "Ask for a follow-up"
								: "Ask KnightCode to do anything"
					}
					className="selectable block max-h-72 w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[14px] leading-relaxed outline-none focus-visible:outline-none placeholder:text-faint"
				/>
				<div className="flex items-center gap-1 px-2 pb-2">
					<ApprovalPicker
						mode={mode}
						onChange={(m) => (threadId ? void updateSettings(threadId, { approvalMode: m }) : setDraftMode(m))}
					/>
					<div className="flex-1" />
					{view?.usage?.contextTokens && view.usage.contextWindow ? (
						<span
							className="mr-1 text-[11px] text-faint"
							title={`${tokens(view.usage.contextTokens)} of ${tokens(view.usage.contextWindow)} tokens · $${view.usage.cost.toFixed(2)} this thread`}
						>
							{Math.round((view.usage.contextTokens / view.usage.contextWindow) * 100)}%
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
					{running && text.length === 0 ? (
						<button
							type="button"
							title="Stop"
							onClick={() => threadId && void interrupt(threadId)}
							className="ml-1 flex size-8 items-center justify-center rounded-full bg-ink text-surface hover:opacity-90"
						>
							<Square size={12} fill="currentColor" />
						</button>
					) : (
						<button
							type="button"
							title={running ? "Queue" : "Send"}
							disabled={!canSend}
							onClick={() => submit(false)}
							className="ml-1 flex size-8 items-center justify-center rounded-full bg-accent text-on-accent hover:bg-accent-hover disabled:bg-hover disabled:text-faint"
						>
							<ArrowUp size={16} strokeWidth={2.5} />
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
