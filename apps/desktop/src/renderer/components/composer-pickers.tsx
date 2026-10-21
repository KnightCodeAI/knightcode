/**
 * The composer's pickers, after Codex's (measured 2026-10-15 to 2026-10-19):
 *
 * - ApprovalPicker: "Change permissions", a 390px menu headed "How should KnightCode actions be approved?", each mode
 *   with an 18px icon, a description and a check; Full access in the caution colour and confirmed once per thread.
 * - ModelPicker: the model and its reasoning effort; the effort slider first, the model list one step away.
 * - ProjectPicker: a 260px panel with a search field, the projects with a check on the current one, and adding one.
 */

import type { ApprovalMode, ThinkingLevel } from "@knightcode/app-server-protocol";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { basename, tokens } from "../format.ts";
import { matches } from "../keys.ts";
import { addProject, type ModelInfo, selectPreferences, selectProjects, useStore } from "../store.ts";
import { Button, IconButton } from "./button.tsx";
import {
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Folder,
	FolderPlus,
	Hand,
	Search,
	ShieldAlert,
	ShieldTerminal,
} from "./icons.tsx";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./menu.tsx";
import { ListRow, ListSeparator, Popover } from "./popover.tsx";
import { Tooltip } from "./tooltip.tsx";

export const MODES: { mode: ApprovalMode; name: string; detail: string; icon: typeof Hand }[] = [
	{ mode: "ask", name: "Ask for approval", detail: "Ask before running commands or editing files", icon: Hand },
	{
		mode: "autoEdit",
		name: "Auto-edit",
		detail: "Edit files freely, ask before running commands",
		icon: ShieldTerminal,
	},
	{ mode: "fullAccess", name: "Full access", detail: "Run commands and edit files without asking", icon: ShieldAlert },
];

/** Reasoning levels as Codex names them. */
const LEVEL_NAMES: Record<string, string> = {
	off: "None",
	minimal: "Minimal",
	low: "Light",
	medium: "Medium",
	high: "High",
	xhigh: "Extra High",
	max: "Max",
};
export const levelName = (level: string) => LEVEL_NAMES[level] ?? level;

/** Full access asks once per thread (section 9.4). */
const fullAccessConfirmed = new Set<string>();

export function ApprovalPicker({
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
		<Menu onOpenChange={(open) => open || setConfirming(false)}>
			<MenuTrigger>
				<Button
					variant="ghost"
					color="secondary"
					pill
					aria-label="Change permissions"
					className={`px-1.5 text-sm ${mode === "fullAccess" ? "!text-caution" : ""}`}
				>
					<Icon size={16} />
					<span className="@max-[520px]:hidden">{current.name}</span>
				</Button>
			</MenuTrigger>
			<MenuContent side="top" minWidth={390} className="max-w-[390px]">
				{confirming ? (
					<>
						<MenuLabel>Allow full access?</MenuLabel>
						<p className="px-2 pb-2 text-xs leading-4 text-tertiary">
							KnightCode will run commands and edit files in this thread without asking.
						</p>
						<MenuItem
							danger
							icon={<ShieldAlert size={18} />}
							onSelect={() => {
								fullAccessConfirmed.add(threadKey);
								onChange("fullAccess");
							}}
						>
							Allow full access
						</MenuItem>
						<MenuItem
							onSelect={(event) => {
								event.preventDefault();
								setConfirming(false);
							}}
						>
							Cancel
						</MenuItem>
					</>
				) : (
					<>
						<MenuLabel>How should KnightCode actions be approved?</MenuLabel>
						<MenuRadioGroup
							value={mode}
							onValueChange={(m) => {
								// Radix changes the value even when onSelect prevents default: unconfirmed full access waits here.
								if (m === "fullAccess" && mode !== "fullAccess" && !fullAccessConfirmed.has(threadKey)) return;
								onChange(m as ApprovalMode);
							}}
						>
							{MODES.filter((m) => m.mode !== "fullAccess" || allowFullAccess || mode === "fullAccess").map(
								({ mode: m, name, detail, icon: ModeIcon }) => (
									<MenuRadioItem
										key={m}
										value={m}
										icon={<ModeIcon size={18} />}
										description={detail}
										danger={m === "fullAccess"}
										onSelect={(event) => {
											// Full access asks first, once per thread; the menu stays open to ask.
											if (m === "fullAccess" && mode !== "fullAccess" && !fullAccessConfirmed.has(threadKey)) {
												event.preventDefault();
												setConfirming(true);
											}
										}}
									>
										{name}
									</MenuRadioItem>
								),
							)}
						</MenuRadioGroup>
					</>
				)}
			</MenuContent>
		</Menu>
	);
}

