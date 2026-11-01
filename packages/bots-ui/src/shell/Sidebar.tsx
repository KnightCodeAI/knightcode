// The sidebar: search and new bot, every bot and group by section, and the account footer.
import type { Bot, Group, Section } from "@knightcode/bots-protocol";
import {
	Archive,
	BookOpen,
	ChevronRight,
	Copy,
	FileText,
	Gauge,
	Inbox,
	LogOut,
	MoreHorizontal,
	Pin,
	PinOff,
	Plus,
	Search,
	Settings,
	Settings2,
	Smartphone,
	SquarePen,
	Undo2,
	Users,
} from "lucide-react";
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { IconButton } from "../primitives/IconButton.tsx";
import { Menu, MenuItem, MenuSeparator, MenuSub } from "../primitives/Menu.tsx";
import { MobileApp } from "./MobileApp.tsx";
import { useToast } from "../primitives/Toast.tsx";
import { BOTS, type BotList, useBots, useResource, useStore } from "../state/store.ts";
import { navigate, type Route } from "./routes.ts";

export interface SidebarProps {
	route: Route;
	onSearch: () => void;
	/** At the start of the header, before the buttons. */
	header?: ReactNode;
}

/** The left column. Rows are links in a navigation landmark, not list items. */
export function Sidebar({ route, onSearch, header }: SidebarProps) {
	const { data } = useBots();
	const [showArchived, setShowArchived] = useState(false);
	const activeBot = route.name === "bot" ? route.botId : undefined;
	const activeGroup = route.name === "group" ? route.groupId : undefined;
	const bots = (data?.bots ?? []).filter((bot) => bot.archived === showArchived);
	const groups = showArchived ? [] : (data?.groups ?? []);
	const sections = showArchived ? [] : (data?.sections ?? []);
	const placed = new Set(sections.flatMap((s) => s.itemIds));
	const loose = [...bots.filter((b) => !placed.has(b.id)), ...groups.filter((g) => !placed.has(g.id))].sort(
		byPinnedThenRecent,
	);
	const byId = new Map<string, Bot | Group>([...bots, ...groups].map((item) => [item.id, item]));
	const row = (item: Bot | Group) =>
		"memberIds" in item ? (
			<GroupRow key={item.id} group={item} active={item.id === activeGroup} />
		) : (
			<BotRow key={item.id} bot={item} active={item.id === activeBot} sections={sections} />
		);
	return (
		<nav className="kb-sidebar" aria-label="Bots" data-ref="sidebar">
			<div className="kb-sidebar__header" data-ref="sidebar-header">
				{header && <div className="kb-sidebar__header-start kb-host">{header}</div>}
				<IconButton
					label="Search"
					icon={<Search size={16} strokeWidth={1.75} />}
					onClick={onSearch}
					data-ref="sidebar-search"
				/>
				<IconButton
					label="New Bot"
					icon={<Plus size={16} strokeWidth={1.75} />}
					onClick={() => navigate({ name: "new", tab: "create" })}
					data-ref="sidebar-new"
				/>
			</div>
			<div className="kb-sidebar__list" role="region" aria-label="Bot list">
				<div className="kb-sidebar__rows" data-ref="sidebar-rows">
					{showArchived && (
						<button
							type="button"
							className="kb-sidebar__section"
							onClick={() => setShowArchived(false)}
							style={{ border: 0, background: "none", textAlign: "start", cursor: "pointer" }}
						>
							Archived · Back to bots
						</button>
					)}
					{sections.map((section) => {
						const items = section.itemIds.map((id) => byId.get(id)).filter((item) => item !== undefined);
						return items.length === 0 ? null : (
							<div key={section.id} className="kb-sidebar__rows">
								<div className="kb-sidebar__section">{section.name}</div>
								{items.map(row)}
							</div>
						);
					})}
					{loose.map(row)}
				</div>
			</div>
			<Footer onShowArchived={() => setShowArchived(true)} />
			<ResizeHandle />
		</nav>
	);
}

