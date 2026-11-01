// A bot's details pane: avatar and name, then Details (routines and settings), Library and Computer.
import type { Bot, ModelOption } from "@knightcode/bots-protocol";
import { Share, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { IconButton } from "../primitives/IconButton.tsx";
import { Select } from "../primitives/Select.tsx";
import { Tabs } from "../primitives/Tabs.tsx";
import { exportRecipe } from "../bot/ExportBot.tsx";
import { ComputerPane } from "../computer/ComputerPane.tsx";
import { RoutineEditor } from "../routines/RoutineEditor.tsx";
import { RoutineList } from "../routines/RoutineList.tsx";
import { MemoryViewer } from "../bot/MemoryViewer.tsx";
import { BOTS, type BotList, useResource, useStore } from "../state/store.ts";
import { navigate, type PaneView } from "./routes.ts";

export interface InfoPaneProps {
	bot: Bot | undefined;
	view: PaneView | "closed";
	/** The routine open in the editor, for /bots/<id>/routines/<routineId>. */
	routineId?: string;
}

type Tab = "details" | "library" | "computer";

const TAB_OF: Record<PaneView, Tab> = {
	details: "details",
	settings: "details",
	routines: "details",
	"routine-new": "details",
	memory: "library",
	library: "library",
	computer: "computer",
};

/** The right column for a bot. Closed, it keeps its place in the grid at zero width so it can slide open. */
export function InfoPane({ bot, view, routineId }: InfoPaneProps) {
	const store = useStore();
	const closed = view === "closed";
	const tab = closed ? "details" : TAB_OF[view];
	return (
		<aside
			className="kb-pane"
			aria-label="Conversation details"
			data-ref="info-pane"
			data-closed={closed ? "" : undefined}
			aria-hidden={closed}
			// Closed, its controls leave the tab order too.
			inert={closed}
		>
			<header className="kb-pane__top" data-ref="info-pane-top">
				<span style={{ display: "flex", gap: 8 }} data-ref="info-pane-actions">
					<IconButton
						label="Share"
						icon={<Share size={16} strokeWidth={1.75} />}
						onClick={() => bot && void exportRecipe(store, bot)}
					/>
					<IconButton
						label="Close"
						icon={<X size={16} strokeWidth={1.75} />}
						onClick={() => bot && navigate({ name: "bot", botId: bot.id, pane: "closed" })}
					/>
				</span>
				<span className="kb-pane__divider" aria-hidden />
			</header>
			{bot && (
				<div className="kb-pane__scroll">
					<PaneHead bot={bot} />
					<div className="kb-pane__tabs">
						<Tabs
							label="Conversation details"
							value={tab}
							onValueChange={(next) => navigate({ name: "bot", botId: bot.id, pane: next as Tab })}
							listClassName="kb-pane__tablist"
							refs={{ list: "info-tabs", active: "info-tab-active", inactive: "info-tab" }}
							items={[
								{ value: "details", label: "Details" },
								{ value: "library", label: "Library" },
								{ value: "computer", label: "Computer" },
							]}
						/>
					</div>
					<div className="kb-pane__panel" role="tabpanel" data-ref="info-tabpanel">
						{(view === "routine-new" || (view === "routines" && routineId)) && (
							<RoutineEditor bot={bot} routineId={view === "routine-new" ? undefined : routineId} />
						)}
						{tab === "details" && view !== "routine-new" && !(view === "routines" && routineId) && (
							<Details bot={bot} />
						)}
						{view === "memory" && <MemoryViewer bot={bot} />}
						{view === "library" && <Library bot={bot} />}
						{/* The list's end, as measured: a 1 px marker after the content. */}
						{view === "library" && <div className="kb-pane__end" aria-hidden />}
						{tab === "computer" && <ComputerPane bot={bot} />}
					</div>
				</div>
			)}
		</aside>
	);
}

function PaneHead({ bot }: { bot: Bot }) {
	const store = useStore();
	const [name, setName] = useState(bot.name);
	useEffect(() => setName(bot.name), [bot.name]);
	const save = async () => {
		const trimmed = name.trim();
		if (!trimmed || trimmed === bot.name) return setName(bot.name);
		const next = await store.api.updateBot({ botId: bot.id, name: trimmed });
		store.set<BotList>(BOTS, (list) => list && { ...list, bots: list.bots.map((b) => (b.id === next.id ? next : b)) });
	};
	return (
		<div>
			<div className="kb-pane__head">
				<button
					type="button"
					className="kb-pane__avatar"
					data-avatar-box=""
					aria-label="Edit Bot avatar"
					onClick={() => navigate(`/bots/${encodeURIComponent(bot.id)}/settings?edit=1`)}
				>
					<BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={64} />
				</button>
				<input
					className="kb-pane__name"
					aria-label="Bot name"
					placeholder="Name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					onBlur={() => void save()}
					onKeyDown={(event) => {
						if (event.key === "Enter") event.currentTarget.blur();
						if (event.key === "Escape") setName(bot.name);
					}}
				/>
			</div>
		</div>
	);
}

const THINKING_LABELS: Record<string, string> = { off: "Off", low: "Low", medium: "Medium", high: "High" };

function Details({ bot }: { bot: Bot }) {
	const store = useStore();
	const { data: models } = useResource("models", (api) => api.listModels({}));
	const options: ModelOption[] = models?.models ?? [];
	const current = options.find((m) => m.provider === bot.model.provider && m.modelId === bot.model.modelId);
	const update = async (patch: Partial<Pick<Bot, "model" | "approvals">>) => {
		const next = await store.api.updateBot({ botId: bot.id, ...patch });
		store.set<BotList>(BOTS, (list) => list && { ...list, bots: list.bots.map((b) => (b.id === next.id ? next : b)) });
	};
	return (
		<div className="kb-pane__stack" data-ref="empty-text">
			<RoutineList bot={bot} />
			<section className="kb-group" data-ref="settings-group">
				<div className="kb-group__title">Model</div>
				<ul className="kb-group__list">
					<li className="kb-group__row">
						<span>Model</span>
						<Select
							label="Model"
							dataRef="settings-control"
							value={`${bot.model.provider}/${bot.model.modelId}`}
							onValueChange={(value) => {
								const picked = options.find((m) => `${m.provider}/${m.modelId}` === value);
								if (picked)
									void update({
										model: { provider: picked.provider, modelId: picked.modelId, thinking: bot.model.thinking },
									});
							}}
							options={options.map((m) => ({ value: `${m.provider}/${m.modelId}`, label: m.name }))}
						/>
					</li>
					{current && current.thinking.length > 0 && (
						<li className="kb-group__row">
							<span>Thinking</span>
							<Select
								label="Thinking"
								value={bot.model.thinking ?? current.thinking[0]!}
								onValueChange={(thinking) => void update({ model: { ...bot.model, thinking } })}
								options={current.thinking.map((level) => ({ value: level, label: THINKING_LABELS[level] ?? level }))}
							/>
						</li>
					)}
					<li className="kb-group__row">
						<span>Approvals</span>
						<Select
							label="Approvals"
							value={bot.approvals}
							onValueChange={(approvals) => void update({ approvals: approvals as Bot["approvals"] })}
							options={[
								{ value: "default", label: "Default" },
								{ value: "ask", label: "Ask" },
								{ value: "auto", label: "Auto" },
								{ value: "never", label: "Never ask" },
							]}
						/>
					</li>
				</ul>
			</section>
		</div>
	);
}

function Library({ bot }: { bot: Bot }) {
	const { data: pages } = useResource("pages", (api) => api.listPages({}));
	const { data: files } = useResource(`files:${bot.id}`, (api) => api.listFiles({ botId: bot.id }));
	const own = (pages?.pages ?? []).filter((p) => p.ownerBotId === bot.id);
	const made = files?.files ?? [];
	if (own.length === 0 && made.length === 0)
		return <p className="kb-pane__empty">Pages, files, and apps this Bot makes show up here</p>;
	return (
		<section className="kb-group">
			<ul className="kb-group__list">
				{own.map((page) => (
					<li key={page.id} className="kb-group__row">
						<a
							href={`/pages/${page.id}`}
							onClick={(e) => (e.preventDefault(), navigate({ name: "page", pageId: page.id }))}
							style={{ color: "inherit", textDecoration: "none" }}
						>
							{page.title}
						</a>
					</li>
				))}
				{made.map((file) => (
					<li key={file.id} className="kb-group__row">
						<span>{file.name}</span>
					</li>
				))}
			</ul>
		</section>
	);
}
