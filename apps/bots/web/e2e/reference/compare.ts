// Compares a KnightCode screen with the local reference measurements: every `data-ref` element's box (within 1 px)
// and its colour, font size, weight, line height, radius and shadow, then the whole screenshot (at most 0.5% of
// pixels differ, masked regions excluded). Skips when the reference folder is absent.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { REFERENCE_DIR } from "../../vite.config.ts";
import { MASK_COLOR, type MaskBox, paintMasksInPage } from "./masks.ts";

type Theme = "dark" | "light";

interface MeasuredElement {
	ref: string;
	box: { x: number; y: number; width: number; height: number };
	styles: Record<string, string>;
}

interface Measurement {
	screen: string;
	match: "full" | "chrome";
	viewport: { width: number; height: number };
	elements: MeasuredElement[];
	/** The boxes the reference capture painted over. */
	mask: MaskBox[];
}

/** How KnightCode reaches the state each reference screen shows. */
interface ScreenRoute {
	path: string;
	/** Actions after the page loads (opening a menu, typing in the composer). */
	steps?: (page: Page) => Promise<void>;
	/** KnightCode regions to leave out of the pixel comparison, matching the reference's masked regions. */
	mask?: string[];
	/** A seed variant from the reference folder (seed.<name>.json) instead of the reference seed. */
	seed?: string;
	/** Look refs up inside this element: the reference measured a stand-in card that shares its chrome. */
	scope?: string;
	/**
	 * Paint the reference's own mask boxes instead of `mask`: the reference shows a stand-in panel of another size there,
	 * so both sides cover exactly the same pixels.
	 */
	referenceMask?: boolean;
	/**
	 * Refs whose width follows text that differs by design (another setting's value, another category's name): their
	 * top and height are compared, and they must be anchored like the reference, at its left or its right edge.
	 */
	textSized?: string[];
}

const typeInComposer = (text: string) => async (page: Page) => {
	await page.getByRole("textbox", { name: "Message" }).click();
	await page.keyboard.type(text);
};

const AVATARS = "[data-avatar-box]";
const HIDE_TEXT = fileURLToPath(new URL("./hide-text.css", import.meta.url));
const TRANSCRIPT = '[data-ref="transcript"]';
const PANE = '[data-ref="info-pane"]';
const TABPANEL = '[data-ref="info-tabpanel"]';
const SETTINGS_BODY = '[data-ref="settings-body"]';
/** The open settings dialog's top-layer host: its refs, not the details pane's behind it. */
const SETTINGS_LAYER = ".kb-layer:popover-open";
/** Approval and takeover cards share the connect card's chrome, which is what the reference shows. */
const CONNECT_CARD = '[data-card="connect-app"]';

