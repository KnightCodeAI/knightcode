/**
 * The composer's pickers, after Codex's (measured 2026-10-15 to 2026-10-19):
 *
 * - ApprovalPicker: "Change permissions", a 390px menu headed "How should KnightCode actions be approved?", each mode
 *   with an 18px icon, a description and a check; Full access in the caution colour and confirmed once per thread.
 * - ModelPicker: the model and its reasoning effort, a draft until the panel closes; the effort slider first, the model
 *   list one step away in the same panel (measured 2026-10-21 against Codex 26.1013).
 * - ProjectPicker: a 260px panel with a search field, the projects with a check on the current one, and adding one.
 */

import type { ApprovalMode, ThinkingLevel } from "@knightcode/app-server-protocol";
import { Slider } from "radix-ui";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { basename, tokens } from "../format.ts";
import { matches } from "../keys.ts";
import { addProject, type ModelInfo, selectPreferences, selectProjects, useStore } from "../store.ts";
import { Button } from "./button.tsx";
import { ChevronDown, ChevronRight, Folder, FolderPlus, Hand, Search, ShieldAlert, ShieldTerminal } from "./icons.tsx";
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
					className={`quiet kc-approval-picker-btn px-1.5 text-sm ${mode === "fullAccess" ? "!text-caution" : ""}`}
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

/** Levels in order, to carry a level over to a model that lacks it: the next one up, else its highest. */
const LEVEL_ORDER = Object.keys(LEVEL_NAMES);
const carryLevel = (level: ThinkingLevel, levels: readonly ThinkingLevel[]) =>
	levels.includes(level)
		? level
		: (levels.find((l) => LEVEL_ORDER.indexOf(l) >= LEVEL_ORDER.indexOf(level)) ?? levels.at(-1));

type ModelChoice = { model: ModelInfo | undefined; thinking: ThinkingLevel | undefined };

/**
 * Codex's model picker (26.1013, `_Menu_tovi5` in app-primary): the choice is a draft until the panel closes, then
 * committed in one change. The panel opens on the effort slider under a "model Effort ›" header; the header turns to
 * the model list, and picking a model returns to the slider. While the slider shows, the trigger reads "Select
 * model" at its closed width, since the header names the model.
 */
export function ModelPicker({
	model,
	thinking,
	onChange,
}: {
	model: ModelInfo | undefined;
	thinking: ThinkingLevel | undefined;
	/** What the panel changed, once, as it closes. */
	onChange: (change: { model?: ModelInfo; thinking?: ThinkingLevel }) => void;
}) {
	const [draft, setDraft] = useState<ModelChoice>({ model, thinking });
	// Read on close, which can follow a pick in the same event.
	const latest = useRef(draft);
	const update = (next: ModelChoice) => {
		latest.current = next;
		setDraft(next);
	};
	const [view, setView] = useState<"effort" | "list">("effort");
	const button = useRef<HTMLButtonElement>(null);
	const [minWidth, setMinWidth] = useState<number>();
	const hasEffort = (m: ModelInfo | undefined) => (m?.thinkingLevels.length ?? 0) > 1;
	const onOpenChange = (open: boolean) => {
		if (open) {
			setMinWidth(button.current?.offsetWidth);
			update({ model, thinking });
			setView(hasEffort(model) ? "effort" : "list");
			return;
		}
		const d = latest.current;
		const modelChanged = !!d.model && (d.model.provider !== model?.provider || d.model.id !== model?.id);
		const thinkingChanged = !!d.thinking && (modelChanged || d.thinking !== thinking);
		if (modelChanged || thinkingChanged)
			onChange({ model: modelChanged ? d.model : undefined, thinking: thinkingChanged ? d.thinking : undefined });
	};
	return (
		// Centred on the trigger 8px above it, as Codex's (its alignOffset is half the width difference).
		<Popover
			align="center"
			sideOffset={8}
			className="kc-pop-in w-[254px] p-0"
			onOpenChange={onOpenChange}
			trigger={(open) => {
				const shown = open ? draft : { model, thinking };
				const levels = shown.model?.thinkingLevels ?? [];
				return (
					<Button
						ref={button}
						variant="ghost"
						color="secondary"
						pill
						aria-expanded={open}
						className="quiet kc-model-picker-btn justify-center px-2 text-sm"
						style={open ? { minWidth } : undefined}
					>
						{open && view === "effort" ? (
							<span>Select model</span>
						) : (
							<>
								<span className="truncate text-ink">{shown.model ? shown.model.name : "Choose a model"}</span>
								{/* Kept at any width, as Codex's (it drops the permissions label first). */}
								{shown.thinking && levels.length > 1 ? <EffortLabel levels={levels} level={shown.thinking} /> : null}
							</>
						)}
						<ChevronDown size={16} />
					</Button>
				);
			}}
		>
			{(close) => (
				<ModelMenu
					view={view}
					draft={draft}
					onList={() => setView("list")}
					onDone={close}
					onThinking={(level) => update({ ...latest.current, thinking: level })}
					onModel={(m) => {
						const level = latest.current.thinking;
						update({ model: m, thinking: level && carryLevel(level, m.thinkingLevels) });
						if (hasEffort(m)) setView("effort");
						else close();
					}}
				/>
			)}
		</Popover>
	);
}