function byPinnedThenRecent(a: Bot | Group, b: Bot | Group): number {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	const recent = (item: Bot | Group) =>
		"lastActivityAt" in item ? (item.lastActivityAt ?? item.createdAt) : item.createdAt;
	return recent(b) - recent(a);
}

function BotRow({ bot, active, sections }: { bot: Bot; active: boolean; sections: Section[] }) {
	const store = useStore();
	const toast = useToast();
	const patch = async (update: Promise<Bot>) => {
		const next = await update;
		store.set<BotList>(BOTS, (list) => list && { ...list, bots: list.bots.map((b) => (b.id === next.id ? next : b)) });
		return next;
	};
	const moveTo = async (sectionId: string | undefined) => {
		const next = sections.map((s) => ({
			...s,
			itemIds: s.itemIds.filter((id) => id !== bot.id).concat(s.id === sectionId ? [bot.id] : []),
		}));
		const { sections: saved } = await store.api.setSections({ sections: next });
		store.set<BotList>(BOTS, (list) => list && { ...list, sections: saved });
	};
	return (
		<div className="kb-row-wrap" style={{ position: "relative" }}>
			<a
				href={`/bots/${encodeURIComponent(bot.id)}`}
				className="kb-row"
				aria-current={active ? "page" : undefined}
				aria-label={bot.main ? `${bot.name}, Main Bot` : bot.name}
				data-ref="sidebar-row"
				onClick={(event) => {
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
					event.preventDefault();
					navigate({ name: "bot", botId: bot.id, pane: "details" });
				}}
			>
				<span className="kb-row__avatar" data-ref="row-avatar" data-avatar-box="">
					<BotAvatarView
						shape={bot.avatar.shape}
						color={bot.avatar.color}
						state={bot.status === "working" ? "working" : bot.status === "sleeping" ? "sleeping" : "idle"}
						size={36}
					/>
					{bot.main && <span className="kb-row__badge" role="img" aria-label="Main Bot" data-ref="row-badge" />}
				</span>
				<span className="kb-row__body">
					<span className="kb-row__title">
						<span className="kb-row__name" data-ref="row-name">
							{bot.name}
						</span>
						{bot.pinned && <Pin size={12} color="var(--kb-color-text-tertiary)" aria-label="Pinned" />}
					</span>
					<span className="kb-row__preview-row">
						<span className="kb-row__preview" data-ref="row-preview">
							{bot.purpose}
						</span>
						{bot.needsYou ? (
							<span className="kb-row__needs-you" data-testid="needs-you" role="img" aria-label="Needs you" />
						) : bot.unread > 0 ? (
							<span className="kb-row__unread" aria-label={`${bot.unread} unread`}>
								{bot.unread}
							</span>
						) : null}
					</span>
				</span>
			</a>
			<Menu
				label={`${bot.name} actions`}
				align="end"
				trigger={
					<button
						type="button"
						className="kb-row__more kb-icon-button kb-icon-button--ghost"
						aria-label={`${bot.name} actions`}
						style={{ width: 28, height: 28 }}
					>
						<MoreHorizontal size={16} />
					</button>
				}
			>
				<MenuItem
					icon={bot.pinned ? <PinOff size={14} /> : <Pin size={14} />}
					onSelect={() => void patch(store.api.updateBot({ botId: bot.id, pinned: !bot.pinned }))}
				>
					{bot.pinned ? "Unpin" : "Pin"}
				</MenuItem>
				<MenuItem
					icon={<Inbox size={14} />}
					onSelect={() => void patch(store.api.markUnread({ botId: bot.id, unread: bot.unread === 0 }))}
				>
					{bot.unread === 0 ? "Mark unread" : "Mark read"}
				</MenuItem>
				{sections.map((section) => (
					<MenuItem key={section.id} icon={<FileText size={14} />} onSelect={() => void moveTo(section.id)}>
						Move to {section.name}
					</MenuItem>
				))}
				{sections.some((s) => s.itemIds.includes(bot.id)) && (
					<MenuItem icon={<Undo2 size={14} />} onSelect={() => void moveTo(undefined)}>
						Remove from section
					</MenuItem>
				)}
				<MenuItem
					icon={<Settings2 size={14} />}
					onSelect={() => navigate(`/bots/${encodeURIComponent(bot.id)}/settings?edit=1`)}
				>
					Settings
				</MenuItem>
				<MenuItem
					icon={<Users size={14} />}
					onSelect={() => navigate(`/groups/new/settings?with=${encodeURIComponent(bot.id)}`)}
				>
					New group with {bot.name}
				</MenuItem>
				<MenuItem
					icon={<Copy size={14} />}
					onSelect={async () => {
						const copy = await store.api.duplicateBot({ botId: bot.id });
						store.reload(BOTS);
						navigate({ name: "bot", botId: copy.id, pane: "details" });
					}}
				>
					Duplicate
				</MenuItem>
				<MenuSeparator />
				{bot.archived ? (
					<MenuItem icon={<Undo2 size={14} />} onSelect={() => void patch(store.api.restoreBot({ botId: bot.id }))}>
						Restore
					</MenuItem>
				) : (
					<MenuItem
						icon={<Archive size={14} />}
						onSelect={async () => {
							await patch(store.api.archiveBot({ botId: bot.id }));
							toast({
								text: `${bot.name} archived`,
								action: { label: "Undo", onAction: () => void patch(store.api.restoreBot({ botId: bot.id })) },
							});
						}}
					>
						Archive
					</MenuItem>
				)}
			</Menu>
		</div>
	);
}

