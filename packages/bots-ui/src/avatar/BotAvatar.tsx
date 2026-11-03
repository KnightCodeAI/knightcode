// Which state an avatar shows for what the app knows (a bot's status, a live thread, a computer), the reactions it
// plays to what the user does, and the bot avatar that keeps itself current.
import type { Bot, ComputerState, ConversationView } from "@knightcode/bots-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { BotAvatarView, type BotAvatarViewProps } from "./BotAvatarView.tsx";
import type { AvatarReaction } from "./driver.ts";
import type { AvatarState } from "./sequencer.ts";

/** A bot's own state: asleep, waiting on the user, working, or at rest. */
export function botState(bot: Pick<Bot, "status" | "needsYou">): AvatarState {
	if (bot.status === "sleeping") return "sleeping";
	if (bot.needsYou) return "waiting";
	return bot.status === "working" ? "working" : "idle";
}

/** Most urgent first: when a turn shows several, the avatar shows the first. */
const URGENCY: readonly AvatarState[] = [
	"blocked",
	"waiting",
	"streaming",
	"spawning",
	"sending",
	"receiving",
	"thinking",
];

/**
 * What a live thread says, from its current turn (the entries after the user's last message): blocked on the user,
 * waiting on an answer, replying, running a helper, messaging another bot, or thinking. "loading" until the first
 * view; undefined when the turn says nothing. In a group, `botId` reads one member's entries only.
 */
export function threadState(view: ConversationView | undefined, botId?: string): AvatarState | undefined {
	if (!view) return "loading";
	const entries = view.entries;
	const turn = entries.slice(entries.findLastIndex((e) => e.kind === "message" && e.role === "user") + 1);
	const seen = new Set<AvatarState>();
	for (const entry of turn) {
		if (botId != null && (entry.kind === "message" || entry.kind === "card") && entry.botId !== botId) continue;
		if (entry.kind === "message" && entry.streaming) seen.add("streaming");
		if (entry.kind !== "card") continue;
		const card = entry.card;
		if (card.type === "approval" && card.approval.state === "pending") seen.add("waiting");
		if (card.type === "question" && card.answer === undefined) seen.add("waiting");
		if (card.type === "takeover" && card.state !== "released")
			seen.add(card.state === "requested" ? "blocked" : "waiting");
		if (card.type === "secret-request" && card.state === "open") seen.add("blocked");
		if (card.type === "helper" && card.state === "running") seen.add("spawning");
	}
	// A group's run belongs to whichever members are replying, so only a bot's own thread thinks while it runs.
	if (view.running && botId == null) {
		const last = turn.at(-1);
		if (last?.kind === "bot-message") seen.add(last.direction === "to" ? "sending" : "receiving");
		seen.add("thinking");
	}
	return URGENCY.find((state) => seen.has(state));
}

const COMPUTER_STATES: Record<ComputerState["status"], AvatarState> = {
	off: "sleeping",
	// Leaving "off" plays waking first.
	starting: "loading",
	awake: "loading",
	saving: "uploading",
	sleeping: "powering-down",
	restoring: "receiving",
	maintenance: "working",
	error: "failed",
};

/** A bot computer's state: asleep, starting, saving, restoring, mid-job, or failed. */
export function computerState(computer: ComputerState | undefined): AvatarState {
	return computer?.job ? "progress" : COMPUTER_STATES[computer?.status ?? "starting"];
}

/** How a bot takes each reaction the user can leave on its messages. */
export const EMOJI_REACTIONS: Record<string, AvatarState> = {
	"👍": "approving",
	"❤️": "shy",
	"😂": "laughing",
	"🎉": "celebrate",
	"👀": "curious",
	"🙏": "proud",
};

let reactions = 0;

/** A reaction to hand an avatar, and the function that plays a new one. */
export function useAvatarReaction(): [AvatarReaction | undefined, (state: AvatarState) => void] {
	const [reaction, setReaction] = useState<AvatarReaction>();
	const react = useCallback((state: AvatarState) => setReaction({ state, key: ++reactions }), []);
	return [reaction, react];
}

/** True for `ms` after the last poke (the user typing, say); re-renders only when it turns on or off. */
export function useMoment(ms = 1500): [boolean, () => void] {
	const [isOn, setOn] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);
	const poke = useCallback(() => {
		setOn(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setOn(false), ms);
	}, [ms]);
	return [isOn, poke];
}

export interface BotAvatarProps extends Omit<BotAvatarViewProps, "shape" | "color" | "state"> {
	bot: Bot;
	/** Shown instead of the bot's own state (a thread's, say). */
	state?: AvatarState;
}

/** A bot's avatar in its live state, calling out when a new message from it arrives. */
export function BotAvatar({ bot, state, reaction, ...props }: BotAvatarProps) {
	const [arrival, react] = useAvatarReaction();
	const unread = useRef(bot.unread);
	useEffect(() => {
		if (bot.unread > unread.current) react("notifying");
		unread.current = bot.unread;
	}, [bot.unread, react]);
	const latest = reaction && (!arrival || reaction.key > arrival.key) ? reaction : arrival;
	return (
		<BotAvatarView
			shape={bot.avatar.shape}
			color={bot.avatar.color}
			state={state ?? botState(bot)}
			reaction={latest}
			{...props}
		/>
	);
}
