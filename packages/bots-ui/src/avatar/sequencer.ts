// The sequencer: turns a named state into clips, faces and overlays, and moves on when a state is timed.
import { CLIPS } from "./data/clips.ts";
import type { Expression } from "./face.ts";
import { random } from "./math.ts";
import type { ClipSource, Engine } from "./motion.ts";
import { type MorphTarget, shotSeconds } from "./morphs.ts";

/** Every state an avatar can show, grouped as the picker lists them. */
export const STATE_GROUPS = [
	{
		label: "Lifecycle",
		states: [
			"idle",
			"listening",
			"thinking",
			"streaming",
			"searching",
			"reading",
			"working",
			"coding",
			"running",
			"computing",
			"controlling",
			"waiting",
			"blocked",
			"finished",
			"failed",
			"sleeping",
			"waking",
		],
	},
	{
		label: "Reactions",
		states: [
			"happy",
			"excited",
			"laughing",
			"proud",
			"curious",
			"playful",
			"shy",
			"surprised",
			"suspicious",
			"angry",
			"confused",
			"sad",
			"drowsy",
			"bored",
			"scared",
			"celebrate",
			"approving",
		],
	},
	{
		label: "Morphs",
		states: [
			"orbit",
			"radar",
			"progress",
			"spawning",
			"loading",
			"dictating",
			"sending",
			"receiving",
			"uploading",
			"writing",
			"alerting",
			"bouncing",
			"powering-down",
		],
	},
	{ label: "Product", states: ["humming", "notifying", "dragging"] },
	{ label: "Brand", states: ["logo", "showcase", "turntable"] },
] as const;

export type AvatarState = (typeof STATE_GROUPS)[number]["states"][number];
export const AVATAR_STATES: readonly AvatarState[] = STATE_GROUPS.flatMap((group) => group.states);

interface StateSpec {
	clips: readonly string[];
	/** Clips for avatars under 48px, where small motions read better. */
	compactClips?: readonly string[];
	face?: Expression;
	morph?: MorphTarget;
	/** The state to move to: after `holdSeconds`, or else once every clip has played once. */
	next?: AvatarState;
	holdSeconds?: number;
}

const WORKING: StateSpec = { clips: ["Working_A", "Working_B", "Working_C", "Working_D", "Working_E", "Working_F"] };
const BLOCKED_FOR_SECONDS = 120;
/** The face an emphasised avatar holds when its state has none. */
const EMPHASIS_FACE: Expression = "surprised";

