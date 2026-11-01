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
	/** Actions once the screen has settled and the mouse is parked: hovers and menus, which a later move would undo. */
	interact?: (page: Page, measurement?: Measurement) => Promise<void>;
	/** Measured refs found by a selector rather than a `data-ref` (the third message, while hovered). */
	refs?: Record<string, string>;
	/** Measured refs that matched the wrong element when the reference was captured. */
	ignore?: string[];
	/** False when another screen already compares this state's pixels with its avatars masked (see x-avatar-picker). */
	pixels?: boolean;
}

/** The picker's measured refs, found by the buttons' names: shape-<name>, color-<name>-button and its swatch. */
function pickerRefs(): Record<string, string> {
	const shapes = ["blob", "cloud", "square", "sparkle", "clover", "heart", "flower", "teardrop", "tablet", "wedge", "house", "star", "hex"];
	const colors = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"];
	const refs: Record<string, string> = { "avatar-preview": ".kb-create__preview" };
	for (const shape of shapes) refs[`shape-${shape}`] = `button[aria-label="${shape} character shape"]`;
	for (const color of colors) {
		const button = `button[aria-label="${color[0]!.toUpperCase()}${color.slice(1)} character color"]`;
		refs[`color-${color}-button`] = button;
		refs[`color-${color}`] = `${button} > *`;
	}
	return refs;
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
	// The reference was captured with a prompt typed, not streaming: this compares the composer holding a draft. A
	// reply in progress is pinned by chat.e2e's own composer-streaming baseline.
	"chat-streaming": { path: "/bots/finley?pane=closed", steps: typeInComposer("Review PR 12"), mask: [TRANSCRIPT] },
	"composer-mention": { path: "/bots/finley", steps: typeInComposer("@"), mask: [TRANSCRIPT, PANE] },
	"card-question": { path: "/bots/finley?pane=closed" },
	// The reference has no approval or takeover card; its captures measure the connect-app card, so these compare the
	// card chrome all cards share. KnightCode's approval and takeover cards are pinned by chat.e2e's own baselines.
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
	// The reference has no onboarding checklist: its first-run screen is the chat with the connect-app card, which
	// this compares. The checklist is pinned by settings.e2e's own onboarding-checklist baseline.
	onboarding: { path: "/bots/finley?pane=closed&onboarding=1", referenceMask: true },
	// Interaction states: menus, hovers and the avatar picker, from the screen the reference resets to.
	"x-account-menu": {
		path: "/bots/finley",
		interact: (page) => page.getByRole("button", { name: "Open account menu" }).click(),
		// The reference's "menu-separator" selector matched its sidebar's resize handle (role=separator).
		refs: {
			menu: '[role="menu"]',
			"menu-item": '[role="menuitem"] >> nth=1',
			"menu-separator": '[data-ref="resize-handle"]',
		},
	},
	"x-menu-item-hover": {
		path: "/bots/finley",
		interact: async (page) => {
			await page.getByRole("button", { name: "Open account menu" }).click();
			await page.getByRole("menuitem").nth(1).hover();
		},
		refs: { "menu-item-hover": '[role="menuitem"] >> nth=1' },
	},
	"x-search": {
		path: "/bots/finley",
		interact: (page) => page.getByRole("button", { name: "Search" }).click(),
		// Capture misfires: "search-dialog" matched a select in the details pane and "search-input" a hidden 1 px input,
		// so this state is judged by its pixels.
		ignore: ["search-dialog", "search-input"],
	},
	"x-composer-menu": {
		path: "/bots/finley",
		interact: (page) => page.getByRole("button", { name: "Composer actions" }).click(),
		refs: { menu: '[role="menu"]', "menu-item": '[role="menuitem"] >> nth=0' },
	},
	"x-message-hover": {
		path: "/bots/finley?pane=closed",
		interact: (page) => page.locator('[data-ref="message"]').nth(2).hover(),
		// The reference's "message-action" matched its second button (Reply): its first is labelled without "React".
		refs: {
			"message-hover": '[data-ref="message"] >> nth=2',
			"message-actions": '.kb-entry:hover [data-ref="message-actions"]',
			"message-action": '.kb-entry:hover [data-ref="message-actions"] button >> nth=1',
		},
	},
	"x-row-hover": {
		path: "/bots/finley",
		interact: (page) => page.locator('[data-ref="sidebar-row"]').first().hover(),
		refs: { "sidebar-row-hover": '[data-ref="sidebar-row"]' },
	},
	"x-button-hover": {
		path: "/bots/finley",
		interact: (page) => page.getByRole("button", { name: "Connect apps" }).hover(),
		refs: { "connect-apps-hover": '[data-ref="connect-apps"]' },
	},
	"x-icon-button-hover": {
		path: "/bots/finley",
		interact: async (page) => {
			await page.getByRole("button", { name: "New Bot" }).hover();
			// The tooltip opens after its delay.
			await page.waitForTimeout(700);
		},
		refs: { "icon-button-hover": '[data-ref="sidebar-new"]', tooltip: '[data-ref="tooltip"]:visible' },
	},
	// The create dialog as bot-create shows it, whose capture masks the avatars and compares the pixels; this capture
	// keeps the avatars to look at by eye, so here only the shape and colour buttons' boxes are compared.
	"x-avatar-picker": {
		path: "/bots/finley",
		interact: async (page, measurement) => {
			await page.getByRole("button", { name: "New Bot" }).click();
			// The dialog picks a colour at random, and each reference capture got its own: choose the one whose swatch
			// wears the selection ring in this capture.
			const chosen = measurement?.elements.find(
				(element) => /^color-[a-z]+$/.test(element.ref) && element.styles.boxShadow !== "none",
			);
			const color = chosen?.ref.slice("color-".length) ?? "red";
			await page.getByRole("radio", { name: `${color[0]!.toUpperCase()}${color.slice(1)} character color` }).click();
		},
		refs: pickerRefs(),
		pixels: false,
	},
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
				await openScreen(page, screen, theme, width, height, measurement);
				const mismatches: string[] = [];
				for (const element of measurement.elements)
					if (!route.ignore?.includes(element.ref)) mismatches.push(...(await compareElement(page, element, route)));
				expect.soft(mismatches, `${name}: elements that differ from the reference`).toEqual([]);
				if (route.pixels === false) return;
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

/** Puts `page` in the state the reference shows for `screen` (for looking at it beside the capture). */
export async function openScreen(
	page: Page,
	screen: string,
	theme: Theme,
	width: number,
	height: number,
	measurement?: Measurement,
): Promise<void> {
	const route = SCREENS[screen];
	if (!route) throw new Error(`no KnightCode route for reference screen "${screen}"`);
	await open(page, route, theme, width, height);
	if (route.interact) {
		await route.interact(page, measurement);
		// Hover and open transitions run 150 to 300 ms.
		await page.waitForTimeout(400);
	}
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
	// Boxes are measured only once text is in its final font: the UI's faces are loaded explicitly (a status check can
	// pass before a busy page has asked for them), then layout gets two frames.
	await page.evaluate(async () => {
		await Promise.all([400, 500, 600].map((weight) => document.fonts.load(`${weight} 13px "Libre Franklin Variable"`)));
		await document.fonts.ready;
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await page.waitForFunction(() => [...document.images].every((image) => image.complete));
	// A view update that lands before the scroll event re-pins the transcript to the bottom, so the top is asserted
	// until it holds (a slow machine delivers the last update late).
	for (let attempt = 0; attempt < 10; attempt++) {
		const atTop = await page.evaluate(async () => {
			const transcript = document.querySelector('[data-ref="transcript"]');
			if (!transcript) return true;
			transcript.scrollTo(0, 0);
			await new Promise((resolve) => setTimeout(resolve, 150));
			return transcript.scrollTop === 0;
		});
		if (atTop) break;
	}
	await page.mouse.move(width - 1, height - 1);
	await page.waitForTimeout(250);
}

/** What differs between our `data-ref` element and the measured one, as readable lines. */
async function compareElement(
	page: Page,
	element: MeasuredElement,
	{ scope, textSized, refs }: ScreenRoute,
): Promise<string[]> {
	// An element may carry several refs, space-separated, when two reference screens name it differently.
	const ref = refs?.[element.ref] ?? `[data-ref~="${element.ref}"]`;
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
