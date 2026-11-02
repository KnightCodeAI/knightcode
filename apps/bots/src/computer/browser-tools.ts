// Browser and desktop tools for bots (spec section 7): a page snapshot with element references, acting on a reference,
// navigation, and desktop screenshots and input as the fallback. Logins are filled from the vault on the server: the
// model names a vault item, never sees its value, and the filled fields are masked in screenshots and snapshots.
// Identical consecutive screenshots are not sent again.
import { defineTool } from "@knightcode/durable";
import { arr, lit, num, obj, opt, str, union } from "@knightcode/schema";

/** What the bridge's /browser endpoint takes (computer/bridge/browser.ts implements it). */
export type BrowserRequest =
	| { action: "snapshot" }
	| { action: "navigate"; url: string }
	| { action: "act"; ref: string; do: "click" | "type" | "select" | "press" | "hover"; text?: string }
	/** Types a secret into `ref` and masks the field; the secret never comes back. */
	| { action: "fill"; ref: string; secret: string }
	| { action: "location" };

export type BrowserResult = { url?: string; title?: string; snapshot?: string; error?: string };

/** What the bridge's /desktop endpoint takes. */
export type DesktopRequest =
	| { action: "screenshot" }
	| { action: "click" | "double_click" | "move"; x: number; y: number }
	| { action: "type"; text: string }
	| { action: "key"; keys: string[] }
	| { action: "scroll"; x: number; y: number; dy: number };

export type DesktopResult = { image?: { data: string; mimeType: string }; unchanged?: boolean; error?: string };

/** How a bot's tools reach its computer (the bot object, through the computer object). */
export interface ComputerAccess {
	browser(request: BrowserRequest): Promise<BrowserResult>;
	desktop(request: DesktopRequest): Promise<DesktopResult>;
	/** Fills a login field from vault item `item`, checking the page's origin against the item's. */
	fillLogin(ref: string, item: string, field: "username" | "password"): Promise<BrowserResult>;
}

const text = (value: unknown, isError = false) => ({
	output: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
	...(isError ? { isError } : {}),
});

const browserOutput = (result: BrowserResult) =>
	result.error ? text(result.error, true) : text([result.url && `URL: ${result.url}`, result.title && `Title: ${result.title}`, result.snapshot].filter(Boolean).join("\n"));

const desktopOutput = (result: DesktopResult) => {
	if (result.error) return text(result.error, true);
	if (result.unchanged) return text("The screen has not changed since the last screenshot.");
	if (!result.image) return text("Done.");
	return { output: [{ type: "image" as const, data: result.image.data, mimeType: result.image.mimeType }] };
};

export function computerTools(computer: ComputerAccess) {
	return [
		defineTool({
			name: "browser_snapshot",
			description: "See the current page in your browser as text, with a ref for each element you can act on.",
			parameters: obj({}),
			execute: async () => browserOutput(await computer.browser({ action: "snapshot" })),
		}),
		defineTool({
			name: "browser_navigate",
			description: "Open a URL in your browser.",
			parameters: obj({ url: str() }),
			execute: async ({ url }) => browserOutput(await computer.browser({ action: "navigate", url })),
		}),
		defineTool({
			name: "browser_act",
			description:
				"Act on an element from browser_snapshot by its ref: click, type text, select an option, press a key or hover. To sign in, use vaultItem with field username or password; the value is filled for you and never shown.",
			parameters: obj({
				ref: str(),
				do: union([lit("click"), lit("type"), lit("select"), lit("press"), lit("hover")]),
				text: opt(str()),
				vaultItem: opt(str({ description: "A login's vault item id" })),
				field: opt(union([lit("username"), lit("password")])),
			}),
			execute: async (args) => {
				if (args.vaultItem) {
					if (!args.field) return text("Say which field (username or password) to fill from the vault.", true);
					return browserOutput(await computer.fillLogin(args.ref, args.vaultItem, args.field));
				}
				return browserOutput(await computer.browser({ action: "act", ref: args.ref, do: args.do, ...(args.text === undefined ? {} : { text: args.text }) }));
			},
		}),
		defineTool({
			name: "computer_observe",
			description: "Take a screenshot of your desktop, for apps other than the browser.",
			deferred: true,
			parameters: obj({}),
			execute: async () => desktopOutput(await computer.desktop({ action: "screenshot" })),
		}),
		defineTool({
			name: "computer_act",
			description: "Click, type, press keys or scroll on your desktop, at screenshot coordinates.",
			deferred: true,
			parameters: obj({
				action: union([lit("click"), lit("double_click"), lit("move"), lit("type"), lit("key"), lit("scroll")]),
				x: opt(num()),
				y: opt(num()),
				text: opt(str()),
				keys: opt(arr(str())),
				dy: opt(num()),
			}),
			execute: async (args) => {
				const { action } = args;
				const request: DesktopRequest | undefined =
					action === "type"
						? args.text === undefined
							? undefined
							: { action, text: args.text }
						: action === "key"
							? args.keys?.length
								? { action, keys: args.keys }
								: undefined
							: args.x === undefined || args.y === undefined
								? undefined
								: action === "scroll"
									? { action, x: args.x, y: args.y, dy: args.dy ?? 3 }
									: { action, x: args.x, y: args.y };
				if (!request) return text("Missing arguments for that action.", true);
				return desktopOutput(await computer.desktop(request));
			},
		}),
	];
}

/** The login a vault item holds: JSON {username, password}, or just the password. */
export function loginField(value: string, field: "username" | "password"): string | undefined {
	try {
		const parsed = JSON.parse(value) as { username?: unknown; password?: unknown };
		const found = parsed[field];
		return typeof found === "string" ? found : undefined;
	} catch {
		return field === "password" ? value : undefined;
	}
}

/** Whether the page at `pageUrl` may receive a login saved for `itemOrigin` (same scheme, host and port). */
export function originMatches(pageUrl: string, itemOrigin: string | undefined): boolean {
	if (!itemOrigin) return false;
	try {
		return new URL(pageUrl).origin === new URL(itemOrigin).origin;
	} catch {
		return false;
	}
}