const STATES: Record<AvatarState, StateSpec> = {
	idle: { clips: ["Idle_B", "Idle_B", "Idle_D", "Idle_B", "Idle_A"], compactClips: ["Idle_B"] },
	listening: { clips: ["Idle_D"], face: "calm" },
	thinking: { clips: ["Idle_B"], morph: "thinking" },
	streaming: { clips: ["Streaming_A", "Streaming_B", "Streaming_C"] },
	searching: { clips: ["Idle_B"], morph: "radar" },
	reading: WORKING,
	working: WORKING,
	coding: WORKING,
	running: WORKING,
	computing: WORKING,
	controlling: WORKING,
	waiting: { clips: ["Idle_B"], morph: "orbit" },
	blocked: { clips: ["Blocked_A"], next: "drowsy", holdSeconds: BLOCKED_FOR_SECONDS },
	finished: { clips: ["Done_B", "Done_A"], face: "happy", next: "idle" },
	failed: { clips: ["Blocked_B"], next: "idle" },
	sleeping: { clips: ["Idle_B"], face: "sleepy" },
	waking: { clips: ["Idle_B"], face: "surprised", next: "idle", holdSeconds: 1.6 },
	happy: { clips: ["Done_A"] },
	excited: { clips: ["Done_C"] },
	laughing: { clips: ["Done_B"] },
	proud: { clips: ["Marketing_B"] },
	curious: { clips: ["Working_B"], face: "inspecting" },
	playful: { clips: ["Bodymoves_A"] },
	shy: { clips: ["Idle_D"], face: "calm" },
	surprised: { clips: ["Idle_B"], face: "surprised" },
	suspicious: { clips: ["Idle_D"], face: "squinted" },
	angry: { clips: ["Blocked_A"], face: "squinted" },
	confused: { clips: ["Blocked_A"] },
	sad: { clips: ["Blocked_B"] },
	drowsy: { clips: ["Blocked_C"] },
	bored: { clips: ["Idle_B"], face: "sleepy" },
	scared: { clips: ["Idle_D"], face: "surprised" },
	celebrate: { clips: ["Rotation_A"], face: "happy" },
	approving: { clips: ["Rotation_C"], next: "idle" },
	orbit: { clips: ["Idle_B"], morph: "orbit" },
	radar: { clips: ["Idle_B"], morph: "radar" },
	progress: { clips: ["Idle_B"], morph: "progress" },
	spawning: { clips: ["Idle_B"], morph: "spawning" },
	loading: { clips: ["Idle_B"], morph: "progress" },
	dictating: { clips: ["Idle_B"], morph: "dictating" },
	sending: { clips: ["Idle_B"], morph: "sending" },
	receiving: { clips: ["Idle_B"], morph: "receiving" },
	uploading: { clips: ["Idle_B"], morph: "uploading" },
	writing: { clips: ["Idle_B"], morph: "writing" },
	alerting: { clips: ["Idle_B"], morph: "alerting" },
	bouncing: { clips: ["Idle_B"], morph: "bouncing" },
	"powering-down": { clips: ["Idle_B"], morph: "powering-down" },
	humming: { clips: ["Idle_B"], face: "calm" },
	notifying: { clips: ["Done_B"], face: "surprised" },
	dragging: { clips: ["Idle_B"], face: "surprised" },
	logo: { clips: ["Logo_A", "Logo_B"] },
	showcase: { clips: ["Marketing_A", "Marketing_B", "Marketing_C", "Marketing_D"] },
	turntable: { clips: ["Rotation_B"] },
};

/** States that mean the bot is busy: leaving one for idle plays `finished` first. */
const BUSY: ReadonlySet<AvatarState> = new Set<AvatarState>([
	"thinking",
	"streaming",
	"searching",
	"reading",
	"working",
	"coding",
	"running",
	"computing",
	"controlling",
]);
const NEEDS_YOU: ReadonlySet<AvatarState> = new Set<AvatarState>(["waiting", "blocked"]);

/** The state played once on the way from `from` to `to`, if any: waking up, finishing, or calling for attention. */
export function bridgeState(from: AvatarState, to: AvatarState): AvatarState | null {
	const via =
		from === "sleeping" && to !== "sleeping"
			? "waking"
			: to === "idle" && BUSY.has(from)
				? "finished"
				: NEEDS_YOU.has(to) && !NEEDS_YOU.has(from)
					? "alerting"
					: null;
	return via === to ? null : via;
}

const CLIPS_BY_NAME = new Map(CLIPS.map((clip) => [clip.name, clip]));

function clipNamed(name: string): ClipSource {
	const clip = CLIPS_BY_NAME.get(name);
	if (clip == null) throw new Error(`No motion clip named ${name}`);
	return clip;
}

function swap<T>(items: T[], i: number, j: number): void {
	const a = items[i];
	const b = items[j];
	if (a !== undefined && b !== undefined) {
		items[i] = b;
		items[j] = a;
	}
}

/** A shuffled copy, rearranged so it does not open with the clip that just played. */
function shuffled(names: readonly string[], next: () => number, last: string | null): string[] {
	const items = [...names];
	for (let i = items.length - 1; i > 0; --i) swap(items, i, Math.floor(next() * (i + 1)));
	const first = items.findIndex((name) => name !== last);
	if (first > 0) swap(items, 0, first);
	return items;
}