export function ModelPicker({
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
	const effort = model && thinking && levels.length > 1 ? levelName(thinking) : undefined;
	return (
		// Centred on the trigger 8px above it, as Codex's (its alignOffset is half the width difference).
		<Popover
			align="center"
			sideOffset={8}
			className="kc-pop-in"
			trigger={(open) => (
				<Button variant="ghost" color="secondary" pill aria-expanded={open} className="px-2 text-sm">
					<span className="text-ink">{model ? model.name : "Choose a model"}</span>
					{/* Kept at any width, as Codex's (it drops the permissions label first). */}
					{effort ? <span>{effort}</span> : null}
					<ChevronDown size={16} />
				</Button>
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
				<button type="button" onClick={() => setView("list")} className="kc-row justify-center text-base font-medium">
					<span className="truncate text-ink">{model.name}</span>
					<span className="-ml-1 text-tertiary">{levelName(level)}</span>
					<ChevronRight size={12} className="-ml-1 text-tertiary" />
				</button>
				<EffortSlider levels={levels} value={level} onChange={onThinking} />
			</div>
		);
	}
	return (
		<ModelList
			model={model}
			onModel={onModel}
			onBack={model && levels.length > 1 ? () => setView("effort") : undefined}
		/>
	);
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
			<div
				className="absolute inset-y-0 left-0 rounded-full bg-accent"
				style={{ width: `calc(${at(index)} + 14px)` }}
			/>
			{levels.map((level, i) => (
				<span
					key={level}
					className={`absolute top-[10px] size-1 -translate-x-1/2 rounded-full ${i <= index ? "bg-white/30" : "bg-tertiary"}`}
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
				aria-valuetext={levelName(value)}
				onChange={(e) => onChange(levels[Number(e.target.value)]!)}
				className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
			/>
		</div>
	);
}

/** A panel's search field, Codex's: a 14px glass, 13px text, then a rule under it. */
export function PanelSearch({
	value,
	onChange,
	placeholder,
	onAccept,
}: {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	/** Enter picks the first match. */
	onAccept?: () => void;
}) {
	return (
		<>
			<label className="flex items-center gap-1.5 px-2 py-[5px] text-sm">
				<Search size={14} className="shrink-0 text-tertiary" />
				<input
					autoFocus
					value={value}
					aria-label={placeholder}
					onChange={(e) => onChange(e.target.value)}
					onKeyDown={(e) => {
						if (onAccept && matches(e, "desktop.picker.accept")) {
							e.preventDefault();
							onAccept();
						}
					}}
					placeholder={placeholder}
					className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-tertiary focus-visible:outline-none"
				/>
			</label>
			<ListSeparator />
		</>
	);
}

export function ModelList({
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
	const first = groups[0]?.[1][0];
	return (
		<div className="flex max-h-[min(420px,70vh)] w-[280px] flex-col">
			<div className="flex items-center gap-1 px-2 pt-1 pb-1">
				{onBack ? (
					<IconButton label="Back" size="3xs" round className="-ml-1" onClick={onBack}>
						<ChevronLeft size={14} />
					</IconButton>
				) : null}
				<span className="text-sm text-tertiary">Select model</span>
			</div>
			<PanelSearch
				value={query}
				onChange={setQuery}
				placeholder="Search models"
				onAccept={() => first && onModel(first)}
			/>
			<div ref={list} className="min-h-0 overflow-y-auto">
				{groups.length === 0 ? (
					<div className="px-2 py-1.5 text-sm text-tertiary">
						{models.length ? "No matching models" : "No models. Sign in to a provider in Settings."}
					</div>
				) : null}
				{groups.map(([provider, list]) => (
					<div key={provider}>
						<div className="px-2 pt-2 pb-1 text-xs text-tertiary">{provider}</div>
						{list.map((m) => (
							<ListRow
								key={`${m.provider}/${m.id}`}
								checked={model?.provider === m.provider && model.id === m.id}
								onClick={() => onModel(m)}
							>
								<Tooltip content={`${tokens(m.contextWindow)} context`} side="right">
									<span>{m.name}</span>
								</Tooltip>
							</ListRow>
						))}
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * Codex's project picker: a search field over the projects (a check on the current one), then adding a folder. The
 * trigger is the caller's (the composer's project chip, the home title's project name).
 */
export function ProjectPicker({
	cwd,
	onChange,
	trigger,
	side = "top",
}: {
	cwd: string | undefined;
	onChange: (cwd: string) => void;
	trigger: (open: boolean) => ReactNode;
	side?: "top" | "bottom";
}) {
	const projects = useStore(selectProjects);
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const shown = projects.filter((p) => !q || (p.name ?? basename(p.path)).toLowerCase().includes(q));
	return (
		<Popover side={side} trigger={trigger}>
			{(close) => {
				const choose = (path: string) => {
					close();
					setQuery("");
					onChange(path);
				};
				return (
					<div className="w-[252px]">
						<PanelSearch
							value={query}
							onChange={setQuery}
							placeholder="Search projects"
							onAccept={() => shown[0] && choose(shown[0].path)}
						/>
						<div role="listbox" aria-label="Projects" className="max-h-64 overflow-y-auto">
							{shown.map((p) => (
								<ListRow
									key={p.path}
									icon={<Folder size={16} />}
									checked={p.path === cwd}
									onClick={() => choose(p.path)}
								>
									<Tooltip content={p.path} side="right">
										<span>{p.name ?? basename(p.path)}</span>
									</Tooltip>
								</ListRow>
							))}
							{shown.length === 0 ? (
								<div className="px-2 py-1.5 text-sm text-tertiary">No matching projects</div>
							) : null}
						</div>
						<ListSeparator />
						<ListRow
							icon={<FolderPlus size={16} className="opacity-75" />}
							onClick={() => {
								close();
								void addProject().then((path) => path && onChange(path));
							}}
						>
							Add a folder…
						</ListRow>
					</div>
				);
			}}
		</Popover>
	);
}

/** The project chip in the composer's utility bar: the folder icon and the project's name (Codex's). */
export function ProjectChip({ cwd, onChange }: { cwd: string | undefined; onChange: (cwd: string) => void }) {
	return (
		<ProjectPicker
			cwd={cwd}
			onChange={onChange}
			trigger={(open) => (
				<Button
					variant="ghost"
					color="secondary"
					pill
					aria-expanded={open}
					aria-label={cwd ? `Change project: ${basename(cwd)}` : "Choose a project"}
					className="gap-1.5 px-2 text-sm"
				>
					<Folder size={16} className="text-ink" />
					<span className="text-ink">{cwd ? basename(cwd) : "Choose a project"}</span>
				</Button>
			)}
		/>
	);
}
