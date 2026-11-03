// Mounts an animated avatar into a DOM element and keeps it running: frame loop, idle glances, hover gaze and pokes.
import { hashSeed } from "./math.ts";
import { type Body, createEngine, type Look, pointerGaze, type Poke } from "./motion.ts";
import { canvasScale, renderTree } from "./render.ts";
import { type AvatarState, createSequencer } from "./sequencer.ts";
import { patch } from "./svg.ts";

export interface AvatarOptions {
	/** Prefix for the SVG's element ids; unique per page. */
	id: string;
	/** Seeds the clip shuffle; defaults to `id`. */
	seed?: string;
	body: Body;
	state: AvatarState;
	/** The body colour, any CSS paint. */
	ink: string;
	/** The eye colour; eyes are cut out of the body when absent. */
	eye?: string;
	/** The avatar's box in CSS pixels. */
	size: number;
	/** How much of the canvas the body fills; the canvas overflows the box by `fill / 0.6`. */
	fill?: number;
	/** Plays the state's motion clips; otherwise the avatar rests. By default it plays every state but idle. */
	isPlaying?: boolean;
	/** A state played once before returning to `state`; a new `key` plays it again. */
	reaction?: AvatarReaction;
	/** Draws one settled frame and never animates. */
	isStatic?: boolean;
	/** Holds a surprised face when the state has none of its own. */
	isEmphasized?: boolean;
	/** Turns toward the pointer while it hovers. */
	isFollowingPointer?: boolean;
	/** Where hovering counts: the nearest ancestor matching this selector, read once at mount. Defaults to the avatar. */
	pointerArea?: string;
	/** Bounces when clicked. */
	isInteractive?: boolean;
	/** Blinks every 6–12 s while idle and resting. */
	hasIdleBehavior?: boolean;
	/** Includes a selection ring following the body's silhouette, styled by the picker. */
	hasOutline?: boolean;
	maxFrameRate?: number;
}

export interface AvatarReaction {
	state: AvatarState;
	key: number;
}

export interface AvatarController {
	readonly element: HTMLSpanElement;
	update(options: Partial<AvatarOptions>): void;
	blink(): void;
	look(direction: Look): void;
	poke(kind: Poke, options?: { turns?: number }): void;
	destroy(): void;
}

/** The product's fill: the body takes 92% of the box. */
export const DEFAULT_FILL = 0.92;
/** Below this size avatars use their compact clips. */
const COMPACT_BELOW = 48;
const STATIC_STEPS = 60;
const STATIC_STEP = 0.1;

const prefersReducedMotion = (view: Window): MediaQueryList | undefined =>
	view.matchMedia?.("(prefers-reduced-motion: reduce)");

/** The canvas extent as a share of the box. */
export const canvasExtent = (fill = DEFAULT_FILL): string => `${canvasScale(fill) * 100}%`;