export interface Sequencer {
	/** What plays now: the asked-for state, or a bridge or reaction on the way to it. */
	readonly state: AvatarState;
	/** Moves to `state`, through its bridge (`bridgeState`) when there is one. */
	setState(state: AvatarState): void;
	/** Plays `state` once, then returns to the asked-for state. */
	react(state: AvatarState): void;
	setCompact(isCompact: boolean): void;
	setEmphasis(isEmphasized: boolean): void;
	setResting(isResting: boolean): void;
	advance(dt: number): void;
}

export function createSequencer(
	engine: Engine,
	initial: AvatarState,
	options: { seed?: number; isCompact?: boolean; isResting?: boolean; firstPhase?: number } = {},
): Sequencer {
	const next = random(options.seed ?? 1);
	const decks = new Map<readonly string[], string[]>();
	let isCompact = options.isCompact ?? false;
	let isResting = options.isResting ?? false;
	let isEmphasized = false;
	let hasPlayed = isResting;
	let target = initial;
	let state = initial;
	let spec = STATES[initial];
	/** Where a bridge or reaction returns to, in place of the state's own `next`. */
	let returnTo: AvatarState | null = null;
	let elapsed = 0;
	let played = 0;
	let seenLoops = engine.loopCount;
	let lastClip: string | null = null;

	const clipList = () => (isCompact && spec.compactClips != null ? spec.compactClips : spec.clips);
	const after = () => returnTo ?? spec.next;
	// A morph stops the clip clock, so a morph played once (a bridge or reaction) lasts one shot of its overlay.
	const holdSeconds = () =>
		spec.holdSeconds ?? (returnTo != null && spec.morph != null ? shotSeconds(spec.morph) : undefined);
	const playsInOrder = () => after() != null && holdSeconds() == null;

	const draw = () => {
		const list = clipList();
		const deck = decks.get(list) ?? [];
		if (deck.length === 0) deck.push(...shuffled(list, next, lastClip));
		decks.set(list, deck);
		return deck.shift();
	};

	const loadNext = () => {
		const name = playsInOrder() ? clipList()[played] : draw();
		seenLoops = engine.loopCount;
		if (name === undefined || name === lastClip) return;
		const fromStart = hasPlayed || playsInOrder();
		engine.load(clipNamed(name), { phase: fromStart ? 0 : (options.firstPhase ?? next()) });
		hasPlayed = true;
		lastClip = name;
		seenLoops = engine.loopCount;
	};

	const holdFace = () => {
		engine.holdFace(spec.face ?? (isEmphasized ? EMPHASIS_FACE : null));
	};

	const enter = (next: AvatarState, then: AvatarState | null = null) => {
		state = next;
		spec = STATES[next];
		returnTo = then;
		elapsed = 0;
		played = 0;
		engine.setMorph(spec.morph ?? null);
		holdFace();
		if (!isResting) loadNext();
	};

	if (isResting) engine.rest();
	enter(initial);

	return {
		get state() {
			return state;
		},
		setState(next) {
			if (next === target) return;
			const via = bridgeState(target, next);
			target = next;
			if (via != null) enter(via, next);
			else enter(next);
		},
		react(reaction) {
			enter(reaction, target);
		},
		setCompact(value) {
			isCompact = value;
		},
		setEmphasis(value) {
			if (value !== isEmphasized) {
				isEmphasized = value;
				holdFace();
			}
		},
		setResting(value) {
			if (value !== isResting) {
				isResting = value;
				if (isResting) {
					engine.rest();
					lastClip = null;
				} else loadNext();
			}
		},
		advance(dt) {
			if (isResting) return;
			elapsed += dt;
			const then = after();
			const hold = holdSeconds();
			if (then != null && hold != null && elapsed >= hold) enter(then);
			else if (engine.loopCount !== seenLoops) {
				if (then != null && hold == null && (played += 1) >= clipList().length) enter(then);
				else loadNext();
			}
		},
	};
}