/** Screen id -> KnightCode route. Bot `finley` is the reference seed's bot. */
export const SCREENS: Record<string, ScreenRoute> = {
	shell: { path: "/bots/finley" },
	chat: { path: "/bots/finley?pane=closed" },
	"chat-streaming": { path: "/bots/finley?pane=closed", steps: typeInComposer("Review PR 12"), mask: [TRANSCRIPT] },
	"composer-mention": { path: "/bots/finley", steps: typeInComposer("@"), mask: [TRANSCRIPT, PANE] },
	"card-question": { path: "/bots/finley?pane=closed" },
	"card-approval": { path: "/bots/finley?pane=closed", mask: [TRANSCRIPT], scope: CONNECT_CARD },
	"card-takeover": { path: "/bots/finley?pane=closed", mask: [TRANSCRIPT], scope: CONNECT_CARD },
	"bot-create": { path: "/new", referenceMask: true },
	templates: { path: "/new?tab=templates", referenceMask: true },
	"bot-settings": { path: "/bots/finley/settings", textSized: ["settings-control"] },
	memory: { path: "/bots/finley/memory", referenceMask: true },
	computer: { path: "/bots/finley/computer" },
	"computer-takeover": { path: "/bots/finley/computer?control=1", referenceMask: true },
	teach: { path: "/bots/finley/computer?teach=1", referenceMask: true },
	catalog: {
		path: "/connectors",
		referenceMask: true,
		textSized: ["chip", "section-title", "app-connect", "search", "view-all"],
	},
	connector: { path: "/connectors/gmail", referenceMask: true, textSized: ["app-connect"] },
	skills: { path: "/skills", referenceMask: true, textSized: ["search"] },
	routines: { path: "/bots/finley/routines" },
	"routine-edit": { path: "/bots/finley/routines/new", referenceMask: true },
	activity: { path: "/activity", referenceMask: true },
	usage: { path: "/settings/usage", referenceMask: true },
	pages: { path: "/bots/finley/library" },
	page: { path: "/pages/weekly", referenceMask: true },
	inbox: { path: "/inbox", referenceMask: true },
	"catch-up": { path: "/?away=5h", referenceMask: true },
	group: { path: "/groups/launch", seed: "group", referenceMask: true },
	"settings-account": { path: "/settings/account", referenceMask: true, scope: SETTINGS_LAYER, textSized: ["settings-control", "kit-button", "settings-copy"] },
	"settings-approvals": { path: "/settings/approvals", referenceMask: true, scope: SETTINGS_LAYER, textSized: ["add-rule"] },
	"settings-vault": { path: "/settings/vault", referenceMask: true, scope: SETTINGS_LAYER, textSized: ["type-tabs", "type-tab", "type-tab-active"] },
	"settings-payments": { path: "/settings/payments", referenceMask: true, scope: SETTINGS_LAYER },
	"settings-channels": { path: "/settings/channels", referenceMask: true, scope: SETTINGS_LAYER },
	"settings-billing": { path: "/settings/billing", referenceMask: true, scope: SETTINGS_LAYER },
	onboarding: { path: "/bots/finley?pane=closed&onboarding=1", referenceMask: true },
	"x-account-menu": {
		path: "/bots/finley",
		steps: (page) => page.getByRole("button", { name: "Open account menu" }).click(),
	},
	"x-search": { path: "/bots/finley", steps: (page) => page.getByRole("button", { name: "Search" }).click() },
	"x-row-hover": { path: "/bots/finley", steps: (page) => page.locator('[data-ref="sidebar-row"]').first().hover() },
};

const STYLE_KEYS = [
	"color",
	"background",
	"fontSize",
	"fontWeight",
	"lineHeight",
	"borderRadius",
	"boxShadow",
] as const;
const VIEWPORTS: [number, number][] = [
	[1440, 900],
	[1280, 800],
];

/** Checks `screen` in both themes and both viewports. */
export async function compareToReference(page: Page, screen: string): Promise<void> {
	test.skip(!existsSync(resolve(REFERENCE_DIR, "measurements")), "no reference captures on this machine");
	const route = SCREENS[screen];
	if (!route) throw new Error(`no KnightCode route for reference screen "${screen}"`);
	for (const theme of ["dark", "light"] as const)
		for (const [width, height] of VIEWPORTS)
			await test.step(`${screen} ${theme} ${width}x${height}`, async () => {
				const name = `${screen}.${theme}.${width}x${height}`;
				const file = resolve(REFERENCE_DIR, "measurements", `${name}.json`);
				if (!existsSync(file)) return;
				const measurement = JSON.parse(readFileSync(file, "utf8")) as Measurement;
				await open(page, route, theme, width, height);
				const mismatches: string[] = [];
				for (const element of measurement.elements) mismatches.push(...(await compareElement(page, element, route)));
				expect.soft(mismatches, `${name}: elements that differ from the reference`).toEqual([]);
				// Already in Playwright's sanitized form (see maskedName in measure-reference.ts), so it is used as is.
				const css = readFileSync(HIDE_TEXT, "utf8");
				const targets = [AVATARS, ...(route.referenceMask ? [] : (route.mask ?? []))].map((selector) => ({ selector }));
				const boxes = route.referenceMask ? measurement.mask : [];
				await page.evaluate(paintMasksInPage, { targets, boxes, color: MASK_COLOR, css });
				await expect.soft(page).toHaveScreenshot(`${screen}-${theme}-${width}x${height}-masked.png`, {
					stylePath: HIDE_TEXT,
					maxDiffPixelRatio: 0.005,
				});
				await page.evaluate(paintMasksInPage, { targets: [], boxes: [], color: MASK_COLOR, css: null });
			});
}

