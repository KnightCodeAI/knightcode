// Measures a running reference UI over its DevTools port: one screenshot plus element boxes and computed styles per
// screen, theme and viewport. It reads the live DOM only, never the app's files.
//
// Run with Node, which strips the types (Bun's WebSocket cannot complete the DevTools handshake):
//   node apps/bots/scripts/measure-reference.ts <capture.json> <out-dir> [cdp-url] [screen-id ...]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CDPSession, chromium, type Page } from "@playwright/test";
import { MASK_COLOR, type MaskBox, type MaskTarget, paintMasksInPage } from "../web/e2e/reference/masks.ts";

/** One UI action on the running app. Selectors are Playwright locators. */
export type Step =
	| { click: string; nth?: number }
	| { hover: string; nth?: number }
	| { key: string }
	| { type: string }
	| { wait: number }
	| { eval: string };

export type Theme = "dark" | "light";

/** A measured element: a locator, or a locator and which of its matches. */
export type RefTarget = string | { selector: string; nth: number };

export interface CaptureScreen {
	/** The screen id the KnightCode reference tests use. */
	id: string;
	steps: Step[];
	/** `ref` name -> element. KnightCode marks its matching element with `data-ref="<name>"`. */
	refs: Record<string, RefTarget>;
	/** "full": geometry, styles and pixels; "chrome": only the shared chrome refs and the unmasked region. */
	match: "full" | "chrome";
	/** Regions left out of the pixel comparison (avatars, and for "chrome" screens the content area). */
	mask?: RefTarget[];
	themes?: Theme[];
}

export interface Capture {
	viewports: [number, number][];
	/** Brings the app back to its home state before each screen. */
	reset: Step[];
	/** Switches the app to a theme; `restore` puts the user's setting back at the end. */
	themes: Record<Theme, Step[]>;
	restore: Step[];
	screens: CaptureScreen[];
}

export interface MeasuredElement {
	ref: string;
	box: { x: number; y: number; width: number; height: number };
	styles: Record<(typeof STYLE_KEYS)[number], string>;
}

export interface Measurement {
	screen: string;
	theme: Theme;
	match: "full" | "chrome";
	viewport: { width: number; height: number };
	elements: MeasuredElement[];
	mask: MaskBox[];
}

const STYLE_KEYS = [
	"color",
	"background",
	"fontFamily",
	"fontSize",
	"fontWeight",
	"lineHeight",
	"letterSpacing",
	"borderRadius",
	"border",
	"boxShadow",
	"padding",
	"gap",
	"opacity",
	"transition",
	"animation",
] as const;

/** Captures every screen of `capture` at every viewport and theme into `out/screens` and `out/measurements`. */
export async function measureReference(options: {
	cdpUrl: string;
	capture: string;
	out: string;
	only?: string[];
}): Promise<void> {
	const capture = JSON.parse(readFileSync(options.capture, "utf8")) as Capture;
	mkdirSync(join(options.out, "screens"), { recursive: true });
	mkdirSync(join(options.out, "measurements"), { recursive: true });
	const browser = await chromium.connectOverCDP(options.cdpUrl);
	const page = browser.contexts()[0]?.pages()[0];
	if (!page) throw new Error("the app has no page open");
	const session = await page.context().newCDPSession(page);
	const screens = capture.screens.filter((s) => !options.only?.length || options.only.includes(s.id));
	try {
		for (const theme of ["dark", "light"] as const) {
			await run(page, capture.reset);
			await run(page, capture.themes[theme]);
			for (const [width, height] of capture.viewports) {
				await setViewport(page, session, width, height);
				for (const screen of screens) {
					if (screen.themes && !screen.themes.includes(theme)) continue;
					await run(page, capture.reset);
					await run(page, screen.steps);
					await settle(page);
					const name = `${screen.id}.${theme}.${width}x${height}`;
					const { data } = (await session.send("Page.captureScreenshot", { format: "png" })) as { data: string };
					writeFileSync(join(options.out, "screens", `${name}.png`), Buffer.from(data, "base64"));
					const elements = await measureRefs(page, screen.refs);
					// The same screen with every masked element covered, as the comparison paints KnightCode's side.
					const targets: MaskTarget[] = (screen.mask ?? []).map((t) => (typeof t === "string" ? { selector: t } : t));
					const mask = await page.evaluate(paintMasksInPage, {
						targets,
						boxes: [],
						color: MASK_COLOR,
						css: HIDE_TEXT_CSS,
					});
					const masked = (await session.send("Page.captureScreenshot", { format: "png" })) as { data: string };
					writeFileSync(
						join(options.out, "screens", maskedName(screen.id, theme, width, height)),
						Buffer.from(masked.data, "base64"),
					);
					await page.evaluate(paintMasksInPage, { targets: [], boxes: [], color: MASK_COLOR, css: null });
					const measurement: Measurement = {
						screen: screen.id,
						theme,
						match: screen.match,
						viewport: { width, height },
						elements,
						mask,
					};
					writeFileSync(
						join(options.out, "measurements", `${name}.json`),
						`${JSON.stringify(measurement, null, "\t")}\n`,
					);
					// The whole visible tree, for building parts no ref names, at the main viewport only (it is large).
					if (width === capture.viewports[0]?.[0])
						writeFileSync(
							join(options.out, "measurements", `${name}.tree.json`),
							JSON.stringify(await measureTree(page)),
						);
					console.log(`${name}: ${measurement.elements.length}/${Object.keys(screen.refs).length} refs`);
				}
			}
		}
	} finally {
		await run(page, capture.reset).catch(() => undefined);
		await run(page, capture.restore).catch((error: unknown) => console.error("restore failed:", error));
		await session.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined);
		await browser.close();
	}
}