/**
 * The trigger's effort word, Codex's (_ModelPickerTriggerEffort*): every level stacked in one cell, the current one
 * faded in from a 4px blur and the others out, the cell's width easing to the current word on the 0.3 s spring.
 */
function EffortLabel({ levels, level }: { levels: readonly ThinkingLevel[]; level: ThinkingLevel }) {
	const cell = useRef<HTMLSpanElement>(null);
	const [width, setWidth] = useState<number>();
	useLayoutEffect(() => {
		const word = cell.current?.querySelector<HTMLElement>(`[data-level="${level}"]`);
		if (word) setWidth(word.offsetWidth);
	}, [level]);
	return (
		<span className="kc-effort" style={{ width }}>
			<span className="sr-only">{levelName(level)}</span>
			<span ref={cell} aria-hidden className="kc-effort-cell">
				{levels.map((l) => (
					<span key={l} data-level={l} data-active={l === level || undefined}>
						{levelName(l)}
					</span>
				))}
			</span>
		</span>
	);
}

/**
 * The panel's two views, stacked as Codex's: the panel's height eases to the shown view's (0.32 s), the views'
 * parts fade (0.2 s) and slide 10px, staggered (styles.css, .kc-mp). The hidden view stays mounted and inert.
 */
function ModelMenu({
	view,
	draft,
	onList,
	onDone,
	onModel,
	onThinking,
}: {
	view: "effort" | "list";
	draft: ModelChoice;
	onList: () => void;
	onDone: () => void;
	onModel: (model: ModelInfo) => void;
	onThinking: (level: ThinkingLevel) => void;
}) {
	const effort = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number>();
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		const panel = (view === "effort" ? effort : list).current;
		if (!panel) return;
		setHeight(panel.offsetHeight);
		const observer = new ResizeObserver(() => setHeight(panel.offsetHeight));
		observer.observe(panel);
		// Next frame: the list's height cap reads a variable Radix sets only once the panel is placed, and Radix's
		// slider shows its thumb from its second render. The slider before any input: Radix renders a hidden form
		// input beside its thumb.
		const frame = requestAnimationFrame(() => {
			(panel.querySelector<HTMLElement>("[role=slider]") ?? panel.querySelector("input"))?.focus({
				preventScroll: true,
			});
			panel.querySelector("[data-checked]")?.scrollIntoView({ block: "center" });
		});
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [view]);
	// No transition into the first height.
	useEffect(() => {
		const frame = requestAnimationFrame(() => setReady(true));
		return () => cancelAnimationFrame(frame);
	}, []);
	const { model } = draft;
	const levels = model?.thinkingLevels ?? [];
	const level = draft.thinking && levels.includes(draft.thinking) ? draft.thinking : levels[0];
	const active = (v: typeof view) => String(view === v);
	return (
		<div className="kc-mp" data-ready={ready || undefined} style={{ height }}>
			<div ref={effort} className="kc-mp-view" inert={view !== "effort"} aria-hidden={view !== "effort"}>
				{model && level ? (
					<>
						<div className="kc-mp-part kc-mp-header" data-part="header" data-active={active("effort")}>
							<button type="button" aria-label="Select model" onClick={onList} className="quiet kc-mp-toggle group">
								<span className="kc-mp-toggle-content">
									<span className="truncate text-ink">{model.name}</span>
									<span className="ms-0.5 shrink-0 text-tertiary">{levelName(level)}</span>
									<ChevronRight size={12} className="shrink-0 text-tertiary" />
								</span>
							</button>
						</div>
						<div className="kc-mp-part py-1" data-part="slider" data-active={active("effort")}>
							<EffortSlider levels={levels} value={level} onChange={onThinking} onDone={onDone} />
						</div>
					</>
				) : null}
			</div>
			<div ref={list} className="kc-mp-view" inert={view !== "list"} aria-hidden={view !== "list"}>
				<div className="kc-mp-part" data-part="list" data-active={active("list")}>
					<ModelList
						model={model}
						onModel={onModel}
						className="max-h-[min(316px,calc(var(--radix-popover-content-available-height)-4px))]"
					/>
				</div>
			</div>
		</div>
	);
}

/** The knob's centre at `percent` along the track: 13px in at either end (Codex's 28px knob less 1px). */
const knobAt = (percent: number) => `calc(${percent}% + ${13 - (percent / 50) * 13}px)`;
/** The fill, a full-width span slid left to end under the knob's centre; empty at the first level, full at the last. */
const fillAt = (percent: number, last: number) => {
	const step = 100 / last;
	const shift = (13 - (percent / 50) * 13) * Math.min(percent / step, (100 - percent) / step, 1);
	return `translateX(calc(${percent - 100}% + ${shift}px))`;
};
/** Wheel travel per level, as Codex's; a pause over 160ms or a turn back starts the count again. */
const WHEEL_STEP = 30;

