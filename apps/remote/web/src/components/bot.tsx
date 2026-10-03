import { BotAvatar, type BotAvatarGlasses, type BotAvatarProps, botAvatarTypes } from "bot-avatars";
import type { SessionState } from "@/lib/api";
import { useResolvedTheme } from "@/lib/theme";

const GLASSES: BotAvatarGlasses[] = ["round", "square", "shades"];

/** FNV-1a: spreads even near-identical ids across the whole range. */
function hashOf(id: string): number {
	let hash = 2166136261;
	for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
	return hash;
}

/**
 * A random-looking but stable look per session: one of the shapes, and a mouth,
 * glasses and a bow tie on some of them and not others. Indexes the library's own shape
 * list, so a bot-avatars upgrade that adds shapes reshuffles every session's look once.
 */
export function lookFor(id: string): Pick<BotAvatarProps, "type" | "face" | "glasses" | "bowTie"> {
	const hash = hashOf(id);
	return {
		type: botAvatarTypes[hash % botAvatarTypes.length],
		face: (hash >>> 5) % 2 === 0 ? "eyes" : "mouth",
		glasses: (hash >>> 8) % 3 === 0 ? GLASSES[(hash >>> 11) % GLASSES.length] : "none",
		bowTie: (hash >>> 14) % 4 === 0,
	};
}

/**
 * The session mark: a small plastic bot. Looking around when a terminal is connected and idle,
 * hopping and spinning while a turn is running, asleep when nobody is attached. Decorative:
 * the row's text already says which session it is.
 */
export function SessionBot({
	id,
	state,
	size = 44,
}: {
	id: string;
	state: SessionState;
	size?: number;
}): React.JSX.Element {
	return (
		<BotAvatar
			{...lookFor(id)}
			shading="plastic"
			size={size}
			state={state === "working" ? "working" : state === "live" ? "default" : "sleeping"}
			theme={useResolvedTheme()}
			interactive={false}
			aria-hidden="true"
		/>
	);
}