async function open(page: Page, route: ScreenRoute, theme: Theme, width: number, height: number): Promise<void> {
	await page.setViewportSize({ width, height });
	await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
	const separator = route.path.includes("?") ? "&" : "?";
	await page.goto(`${route.path}${separator}seed=${route.seed ?? "reference"}`);
	await page.evaluate(() => document.fonts.ready);
	await route.steps?.(page);
	// The reference captures start with the transcript scrolled to the top, once its entries have arrived.
	await page.waitForFunction(() => {
		const transcript = document.querySelector('[data-ref="transcript"]');
		return !transcript || transcript.querySelector("[data-entry]") !== null;
	});
	await page.waitForTimeout(100);
	await page.evaluate(() => document.querySelector('[data-ref="transcript"]')?.scrollTo(0, 0));
	await page.mouse.move(width - 1, height - 1);
	await page.waitForTimeout(250);
}

/** What differs between our `data-ref` element and the measured one, as readable lines. */
async function compareElement(
	page: Page,
	element: MeasuredElement,
	{ scope, textSized }: ScreenRoute,
): Promise<string[]> {
	// An element may carry several refs, space-separated, when two reference screens name it differently.
	const ref = `[data-ref~="${element.ref}"]`;
	const ours = (scope ? page.locator(scope).locator(ref) : page.locator(ref)).first();
	if ((await ours.count()) === 0) return [`${element.ref}: missing data-ref`];
	const actual = await measure(ours);
	const out: string[] = [];
	const near = (a: number, b: number) => Math.abs(a - b) <= 1;
	const [mine, theirs] = [actual.box, element.box];
	const textual = textSized?.includes(element.ref);
	for (const side of textual ? (["y", "height"] as const) : (["x", "y", "width", "height"] as const))
		if (!near(mine[side], theirs[side]))
			out.push(`${element.ref} ${side}: ours ${round(mine[side])}, reference ${round(theirs[side])}`);
	if (textual && !near(mine.x, theirs.x) && !near(mine.x + mine.width, theirs.x + theirs.width))
		out.push(
			`${element.ref} anchor: ours ${round(mine.x)}..${round(mine.x + mine.width)}, reference ${round(theirs.x)}..${round(theirs.x + theirs.width)}`,
		);
	for (const key of STYLE_KEYS) {
		const [mine, theirs] = [normalize(actual.styles[key] ?? ""), normalize(element.styles[key] ?? "")];
		if (mine !== theirs) out.push(`${element.ref} ${key}: ours ${mine}, reference ${theirs}`);
	}
	return out;
}

const round = (n: number) => Math.round(n * 10) / 10;

async function measure(locator: Locator): Promise<{ box: MeasuredElement["box"]; styles: Record<string, string> }> {
	return locator.evaluate((el) => {
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		return {
			box: { x: r.x, y: r.y, width: r.width, height: r.height },
			styles: {
				color: cs.color,
				background: `${cs.backgroundColor} ${cs.backgroundImage}`.trim(),
				fontSize: cs.fontSize,
				fontWeight: cs.fontWeight,
				lineHeight: cs.lineHeight,
				borderRadius: cs.borderRadius,
				boxShadow: cs.boxShadow,
			},
		};
	});
}

/**
 * One spelling per value: `color(srgb ...)` becomes `rgba(...)`, numbers are rounded to two decimals, and a lone
 * transparent background image is dropped, so equal styles compare equal.
 */
export function normalize(value: string): string {
	return value
		.replace(
			/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g,
			(_, r: string, g: string, b: string, a?: string) =>
				a === undefined || a === "1"
					? `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})`
					: `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${a})`,
		)
		.replace(/ none$/, "")
		.replace(/-?\d*\.\d+/g, (n) => String(Math.round(Number(n) * 100) / 100))
		.trim();
}

const channel = (unit: string) => Math.round(Number(unit) * 255);