/**
 * Renders the page at `width` x `height` CSS pixels and a device pixel ratio of 1, which is how Playwright renders
 * KnightCode. The reference may zoom its page; that zoom is divided back out.
 */
async function setViewport(page: Page, session: CDPSession, width: number, height: number): Promise<void> {
	await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
	await page.waitForTimeout(200);
	const zoom = await page.evaluate(() => window.devicePixelRatio);
	await session.send("Emulation.setDeviceMetricsOverride", {
		width: Math.round(width * zoom),
		height: Math.round(height * zoom),
		deviceScaleFactor: 1 / zoom,
		mobile: false,
	});
	await page.waitForTimeout(300);
	const inner = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
	if (inner[0] !== width || inner[1] !== height)
		throw new Error(`viewport is ${inner.join("x")}, wanted ${width}x${height}`);
}

async function run(page: Page, steps: Step[]): Promise<void> {
	for (const step of steps) {
		if ("click" in step)
			await page
				.locator(step.click)
				.nth(step.nth ?? 0)
				.click({ timeout: 5_000 });
		else if ("hover" in step)
			await page
				.locator(step.hover)
				.nth(step.nth ?? 0)
				.hover({ timeout: 5_000 });
		else if ("key" in step) await page.keyboard.press(step.key);
		else if ("type" in step) await page.keyboard.type(step.type);
		else if ("wait" in step) await page.waitForTimeout(step.wait);
		else await page.evaluate(step.eval);
	}
}

/** Waits for running CSS animations and transitions to finish, so captures are stable. */
async function settle(page: Page): Promise<void> {
	await page.waitForTimeout(150);
	await page.evaluate(() =>
		Promise.all(
			document
				.getAnimations()
				.filter((a) => a.effect?.getTiming().iterations !== Infinity)
				.map((a) => a.finished.catch(() => undefined)),
		),
	);
	await page.waitForTimeout(100);
}

/**
 * The masked capture's file name. Playwright sanitizes snapshot names (dots become dashes), so the name is written
 * in its sanitized form and comparisons ask for exactly this name.
 */
export function maskedName(screen: string, theme: Theme, width: number, height: number): string {
	return `${screen}-${theme}-${width}x${height}-masked.png`;
}

/** The stylesheet that hides text and icon glyphs in masked captures; the comparison injects the same file. */
const HIDE_TEXT_CSS = readFileSync(new URL("../web/e2e/reference/hide-text.css", import.meta.url), "utf8");

function locate(page: Page, target: RefTarget) {
	return typeof target === "string" ? page.locator(target).first() : page.locator(target.selector).nth(target.nth);
}

