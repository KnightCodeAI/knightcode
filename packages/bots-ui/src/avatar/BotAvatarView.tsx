// A bot's avatar: its shape as a little 3D body in its palette colour, with eyes, animated for the bot's state.
import type { AvatarColorName, AvatarShape } from "@knightcode/bots-protocol";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { useResolvedTheme } from "../theme.ts";
import { avatarColors } from "../tokens/tokens.ts";
import { type AvatarController, type AvatarOptions, type AvatarReaction, mountAvatar } from "./driver.ts";
import type { Body } from "./motion.ts";
import type { AvatarState } from "./sequencer.ts";

export { AVATAR_STATES, type AvatarState, STATE_GROUPS } from "./sequencer.ts";

/** The engine body each named shape draws. */
export const SHAPE_BODIES: Record<AvatarShape, Body> = {
	blob: "sphere",
	pebble: "pebble",
	bean: "bean",
	egg: "egg",
	squircle: "squircle",
	tablet: "tablet",
	capsule: "capsule",
	cylinder: "cylinder",
	hex: "hex",
	gem: "gem",
	crystal: "crystal",
	wedge: "wedge",
	shield: "shield",
	dome: "dome",
	arch: "arch",
	cloud: "cloud",
	teardrop: "teardrop",
	leaf: "leaf",
	square: "square",
	sparkle: "sparkle",
	clover: "clover",
	flower: "starFlower",
	heart: "heartChubby",
	house: "house",
	star: "star6",
};

export interface BotAvatarViewProps {
	shape: AvatarShape;
	color: AvatarColorName;
	state?: AvatarState;
	/** Rendered size in CSS pixels. */
	size: number;
	className?: string;
	/** Plays the state's motion. By default every state but idle plays; idle rests and blinks now and then. */
	isPlaying?: boolean;
	/** A state played once before returning to `state`; see `useAvatarReaction`. */
	reaction?: AvatarReaction;
	/** Turns toward the pointer while it hovers. */
	isFollowingPointer?: boolean;
	/** Where hovering counts: the nearest ancestor matching this selector (read once at mount), else the avatar. */
	pointerArea?: string;
	/** Bounces when clicked. */
	isInteractive?: boolean;
	/** Includes a silhouette-following selection ring for the avatar picker. */
	hasOutline?: boolean;
}

/** Draws one avatar. Marked `data-avatar` so screenshot comparisons can leave it out. */
export function BotAvatarView({
	shape,
	color,
	state = "idle",
	size,
	className,
	isPlaying,
	reaction,
	isFollowingPointer = true,
	pointerArea,
	isInteractive = true,
	hasOutline = false,
}: BotAvatarViewProps) {
	const theme = useResolvedTheme();
	const id = `kb-avatar-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const host = useRef<HTMLSpanElement>(null);
	const avatar = useRef<AvatarController | null>(null);
	const options: AvatarOptions = {
		id,
		body: SHAPE_BODIES[shape],
		state,
		ink: avatarColors[theme][color],
		size,
		isPlaying,
		reaction,
		isFollowingPointer,
		pointerArea,
		isInteractive,
		hasOutline,
	};
	const latest = useRef(options);
	latest.current = options;

	// Mount before paint so the first frame never flashes empty; the driver owns the host's children from here.
	useLayoutEffect(() => {
		const mounted = mountAvatar(host.current!, latest.current);
		avatar.current = mounted;
		return () => {
			mounted.destroy();
			avatar.current = null;
		};
	}, []);

	useEffect(() => {
		avatar.current?.update(latest.current);
	});

	return (
		<span
			ref={host}
			data-avatar=""
			className={className}
			aria-hidden
			style={{
				display: "inline-block",
				position: "relative",
				verticalAlign: "middle",
				width: size,
				height: size,
				lineHeight: 0,
			}}
		/>
	);
}
