// The command palette (Ctrl+K or Cmd+K, and the sidebar's Search): type to find a bot, group, message or page.
import { FileText, Hash, MessageSquare, Sparkles, Users } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactNode, useEffect, useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { useBots } from "../state/store.ts";
import { useTopLayer } from "../primitives/layer.tsx";
import { navigate } from "./routes.ts";
import { type Hit, useSearch } from "./Search.tsx";

export interface CommandKProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

/** Opens on the platform's shortcut; arrows move, Enter opens, Escape closes. */
export function CommandK({ open, onOpenChange }: CommandKProps) {
	const [query, setQuery] = useState("");
	const [selected, setSelected] = useState(0);
	const hits = useSearch(query);
	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);
	useEffect(() => setSelected(0), [query]);
	const layer = useTopLayer(open);
	const go = (hit: Hit | undefined) => {
		if (!hit) return;
		onOpenChange(false);
		navigate(hit.route);
	};
	return (
		<DialogPrimitive.Root open={open && layer !== undefined} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal container={layer}>
				<DialogPrimitive.Overlay className="kb-dialog-scrim" />
				<DialogPrimitive.Content className="kb-dialog kb-palette" aria-describedby={undefined} data-ref="search-dialog">
					<DialogPrimitive.Title className="kb-visually-hidden">Search</DialogPrimitive.Title>
					<input
						className="kb-palette__input"
						placeholder="Search bots, chats and pages"
						aria-label="Search"
						role="combobox"
						aria-expanded
						aria-controls="kb-palette-results"
						aria-activedescendant={hits[selected] ? `kb-hit-${selected}` : undefined}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "ArrowDown") {
								event.preventDefault();
								setSelected((i) => Math.min(hits.length - 1, i + 1));
							} else if (event.key === "ArrowUp") {
								event.preventDefault();
								setSelected((i) => Math.max(0, i - 1));
							} else if (event.key === "Enter") {
								event.preventDefault();
								go(hits[selected]);
							}
						}}
						data-ref="search-input"
					/>
					{hits.length === 0 ? (
						<div className="kb-palette__empty">{query ? "Nothing matches" : "No bots yet"}</div>
					) : (
						<ul className="kb-palette__results" id="kb-palette-results" role="listbox" aria-label="Results">
							{hits.map((hit, i) => (
								<li
									key={hit.key}
									id={`kb-hit-${i}`}
									className="kb-palette__result"
									role="option"
									aria-selected={i === selected}
									onMouseMove={() => setSelected(i)}
									onClick={() => go(hit)}
								>
									<HitIcon hit={hit} />
									<span className="kb-palette__result-text">
										<span>{hit.title}</span>
										{hit.snippet && <span className="kb-palette__result-snippet">{hit.snippet}</span>}
									</span>
								</li>
							))}
						</ul>
					)}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

function HitIcon({ hit }: { hit: Hit }) {
	const { data } = useBots();
	const bot =
		hit.route.name === "bot" && hit.kind === "bot"
			? data?.bots.find((b) => b.id === (hit.route as { botId: string }).botId)
			: undefined;
	if (bot) return <BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={24} />;
	const icons: Record<Hit["kind"], ReactNode> = {
		bot: <Hash size={16} />,
		group: <Users size={16} />,
		message: <MessageSquare size={16} />,
		page: <FileText size={16} />,
		skill: <Sparkles size={16} />,
	};
	return (
		<span
			style={{ display: "inline-flex", width: 24, justifyContent: "center", color: "var(--kb-color-text-secondary)" }}
		>
			{icons[hit.kind]}
		</span>
	);
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