function GroupRow({ group, active }: { group: Group; active: boolean }) {
	return (
		<a
			href={`/groups/${encodeURIComponent(group.id)}`}
			className="kb-row"
			aria-current={active ? "page" : undefined}
			onClick={(event) => {
				if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
				event.preventDefault();
				navigate({ name: "group", groupId: group.id, settings: false });
			}}
		>
			<span className="kb-row__avatar kb-account-avatar" style={{ border: 0 }}>
				{group.name.slice(0, 1)}
			</span>
			<span className="kb-row__body">
				<span className="kb-row__title">
					<span className="kb-row__name">{group.name}</span>
				</span>
				<span className="kb-row__preview-row">
					<span className="kb-row__preview">{group.memberIds.length} bots</span>
					{group.needsYou && (
						<span className="kb-row__needs-you" data-testid="needs-you" role="img" aria-label="Needs you" />
					)}
				</span>
			</span>
		</a>
	);
}

function Footer({ onShowArchived }: { onShowArchived: () => void }) {
	const { data: account } = useResource("account", (api) => api.getAccount({}));
	const { data: catalog } = useResource("catalog", (api) => api.listCatalog({}));
	// Always three logos, as measured: the connected apps first, then the catalog's first ones.
	const entries = catalog?.entries ?? [];
	const isConnected = (entry: (typeof entries)[number]) => entry.connection?.status === "connected";
	const shown = [...entries.filter(isConnected), ...entries.filter((entry) => !isConnected(entry))].slice(0, 3);
	const initial = (account?.name || account?.email || "?").slice(0, 1).toUpperCase();
	const { data: billing } = useResource("billing", (api) => api.getBilling({}));
	const used = billing?.computerHours.used ?? 0;
	const included = billing?.computerHours.included ?? 0;
	const percent = included ? Math.min(100, Math.round((used / included) * 100)) : 0;
	const planLabel = billing?.plan === "trial" ? "Trial" : billing?.plan === "active" ? "Bots plan" : "No plan";
	const [mobile, setMobile] = useState(false);
	return (
		<div className="kb-sidebar__footer" data-ref="sidebar-footer">
			<div>
				<button
					type="button"
					className="kb-account-name"
					data-ref="account-name"
					onClick={() => navigate({ name: "settings", section: "account" })}
				>
					<span className={account?.name ? undefined : "kb-account-name__text--empty"}>
						{account?.name || "Enter your name"}
					</span>
					<span className="kb-account-name__icon" aria-hidden>
						<SquarePen size={14} strokeWidth={1.75} />
					</span>
				</button>
			</div>
			<div className="kb-sidebar__account-row">
				<Menu
					label="Account"
					side="top"
					className="kb-account-menu"
					trigger={
						<button
							type="button"
							className="kb-account-avatar"
							aria-label="Open account menu"
							data-ref="account-avatar"
						>
							<span className="kb-account-avatar__disc">{initial}</span>
						</button>
					}
				>
					<MenuItem
						icon={<Gauge size={14} />}
						hint={
							<>
								{percent}% used <ChevronRight size={14} />
							</>
						}
						onSelect={() => navigate({ name: "settings", section: "usage" })}
					>
						{planLabel}
					</MenuItem>
					<MenuItem icon={<Smartphone size={14} />} onSelect={() => setMobile(true)}>
						Get Bots for mobile
					</MenuItem>
					<MenuSub icon={<BookOpen size={14} />} label="Support">
						<MenuItem onSelect={() => window.open("https://knightcode.dev/docs", "_blank", "noopener")}>
							Help center
						</MenuItem>
						<MenuItem onSelect={() => window.open("https://knightcode.dev/changelog", "_blank", "noopener")}>
							What's new
						</MenuItem>
					</MenuSub>
					<MenuItem icon={<Settings size={14} />} onSelect={() => navigate({ name: "settings", section: "account" })}>
						Settings
					</MenuItem>
					<MenuSeparator />
					<MenuItem icon={<Archive size={14} />} onSelect={onShowArchived}>
						Archived bots
					</MenuItem>
					<MenuItem icon={<LogOut size={14} />} onSelect={() => navigate("/logout")}>
						Log out
					</MenuItem>
				</Menu>
				<button
					type="button"
					className="kb-connect-apps kb-hover-wash"
					aria-label="Connect apps"
					data-ref="connect-apps"
					onClick={() => navigate({ name: "connectors" })}
				>
					<span>Connect apps</span>
					<span className="kb-app-logos" aria-hidden>
						{shown.map((entry) => (
							<span key={entry.id} className="kb-app-logo">
								<span className="kb-app-logo__inner">{entry.name.slice(0, 1)}</span>
							</span>
						))}
					</span>
				</button>
				{mobile && <MobileApp onClose={() => setMobile(false)} />}
			</div>
		</div>
	);
}

