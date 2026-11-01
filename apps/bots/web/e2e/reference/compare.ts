// Compares a KnightCode screen with the local reference measurements: every `data-ref` element's box (within 1 px)
// and its colour, font size, weight, line height, radius and shadow, then the whole screenshot (at most 0.5% of
// pixels differ, masked regions excluded). Skips when the reference folder is absent.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
}

const typeInComposer = (text: string) => async (page: Page) => {
	await page.getByRole("textbox", { name: "Message" }).click();
	await page.keyboard.type(text);
};

const AVATARS = "[data-avatar]";
const TRANSCRIPT = '[data-ref="transcript"]';
const PANE = '[data-ref="info-pane"]';
const TABPANEL = '[data-ref="info-tabpanel"]';
const SETTINGS_BODY = '[data-ref="settings-body"]';

/** Screen id -> KnightCode route. Bot `finley` is the reference seed's bot. */
export const SCREENS: Record<string, ScreenRoute> = {
	shell: { path: "/bots/finley" },
	chat: { path: "/bots/finley?pane=closed" },
	"chat-streaming": { path: "/bots/finley?pane=closed", steps: typeInComposer("Review PR 12"), mask: [TRANSCRIPT] },
	"composer-mention": { path: "/bots/finley", steps: typeInComposer("@"), mask: [TRANSCRIPT, PANE] },
	"card-question": { path: "/bots/finley?pane=closed" },
	"card-approval": { path: "/bots/finley?pane=closed", mask: [TRANSCRIPT] },
	"card-takeover": { path: "/bots/finley?pane=closed", mask: [TRANSCRIPT] },
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
	pages: { path: "/bots/finley/pages" },
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
				for (const element of measurement.elements) await compareElement(page, element);
				await expect.soft(page).toHaveScreenshot(`${name}.masked.png`, {
					mask: [AVATARS, ...(route.mask ?? [])].map((selector) => page.locator(selector)),
					maxDiffPixelRatio: 0.005,
				});
			});
}

async function open(page: Page, route: ScreenRoute, theme: Theme, width: number, height: number): Promise<void> {
	await page.setViewportSize({ width, height });
	await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
	const separator = route.path.includes("?") ? "&" : "?";
	await page.goto(`${route.path}${separator}seed=reference`);
	await page.evaluate(() => document.fonts.ready);
	await route.steps?.(page);
	await page.mouse.move(width - 1, height - 1);
	await page.waitForTimeout(250);
}

async function compareElement(page: Page, element: MeasuredElement): Promise<void> {
	const ours = page.locator(`[data-ref="${element.ref}"]`).first();
	if ((await ours.count()) === 0) {
		expect.soft(false, `missing data-ref="${element.ref}"`).toBe(true);
		return;
	}
	const actual = await measure(ours);
	for (const side of ["x", "y", "width", "height"] as const)
		expect.soft(Math.abs(actual.box[side] - element.box[side]), `${element.ref} ${side}: ours ${actual.box[side]}, reference ${element.box[side]}`).toBeLessThanOrEqual(1);
	for (const key of STYLE_KEYS)
		expect.soft(normalize(actual.styles[key] ?? ""), `${element.ref} ${key}`).toBe(normalize(element.styles[key] ?? ""));
}

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