export function mountAvatar(host: HTMLElement, initial: AvatarOptions): AvatarController {
	const doc = host.ownerDocument;
	const view = doc.defaultView!;
	let options = initial;
	const element = doc.createElement("span");
	const canvas = doc.createElement("span");
	element.className = "kb-avatar";
	canvas.className = "kb-avatar__canvas";
	element.style.cssText =
		"display:inline-grid;place-items:center;position:relative;vertical-align:middle;flex-shrink:0;overflow:visible;isolation:isolate;";
	canvas.style.cssText = "display:block;position:absolute;pointer-events:none;line-height:0;";
	canvas.setAttribute("aria-hidden", "true");
	element.append(canvas);

	const media = prefersReducedMotion(view);
	let isReduced = media?.matches ?? false;
	let isDead = false;
	let isHovered = false;

	const isStill = () => (options.isStatic ?? false) || isReduced;
	/** Whether `state` plays: idle rests (and blinks) unless asked to play. */
	const plays = (state: AvatarState) => (options.isPlaying ?? state !== "idle") && !isStill();

	const create = () => {
		// Gaze always on: a playing avatar leans toward the pointer too, and only while it is held.
		const e = createEngine({ body: options.body, isGazeAlways: true });
		const s = createSequencer(e, options.state, {
			seed: hashSeed(options.seed ?? options.id),
			isCompact: options.size < COMPACT_BELOW,
			isResting: !plays(options.state),
		});
		e.setBody(options.body, { isInstant: isStill() });
		s.setEmphasis(options.isEmphasized ?? false);
		return { engine: e, sequencer: s };
	};
	let { engine, sequencer } = create();
	const isPlaying = () => plays(sequencer.state);
	let wake: (() => void) | null = null;
	let stopLoop: (() => void) | null = null;

	const draw = () => {
		const resolution = Math.round(options.size * canvasScale(options.fill ?? DEFAULT_FILL) * 100) / 100;
		if (resolution <= 0) return;
		patch(
			canvas,
			renderTree(engine.frame(), { ink: options.ink, eye: options.eye }, resolution, options.id, {
				displaySize: options.size > 0 ? options.size : resolution,
				extent: "100%",
				hasOutline: options.hasOutline,
			}),
		);
	};

	const refresh = () => {
		if (isStill()) {
			engine.pause();
			engine.seek(0);
			for (let i = 0; i < STATIC_STEPS; i++) engine.advance(STATIC_STEP);
			draw();
		} else {
			draw();
			wake?.();
		}
	};

	const startLoop = (): (() => void) | null => {
		if (isStill()) return null;
		const interval = 1000 / Math.max(1, options.maxFrameRate ?? 60);
		let handle = 0;
		let last = 0;
		let isRunning = false;
		let isVisible = true;
		const tick = (now: number) => {
			handle = 0;
			if (now - last < interval - 1) {
				handle = view.requestAnimationFrame(tick);
				return;
			}
			const dt = (now - last) / 1000;
			last = now;
			if (!doc.hidden) {
				if (isPlaying()) {
					sequencer.advance(dt);
					// A bridge or reaction that handed back to idle: rest from here.
					if (!isPlaying()) {
						sequencer.setResting(true);
						decorate();
						scheduleIdle();
					}
				}
				engine.advance(dt);
			}
			draw();
			if (!isPlaying() && engine.isSettled) isRunning = false;
			else handle = view.requestAnimationFrame(tick);
		};
		const start = () => {
			if (!isRunning && isVisible) {
				isRunning = true;
				last = view.performance.now();
				handle = view.requestAnimationFrame(tick);
			}
		};
		const observer =
			typeof view.IntersectionObserver === "undefined"
				? null
				: new view.IntersectionObserver((entries) => {
						isVisible = entries.at(-1)?.isIntersecting ?? true;
						if (isVisible) start();
						else {
							view.cancelAnimationFrame(handle);
							handle = 0;
							isRunning = false;
						}
					});
		observer?.observe(element);
		wake = start;
		start();
		return () => {
			view.cancelAnimationFrame(handle);
			observer?.disconnect();
			wake = null;
		};
	};

	const restartLoop = () => {
		stopLoop?.();
		stopLoop = startLoop();
	};

	// At rest, an idle avatar blinks now and then, each on its own clock.
	let beat: number | undefined;
	const isIdle = () =>
		!isDead && options.hasIdleBehavior !== false && sequencer.state === "idle" && !isPlaying() && !isStill();
	const scheduleIdle = () => {
		view.clearTimeout(beat);
		if (!isIdle()) return;
		beat = view.setTimeout(
			() => {
				engine.blink();
				refresh();
				scheduleIdle();
			},
			6000 + Math.round(Math.random() * 6000),
		);
	};

	const decorate = () => {
		element.style.width = `${options.size}px`;
		element.style.height = `${options.size}px`;
		const extent = canvasExtent(options.fill);
		canvas.style.width = extent;
		canvas.style.height = extent;
		element.dataset.shape = options.body;
		element.dataset.state = options.state;
		element.dataset.playing = String(isPlaying());
		element.style.cursor = options.isInteractive ? "pointer" : "";
	};

	/** Builds a fresh engine for a new identity, keeping everything else. */
	const rebuild = () => {
		({ engine, sequencer } = create());
		restartLoop();
		refresh();
	};

	const onMotionChange = () => {
		isReduced = media?.matches ?? false;
		rebuild();
		decorate();
		scheduleIdle();
	};

	const onMove = (event: PointerEvent) => {
		if (!options.isFollowingPointer || isStill() || event.buttons !== 0) return;
		isHovered = true;
		engine.setGaze(pointerGaze(element.getBoundingClientRect(), { x: event.clientX, y: event.clientY }));
		// The frame loop draws the eased gaze; no need to draw on every move.
		wake?.();
	};
	const onLeave = () => {
		isHovered = false;
		if (!isReduced) {
			engine.setGaze(null);
			refresh();
		}
	};
	const onClick = () => {
		if (options.isInteractive && !isStill()) {
			engine.poke("bounce");
			refresh();
		}
	};

	const live = () => {
		if (isDead) throw new Error("This avatar has been destroyed");
	};

	decorate();
	host.append(element);
	const area: HTMLElement = (options.pointerArea && host.closest<HTMLElement>(options.pointerArea)) || element;
	refresh();
	stopLoop = startLoop();
	media?.addEventListener("change", onMotionChange);
	area.addEventListener("pointermove", onMove);
	area.addEventListener("pointerleave", onLeave);
	element.addEventListener("click", onClick);
	scheduleIdle();

	return {
		element,
		update(next) {
			live();
			const previous = options;
			const wasStill = isStill();
			const wasPlaying = isPlaying();
			options = { ...options, ...next };
			if (options.id !== previous.id || options.seed !== previous.seed) {
				rebuild();
			} else {
				if (options.body !== previous.body) {
					engine.setBody(options.body, { isInstant: isStill() });
					refresh();
				}
				if (options.state !== previous.state) {
					sequencer.setState(options.state);
					refresh();
				}
				if (options.reaction != null && options.reaction.key !== previous.reaction?.key) {
					sequencer.react(options.reaction.state);
					refresh();
				}
				if ((options.isEmphasized ?? false) !== (previous.isEmphasized ?? false)) {
					sequencer.setEmphasis(options.isEmphasized ?? false);
					refresh();
				}
				if (wasPlaying !== isPlaying()) {
					sequencer.setResting(!isPlaying());
					refresh();
				}
				if (
					options.ink !== previous.ink ||
					options.eye !== previous.eye ||
					options.fill !== previous.fill ||
					options.hasOutline !== previous.hasOutline
				)
					refresh();
				if (options.size !== previous.size) {
					sequencer.setCompact(options.size < COMPACT_BELOW);
					refresh();
				}
				if (wasStill !== isStill() || options.maxFrameRate !== previous.maxFrameRate) restartLoop();
			}
			if (!options.isFollowingPointer && isHovered) {
				isHovered = false;
				engine.setGaze(null);
			}
			decorate();
			scheduleIdle();
		},
		blink() {
			live();
			engine.blink();
			refresh();
		},
		look(direction) {
			live();
			engine.look(direction);
			refresh();
		},
		poke(kind, pokeOptions) {
			live();
			if (!isReduced) {
				engine.poke(kind, pokeOptions);
				refresh();
			}
		},
		destroy() {
			if (isDead) return;
			isDead = true;
			view.clearTimeout(beat);
			stopLoop?.();
			media?.removeEventListener("change", onMotionChange);
			area.removeEventListener("pointermove", onMove);
			area.removeEventListener("pointerleave", onLeave);
			element.removeEventListener("click", onClick);
			element.remove();
		},
	};
}