const WIDTH_KEY = "kb.sidebarWidth";
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 220;
const MAX_WIDTH = 420;

function applyWidth(width: number): number {
	const clamped = Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));
	document.documentElement.style.setProperty("--kb-layout-sidebar", `${clamped}px`);
	return clamped;
}

function saveWidth(width: number): void {
	try {
		localStorage.setItem(WIDTH_KEY, String(width));
	} catch {
		// Storage can be unavailable (private windows); the width then lasts only this visit.
	}
}

/** Drag the sidebar's edge to resize it; arrow keys do the same, double-click resets it. */
function ResizeHandle() {
	const [width, setWidth] = useState(DEFAULT_WIDTH);
	useEffect(() => {
		let saved = Number.NaN;
		try {
			saved = Number(localStorage.getItem(WIDTH_KEY));
		} catch {
			// No storage: keep the default.
		}
		if (Number.isFinite(saved) && saved > 0) setWidth(applyWidth(saved));
	}, []);
	const start = (event: PointerEvent<HTMLDivElement>) => {
		const startX = event.clientX;
		const startWidth = width;
		event.currentTarget.setPointerCapture(event.pointerId);
		const move = (e: globalThis.PointerEvent) => setWidth(applyWidth(startWidth + e.clientX - startX));
		const up = (e: globalThis.PointerEvent) => {
			saveWidth(applyWidth(startWidth + e.clientX - startX));
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};
	const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
		const step = event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
		if (!step) return;
		event.preventDefault();
		const next = applyWidth(width + step);
		setWidth(next);
		saveWidth(next);
	};
	return (
		<div
			className="kb-sidebar__resize"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize sidebar"
			aria-valuenow={width}
			aria-valuemin={MIN_WIDTH}
			aria-valuemax={MAX_WIDTH}
			tabIndex={0}
			data-ref="resize-handle"
			onPointerDown={start}
			onKeyDown={nudge}
			onDoubleClick={() => {
				setWidth(applyWidth(DEFAULT_WIDTH));
				saveWidth(DEFAULT_WIDTH);
			}}
		/>
	);
}
