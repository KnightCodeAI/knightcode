// Compares a KnightCode screen with the local reference measurements: every `data-ref` element's box (within 1 px)
// and its colour, font size, weight, line height, radius and shadow, then the whole screenshot (at most 0.5% of
// pixels differ, masked regions excluded). Skips when the reference folder is absent.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { REFERENCE_DIR } from "../../vite.config.ts";

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
}

/** How KnightCode reaches the state each reference screen shows. */
interface ScreenRoute {
	path: string;
	/** Actions after the page loads (opening a menu, typing in the composer). */
	steps?: (page: Page) => Promise<void>;
	/** KnightCode regions to leave out of the pixel comparison, matching the reference's masked regions. */
	mask?: string[];
	/** Look refs up inside this element: the reference measured a stand-in card that shares its chrome. */
	scope?: string;
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
	"bot-create": { path: "/new" },
	templates: { path: "/new?tab=templates", mask: ['[data-ref="dialog-body"]'] },
	"bot-settings": { path: "/bots/finley/settings" },
	memory: { path: "/bots/finley/memory", mask: [TABPANEL] },
	computer: { path: "/bots/finley/computer", mask: ['[data-ref="screen-viewer"]'] },
	"computer-takeover": { path: "/bots/finley/computer?control=1", mask: [TABPANEL] },
	teach: { path: "/bots/finley/computer?teach=1", mask: [TABPANEL] },
	catalog: { path: "/connectors" },
	connector: { path: "/connectors/gmail", mask: ['[data-ref="dialog-body"]'] },
	skills: { path: "/skills" },
	routines: { path: "/bots/finley/routines" },
	"routine-edit": { path: "/bots/finley/routines/new", mask: [TABPANEL] },
	activity: { path: "/activity", mask: [SETTINGS_BODY] },
	usage: { path: "/settings/usage" },
	pages: { path: "/bots/finley/library" },
	page: { path: "/pages/weekly", mask: [TRANSCRIPT, TABPANEL] },
	inbox: { path: "/inbox", mask: [TRANSCRIPT, PANE] },
	"catch-up": { path: "/?away=5h", mask: [TRANSCRIPT, PANE] },
	group: { path: "/groups/launch", mask: [TRANSCRIPT, '[data-ref="chat-header"]'] },
	"settings-account": { path: "/settings/account" },
	"settings-approvals": { path: "/settings/approvals" },
	"settings-vault": { path: "/settings/vault" },
	"settings-payments": { path: "/settings/payments", mask: [SETTINGS_BODY, '[data-ref="settings-nav"]'] },
	"settings-channels": { path: "/settings/channels", mask: [SETTINGS_BODY, '[data-ref="settings-nav"]'] },
	"settings-billing": { path: "/settings/billing" },
	onboarding: { path: "/bots/finley?pane=closed&onboarding=1", mask: [TRANSCRIPT] },
	"x-account-menu": { path: "/bots/finley", steps: (page) => page.getByRole("button", { name: "Open account menu" }).click() },
	"x-search": { path: "/bots/finley", steps: (page) => page.getByRole("button", { name: "Search" }).click() },
	"x-row-hover": { path: "/bots/finley", steps: (page) => page.locator('[data-ref="sidebar-row"]').first().hover() },
};

const STYLE_KEYS = ["color", "background", "fontSize", "fontWeight", "lineHeight", "borderRadius", "boxShadow"] as const;
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
				for (const element of measurement.elements) mismatches.push(...(await compareElement(page, element, route.scope)));
				expect.soft(mismatches, `${name}: elements that differ from the reference`).toEqual([]);
				// Already in Playwright's sanitized form (see maskedName in measure-reference.ts), so it is used as is.
				await paintMasks(page, [AVATARS, ...(route.mask ?? [])]);
				await expect.soft(page).toHaveScreenshot(`${screen}-${theme}-${width}x${height}-masked.png`, {
					stylePath: HIDE_TEXT,
					maxDiffPixelRatio: 0.005,
				});
				await paintMasks(page, []);
			});
}

async function open(page: Page, route: ScreenRoute, theme: Theme, width: number, height: number): Promise<void> {
	await page.setViewportSize({ width, height });
	await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
	const separator = route.path.includes("?") ? "&" : "?";
	await page.goto(`${route.path}${separator}seed=reference`);
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

/**
 * Covers every element matching `selectors` with a solid box, exactly as the reference capture did: fixed boxes at the
 * top z-index, which top-layer content (popovers, open dialogs) still paints above. Playwright's own `mask` would
 * also cover the top layer. An empty list removes the boxes.
 */
async function paintMasks(page: Page, selectors: string[]): Promise<void> {
	await page.evaluate((selectors) => {
		for (const old of document.querySelectorAll("[data-compare-mask]")) old.remove();
		for (const selector of selectors)
			for (const element of document.querySelectorAll(selector)) {
				const box = element.getBoundingClientRect();
				if (box.width === 0 || box.height === 0) continue;
				const div = document.createElement("div");
				div.setAttribute("data-compare-mask", "");
				div.style.cssText = `position:fixed;left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;background:#FF00FF;z-index:2147483647;pointer-events:none`;
				document.body.append(div);
			}
	}, selectors);
}

/** What differs between our `data-ref` element and the measured one, as readable lines. */
async function compareElement(page: Page, element: MeasuredElement, scope?: string): Promise<string[]> {
	// An element may carry several refs, space-separated, when two reference screens name it differently.
	const ref = `[data-ref~="${element.ref}"]`;
	const ours = (scope ? page.locator(scope).locator(ref) : page.locator(ref)).first();
	if ((await ours.count()) === 0) return [`${element.ref}: missing data-ref`];
	const actual = await measure(ours);
	const out: string[] = [];
	for (const side of ["x", "y", "width", "height"] as const)
		if (Math.abs(actual.box[side] - element.box[side]) > 1) out.push(`${element.ref} ${side}: ours ${round(actual.box[side])}, reference ${round(element.box[side])}`);
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
		.replace(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/g, (_, r: string, g: string, b: string, a?: string) =>
			a === undefined || a === "1" ? `rgb(${channel(r)}, ${channel(g)}, ${channel(b)})` : `rgba(${channel(r)}, ${channel(g)}, ${channel(b)}, ${a})`,
		)
		.replace(/ none$/, "")
		.replace(/-?\d*\.\d+/g, (n) => String(Math.round(Number(n) * 100) / 100))
		.trim();
}

const channel = (unit: string) => Math.round(Number(unit) * 255);