async function measureRefs(page: Page, refs: CaptureScreen["refs"]): Promise<MeasuredElement[]> {
	const measured: MeasuredElement[] = [];
	for (const [ref, target] of Object.entries(refs)) {
		const element = locate(page, target);
		if ((await element.count()) === 0) {
			console.warn(`  missing ref ${ref}`);
			continue;
		}
		const result = await element.evaluate(
			(el, keys) => {
				const r = el.getBoundingClientRect();
				const cs = getComputedStyle(el);
				const read: Record<string, string> = {
					background: `${cs.backgroundColor} ${cs.backgroundImage}`.trim(),
					border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
				};
				const styles = Object.fromEntries(
					keys.map((key) => [
						key,
						read[key] ?? cs.getPropertyValue(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
					]),
				);
				return { box: { x: r.x, y: r.y, width: r.width, height: r.height }, styles };
			},
			STYLE_KEYS as unknown as string[],
		);
		measured.push({ ref, box: result.box, styles: result.styles as MeasuredElement["styles"] });
	}
	return measured;
}

/** One visible element of a screen: where it is, what it is, and how it is styled. */
export interface TreeNode {
	depth: number;
	tag: string;
	/** Class names that read as words; generated hash classes are dropped. */
	names: string[];
	role?: string;
	label?: string;
	text?: string;
	box: [number, number, number, number];
	styles: Record<string, string>;
}

const TREE_KEYS = [
	...STYLE_KEYS,
	"display",
	"position",
	"flexDirection",
	"alignItems",
	"justifyContent",
	"textAlign",
	"whiteSpace",
	"overflow",
	"cursor",
	"zIndex",
	"backdropFilter",
	"filter",
	"transform",
	"outline",
	"textTransform",
	"fontFeatureSettings",
	"fontVariantNumeric",
] as const;

async function measureTree(page: Page): Promise<TreeNode[]> {
	return page.evaluate(
		(keys) => {
			const nodes: TreeNode[] = [];
			const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
			const walk = (el: Element, depth: number) => {
				const cs = getComputedStyle(el);
				if (cs.display === "contents") {
					for (const child of el.children) walk(child, depth);
					return;
				}
				if (cs.display === "none") return;
				const r = el.getBoundingClientRect();
				// Zero-size wrappers (portal hosts, positioned shells) and hidden parents can hold visible children.
				if (cs.visibility === "hidden" || r.width === 0 || r.height === 0) {
					for (const child of el.children) walk(child, depth);
					return;
				}
				const own = [...el.childNodes]
					.filter((n) => n.nodeType === Node.TEXT_NODE)
					.map((n) => n.textContent?.trim() ?? "")
					.join(" ")
					.slice(0, 80);
				const styles: Record<string, string> = {};
				for (const key of keys) {
					const value =
						key === "background" ? `${cs.backgroundColor} ${cs.backgroundImage}` : cs.getPropertyValue(kebab(key));
					if (
						value &&
						value !== "none" &&
						value !== "normal" &&
						value !== "auto" &&
						value !== "0px" &&
						value !== "rgba(0, 0, 0, 0) none"
					)
						styles[key] = value;
				}
				nodes.push({
					depth,
					tag: el.tagName.toLowerCase(),
					names: [...el.classList].filter((c) => !/^[a-z]+-[0-9a-z]{4,8}$/.test(c) || !/\d/.test(c)),
					role: el.getAttribute("role") ?? undefined,
					label: el.getAttribute("aria-label") ?? undefined,
					text: own || undefined,
					box: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10) as TreeNode["box"],
					styles,
				});
				for (const child of el.children) walk(child, depth + 1);
			};
			walk(document.body, 0);
			return nodes;
		},
		TREE_KEYS as unknown as string[],
	);
}

if (process.argv[1]?.endsWith("measure-reference.ts")) {
	const [capture, out, cdpUrl = "http://127.0.0.1:9333", ...only] = process.argv.slice(2);
	if (!capture || !out)
		throw new Error("usage: node measure-reference.ts <capture.json> <out-dir> [cdp-url] [screen-id ...]");
	await measureReference({ cdpUrl, capture, out, only });
}