/**
 * Reasoning effort as Codex draws it (ModelPickerPowerSliderImpl and _xwb5v, 26.1013), on the same Radix slider: a
 * 24px pill track at 10% text, a 4px dot per level, a 28px white knob. Knob and fill move on one 0.3 s tween (0.15 s
 * while dragging, under the closed hand); the knob springs to 32px while hovered or pressed; a dot doubles under the
 * pointer and a press jumps to it; the wheel steps a level per 30px; Enter closes the panel. Styles: .kc-power.
 */
function EffortSlider({
	levels,
	value,
	onChange,
	onDone,
}: {
	levels: readonly ThinkingLevel[];
	value: ThinkingLevel;
	onChange: (level: ThinkingLevel) => void;
	onDone: () => void;
}) {
	const index = Math.max(0, levels.indexOf(value));
	const last = Math.max(levels.length - 1, 1);
	const percent = (i: number) => (i / last) * 100;
	const [pressed, setPressed] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [hovered, setHovered] = useState(false);
	const root = useRef<HTMLSpanElement>(null);
	// The wheel listener is attached once (it must not be passive to keep the panel from scrolling).
	const latest = useRef({ index, levels, onChange });
	latest.current = { index, levels, onChange };
	useEffect(() => {
		const element = root.current;
		if (!element) return;
		const wheel = { delta: 0, time: 0 };
		const onWheel = (event: WheelEvent) => {
			if (event.ctrlKey) return;
			event.preventDefault();
			const { index, levels, onChange } = latest.current;
			const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : -event.deltaY;
			const delta = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? raw : Math.sign(raw) * WHEEL_STEP;
			if (delta === 0) return;
			if (event.timeStamp - wheel.time > 160 || Math.sign(delta) !== Math.sign(wheel.delta)) wheel.delta = 0;
			wheel.time = event.timeStamp;
			wheel.delta += delta;
			if (Math.abs(wheel.delta) < WHEEL_STEP) return;
			const direction = Math.sign(wheel.delta);
			wheel.delta -= direction * WHEEL_STEP;
			const next = Math.max(0, Math.min(index + direction, levels.length - 1));
			if (next === index) wheel.delta = 0;
			else onChange(levels[next]!);
		};
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => element.removeEventListener("wheel", onWheel);
	}, []);
	// Codex drops the hover with the press too: the knob settles until the pointer enters it again.
	const release = () => {
		setPressed(false);
		setDragging(false);
		setHovered(false);
	};
	return (
		<div className="kc-power">
			<Slider.Root
				ref={root}
				className="kc-power-root"
				data-dragging={dragging || undefined}
				data-lifted={hovered || pressed || undefined}
				min={0}
				max={last}
				step={1}
				value={[index]}
				onValueChange={([i]) => i !== undefined && levels[i] && onChange(levels[i])}
				onPointerDown={() => setPressed(true)}
				onPointerMove={(event) => pressed && event.buttons !== 0 && setDragging(true)}
				onPointerUp={release}
				onPointerCancel={release}
				onLostPointerCapture={release}
			>
				<Slider.Track className="kc-power-track">
					<span className="kc-power-fill" style={{ transform: fillAt(percent(index), last) }} />
					{levels.map((level, i) => (
						<span
							key={level}
							className="kc-power-tick"
							data-selected={i <= index}
							style={{ left: knobAt(percent(i)) }}
						/>
					))}
				</Slider.Track>
				<div aria-hidden className="kc-power-rail">
					<span className="kc-power-knob" style={{ left: knobAt(percent(index)) }}>
						<span />
					</span>
				</div>
				<Slider.Thumb
					className="kc-power-thumb"
					aria-label="Reasoning effort"
					aria-valuetext={levelName(value)}
					onPointerEnter={() => setHovered(true)}
					onPointerLeave={() => setHovered(false)}
					onKeyDown={(event) => {
						if (!matches(event, "desktop.item.activate")) return;
						event.preventDefault();
						onDone();
					}}
				/>
			</Slider.Root>
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

/** The models under Codex's "Select model" caption, grouped by provider, with a search field for long lists. */
export function ModelList({
	model,
	onModel,
	className = "max-h-[min(420px,70vh)] w-[280px]",
}: {
	model: ModelInfo | undefined;
	onModel: (model: ModelInfo) => void;
	/** Size: a panel of its own by default. */
	className?: string;
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
		<div className={`flex flex-col ${className}`}>
			<div className="px-2 py-1 text-sm text-tertiary">Select model</div>
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
					className="quiet kc-project-picker-btn gap-1.5 px-2 text-sm"
				>
					<Folder size={16} className="text-ink" />
					<span className="text-ink">{cwd ? basename(cwd) : "Choose a project"}</span>
				</Button>
			)}
		/>
	);
}
