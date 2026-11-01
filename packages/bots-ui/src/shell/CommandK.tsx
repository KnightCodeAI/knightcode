// The search palette (Ctrl+K or Cmd+K, and the sidebar's Search): bots and groups, then actions and every settings
// page; typing also finds messages, pages and skills. Arrows move, Enter opens, Escape closes.
import {
	FileText,
	Hash,
	Inbox,
	Keyboard,
	MessageSquare,
	Plug,
	Plus,
	Repeat,
	Search,
	Sparkles,
	Users,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { useTopLayer } from "../primitives/layer.tsx";
import { SETTINGS_NAV } from "../settings/SettingsDialog.tsx";
import { useBots } from "../state/store.ts";
import { navigate, type Route, useRoute } from "./routes.ts";
import { type Hit, useSearch } from "./Search.tsx";
import { Shortcuts } from "./Shortcuts.tsx";

export interface CommandKProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** One row: a search hit or an action. `category` is the grey line under the title. */
interface Row {
	key: string;
	title: string;
	detail?: string;
	/** Read by screen readers before the title: Bot, Group, Action, Message, Page or Skill. */
	type: string;
	lead: ReactNode;
	run: () => void;
}

const TYPES: Record<Hit["kind"], string> = {
	bot: "Bot",
	group: "Group",
	message: "Message",
	page: "Page",
	skill: "Skill",
};

export function CommandK({ open, onOpenChange }: CommandKProps) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const [shortcuts, setShortcuts] = useState(false);
	const hits = useSearch(query);
	const route = useRoute();
	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);
	useEffect(() => setSelected(0), [query]);
	const layer = useTopLayer(open);
	const close = () => onOpenChange(false);
	const go = (to: Route) => () => navigate(to);
	const actions = useMemo<Row[]>(() => {
		const action = (key: string, title: string, icon: ReactNode, run: () => void, detail?: string): Row => ({
			key: `action:${key}`,
			title,
			detail,
			type: "Action",
			lead: <span className="kb-palette__tile">{icon}</span>,
			run,
		});
		const botId = route.name === "bot" ? route.botId : undefined;
		return [
			action("new-bot", "New Bot", <Plus size={12} />, go({ name: "new", tab: "create" })),
			action("new-group", "New group chat", <Users size={12} />, () => navigate("/groups/new/settings")),
			action("shortcuts", "Keyboard shortcuts", <Keyboard size={12} />, () => setShortcuts(true), "Help"),
			...SETTINGS_NAV.map((item) =>
				action(
					`settings-${item.id}`,
					`Settings: ${item.label}`,
					item.icon,
					go(item.id === "activity" ? { name: "activity" } : { name: "settings", section: item.id }),
					"Settings",
				),
			),
			action("inbox", "Inbox", <Inbox size={12} />, go({ name: "inbox" }), "Go to"),
			action("pages", "Pages", <FileText size={12} />, go({ name: "pages" }), "Go to"),
			action("skills", "Skills", <Sparkles size={12} />, go({ name: "skills" }), "Go to"),
			action("connectors", "Connect apps", <Plug size={12} />, go({ name: "connectors" }), "Go to"),
			...(botId
				? [action("new-routine", "New routine", <Repeat size={12} />, go({ name: "bot", botId, pane: "routine-new" }))]
				: []),
		];
	}, [route]);
	const needle = query.trim().toLowerCase();
	const rows: Row[] = [
		...hits.map((hit) => ({
			key: hit.key,
			title: hit.title,
			detail: hit.snippet,
			type: TYPES[hit.kind],
			lead: <HitLead hit={hit} />,
			run: () => navigate(hit.route),
		})),
		...actions.filter((row) => !needle || row.title.toLowerCase().includes(needle)),
	];
	const run = (row: Row | undefined) => {
		if (!row) return;
		close();
		row.run();
	};
	return (
		<>
			<DialogPrimitive.Root open={open && layer !== undefined} onOpenChange={onOpenChange}>
				<DialogPrimitive.Portal container={layer}>
					<DialogPrimitive.Overlay className="kb-dialog-scrim" />
					<DialogPrimitive.Content
						className="kb-dialog kb-palette"
						aria-describedby={undefined}
						data-ref="search-dialog"
					>
						<DialogPrimitive.Title className="kb-visually-hidden">Search</DialogPrimitive.Title>
						<div className="kb-palette__head">
							<span className="kb-palette__icon" aria-hidden>
								<Search size={16} />
							</span>
							<input
								className="kb-palette__input"
								placeholder="Search"
								aria-label="Search"
								role="combobox"
								aria-expanded
								aria-controls="kb-palette-results"
								aria-activedescendant={rows[selected] ? `kb-hit-${selected}` : undefined}
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "ArrowDown") {
										event.preventDefault();
										setSelected((i) => Math.min(rows.length - 1, i + 1));
									} else if (event.key === "ArrowUp") {
										event.preventDefault();
										setSelected((i) => Math.max(0, i - 1));
									} else if (event.key === "Enter") {
										event.preventDefault();
										run(rows[selected]);
									}
								}}
								data-ref="search-input"
							/>
						</div>
						{rows.length === 0 ? (
							<div className="kb-palette__empty">Nothing matches</div>
						) : (
							<div className="kb-palette__results" id="kb-palette-results" role="listbox" aria-label="Results">
								{rows.map((row, i) => (
									<button
										key={row.key}
										type="button"
										id={`kb-hit-${i}`}
										className="kb-palette__result"
										role="option"
										aria-selected={i === selected}
										tabIndex={-1}
										onMouseMove={() => setSelected(i)}
										onClick={() => run(row)}
									>
										<span className="kb-palette__lead">{row.lead}</span>
										<span className="kb-palette__result-text">
											<span className="kb-palette__result-title">{row.title}</span>
											{row.detail && <span className="kb-palette__result-detail">{row.detail}</span>}
										</span>
										<span className="kb-visually-hidden">{row.type}</span>
									</button>
								))}
							</div>
						)}
					</DialogPrimitive.Content>
				</DialogPrimitive.Portal>
			</DialogPrimitive.Root>
			{shortcuts && <Shortcuts onClose={() => setShortcuts(false)} />}
		</>
	);
}

function HitLead({ hit }: { hit: Hit }) {
	const { data } = useBots();
	const bot =
		typeof hit.route !== "string" && hit.route.name === "bot" && hit.kind === "bot"
			? data?.bots.find((b) => b.id === (hit.route as { botId: string }).botId)
			: undefined;
	if (bot) return <BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={24} />;
	const icons: Record<Hit["kind"], ReactNode> = {
		bot: <Hash size={12} />,
		group: <Users size={12} />,
		message: <MessageSquare size={12} />,
		page: <FileText size={12} />,
		skill: <Sparkles size={12} />,
	};
	return <span className="kb-palette__tile">{icons[hit.kind]}</span>;
}

/** Calls `onOpen` on Ctrl+K, or Cmd+K on macOS. */
export function useCommandKShortcut(onOpen: () => void): void {
	useEffect(() => {
		const listener = (event: KeyboardEvent) => {
			if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey) {
				event.preventDefault();
				onOpen();
			}
		};
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	}, [onOpen]);
}
