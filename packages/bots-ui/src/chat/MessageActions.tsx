// A message's hover toolbar (react, reply, more) and its reactions.
import type { Entry } from "@knightcode/bots-protocol";
import { Copy, MoreHorizontal, Quote, Reply, SmilePlus } from "lucide-react";
import { Menu, MenuItem } from "../primitives/Menu.tsx";
import { Popover } from "../primitives/Popover.tsx";

type MessageEntry = Extract<Entry, { kind: "message" }>;

const EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "🙏"];

export interface MessageActionHandlers {
	react: (entryId: string, emoji: string) => void;
	reply: (entry: MessageEntry) => void;
	quote: (text: string) => void;
}

/** Appears beside the bubble on hover or keyboard focus. */
export function MessageActions({
	entry,
	speaker,
	handlers,
}: {
	entry: MessageEntry;
	speaker: string;
	handlers: MessageActionHandlers;
}) {
	const selectionIn = () => {
		const selection = window.getSelection();
		const text = selection?.toString().trim();
		const node = selection?.anchorNode;
		const bubble = node
			? (node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement)?.closest(
					`[data-entry="${entry.id}"]`,
				)
			: null;
		return text && bubble ? text : undefined;
	};
	return (
		<div className="kb-hover-actions" role="toolbar" aria-label={`Message actions for ${speaker} message`}>
			<Popover
				label="Reactions"
				side="top"
				trigger={
					<button type="button" className="kb-hover-actions__button" aria-label="Add reaction">
						<SmilePlus size={14} strokeWidth={1.75} />
					</button>
				}
			>
				<div className="kb-emoji" role="group" aria-label="Pick a reaction">
					{EMOJI.map((emoji) => (
						<button
							key={emoji}
							type="button"
							className="kb-emoji__button"
							aria-label={`React ${emoji}`}
							onClick={() => handlers.react(entry.id, emoji)}
						>
							{emoji}
						</button>
					))}
				</div>
			</Popover>
			<button
				type="button"
				className="kb-hover-actions__button"
				aria-label={`Reply to ${speaker} message`}
				onClick={() => handlers.reply(entry)}
			>
				<Reply size={14} strokeWidth={1.75} />
			</button>
			<Menu
				label="More message actions"
				align="end"
				trigger={
					<button type="button" className="kb-hover-actions__button" aria-label="More message actions">
						<MoreHorizontal size={14} strokeWidth={1.75} />
					</button>
				}
			>
				<MenuItem icon={<Copy size={14} />} onSelect={() => void navigator.clipboard?.writeText(entry.text)}>
					Copy
				</MenuItem>
				<MenuItem icon={<Quote size={14} />} onSelect={() => handlers.quote(selectionIn() ?? entry.text)}>
					Quote
				</MenuItem>
			</Menu>
		</div>
	);
}

/** Reaction chips under a bubble; clicking one toggles your own. */
export function Reactions({ entry, onReact }: { entry: MessageEntry; onReact: (emoji: string) => void }) {
	if (!entry.reactions?.length) return null;
	return (
		<div className="kb-reactions">
			{entry.reactions.map((reaction) => (
				<button
					key={reaction.emoji}
					type="button"
					className="kb-reaction"
					aria-pressed={reaction.mine}
					aria-label={`${reaction.emoji} ${reaction.count}`}
					onClick={() => onReact(reaction.emoji)}
				>
					<span>{reaction.emoji}</span>
					<span className="kb-reaction__count">{reaction.count}</span>
				</button>
			))}
		</div>
	);
}
