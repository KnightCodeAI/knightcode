// A bot's avatar: its shape's outline in its palette colour, with a face, drawn by bot-avatars.
import type { AvatarColorName, AvatarShape } from "@knightcode/bots-protocol";
import { BotAvatar, type BotAvatarState } from "bot-avatars";
import { useResolvedTheme } from "../theme.ts";
import { avatarColors } from "../tokens/tokens.ts";
import { SHAPE_OUTLINES } from "./shapes.ts";

export type AvatarState = "idle" | "working" | "sleeping";

const STATES: Record<AvatarState, BotAvatarState> = { idle: "default", working: "working", sleeping: "sleeping" };

export interface BotAvatarViewProps {
	shape: AvatarShape;
	color: AvatarColorName;
	state?: AvatarState;
	/** Rendered size in CSS pixels. */
	size: number;
	className?: string;
}

/** Draws one avatar. Marked `data-avatar` so screenshot comparisons can leave it out. */
export function BotAvatarView({ shape, color, state = "idle", size, className }: BotAvatarViewProps) {
	const theme = useResolvedTheme();
	const outline = SHAPE_OUTLINES[shape];
	return (
		<BotAvatar
			data-avatar=""
			className={className}
			type={outline.type}
			path={outline.path}
			face="eyes"
			shading="flat"
			color={avatarColors[theme][color]}
			// The palette colour as is: the library's default boost turns neutral grays red-brown.
			saturation={1}
			state={STATES[state]}
			size={size}
			aria-hidden
		/>
	);
}
