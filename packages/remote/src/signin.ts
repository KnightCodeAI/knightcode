import { spawn } from "node:child_process";
import { hostname } from "node:os";
import type { ExtensionCommandContext, Theme } from "@knightcodeai/cli";
import { type Component, Container, getKeybindings, Loader, Spacer, Text, type TUI } from "@knightcode/tui";
import { login } from "./auth.ts";

/**
 * The KnightCode knight, rasterised from the mark in packages/ai/src/auth/oauth/oauth-page.ts
 * (even-odd fill, half blocks for the vertical halves). Duplicated in first-time-setup.ts:
 * packages/cli already depends on this package, so importing a runtime value back would
 * close a workspace cycle. Same reason for the rule, the key hint and openBrowser below.
 */
const LOGO = [
	"      ▄███▄▄",
	"  ▄▄█████████▄▄",
	"▀███▀▀▀█████████",
	"    ▄███████████",
	"   ██████████▀▀",
	"  ███████████▄▄",
	"  █████████████",
];

/** How long the approved screen waits for a keypress before publishing anyway. */
const AUTO_CONTINUE_MS = 15_000;

function openBrowser(target: string): void {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [target]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", target]]
				: ["xdg-open", [target]];
	// Best effort: the screen always prints the url too, so a missing launcher must not throw.
	// Never `cmd /c start` on Windows, which re-parses &, | and ^ in the url before start sees it.
	spawn(command, args, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
}

/** OSC 8, so terminals that support it make the url clickable instead of a wrapped string. */
function hyperlink(url: string, label = url): string {
	return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
}

class Rule implements Component {
	private readonly color: (text: string) => string;

	constructor(color: (text: string) => string) {
		this.color = color;
	}

	invalidate(): void {}

	render(width: number): string[] {
		return [this.color("─".repeat(Math.max(1, width)))];
	}
}

/** The code is the one thing the user compares against the browser, so it gets the box. */
function codeBox(theme: Theme, code: string): string[] {
	const inner = `  ${code}  `;
	const edge = "─".repeat(inner.length);
	const side = theme.fg("border", "│");
	return [
		theme.fg("border", `┌${edge}┐`),
		`${side}${theme.bold(theme.fg("accent", inner))}${side}`,
		theme.fg("border", `└${edge}┘`),
	];
}

/**
 * The device-flow screen: brand mark, the code, where to approve it, and what approving
 * grants — the same beats a hosted OAuth consent page hits, drawn in the terminal.
 */
export class SignInScreen extends Container {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly device: string;
	private readonly onCancel: () => void;
	private readonly loader: Loader;
	private code?: { userCode: string; verificationUri: string };
	private approved = false;
	private continueTimer?: ReturnType<typeof setTimeout>;

	/** Set by the caller: fired when the approved screen is dismissed, or times out. */
	onContinue?: () => void;

	constructor(tui: TUI, theme: Theme, device: string, onCancel: () => void) {
		super();
		this.tui = tui;
		this.theme = theme;
		this.device = device;
		this.onCancel = onCancel;
		this.loader = new Loader(
			tui,
			(text) => theme.fg("accent", text),
			(text) => theme.fg("muted", text),
			"Asking the relay for a code…",
		);
		this.loader.start();
		this.update();
	}

	/** Called once the relay hands back a code; the screen then waits on the browser. */
	showCode(userCode: string, verificationUri: string): void {
		this.code = { userCode, verificationUri };
		this.loader.setMessage("Waiting for you to approve it…");
		this.update();
	}

	/**
	 * The browser has approved the code. The screen stays up to say so — coming back to a
	 * terminal that silently moved on is the one moment a device flow owes the user a
	 * confirmation — but it never blocks publishing for long.
	 */
	showApproved(): void {
		this.approved = true;
		this.loader.stop();
		this.continueTimer = setTimeout(() => this.onContinue?.(), AUTO_CONTINUE_MS);
		this.update();
	}

	private update(): void {
		const theme = this.theme;
		const rule = new Rule((text) => theme.fg("border", text));
		this.clear();
		this.addChild(rule);
		this.addChild(new Spacer(1));
		this.addChild(new Text(theme.fg("accent", LOGO.join("\n")), 1, 0));
		this.addChild(new Spacer(1));
		const title = this.approved ? "Signed in to KnightCode Remote" : "Sign in to KnightCode Remote";
		this.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));
		this.addChild(
			new Text(theme.fg("muted", "Remote mirrors this session to a private link you can open on any device."), 1, 0),
		);
		this.addChild(new Spacer(1));

		if (this.approved) {
			this.addChild(new Text(theme.fg("success", theme.bold("✓ Approved in your browser")), 1, 0));
			this.addChild(new Spacer(1));
			this.addChild(new Text(theme.fg("text", `${this.device} is signed in until you run /remote logout.`), 1, 0));
			this.addChild(
				new Text(theme.fg("muted", "Continue to publish this session — the link lands in the terminal below."), 1, 0),
			);
			this.addChild(new Spacer(1));
			const confirm = getKeybindings().getKeys("tui.select.confirm").join("/");
			this.addChild(new Text(theme.fg("dim", confirm) + theme.fg("muted", " continue"), 1, 0));
			this.addChild(new Spacer(1));
			this.addChild(rule);
			this.tui.requestRender();
			return;
		}

		if (this.code) {
			this.addChild(new Text(theme.fg("dim", "Your code"), 1, 0));
			for (const line of codeBox(theme, this.code.userCode)) this.addChild(new Text(line, 1, 0));
			this.addChild(new Spacer(1));
			this.addChild(new Text(`${theme.fg("dim", "1.")} ${theme.fg("text", "Open the approval page:")}`, 1, 0));
			this.addChild(new Text(`   ${theme.fg("accent", hyperlink(this.code.verificationUri))}`, 1, 0));
			const click = process.platform === "darwin" ? "cmd+click" : "ctrl+click";
			this.addChild(new Text(theme.fg("dim", `   Already opened in your browser — ${click} to open it again.`), 1, 0));
			this.addChild(
				new Text(
					`${theme.fg("dim", "2.")} ${theme.fg("text", "Check the page shows the same code, then approve.")}`,
					1,
					0,
				),
			);
			this.addChild(new Spacer(1));
			this.addChild(
				new Text(
					theme.fg("muted", `Approving lets ${this.device} publish sessions and receive replies from the web.`),
					1,
					0,
				),
			);
			this.addChild(new Text(theme.fg("muted", "It stays signed in on this machine until /remote logout."), 1, 0));
		}

		this.addChild(this.loader);
		const cancel = getKeybindings().getKeys("tui.select.cancel").join("/");
		this.addChild(new Text(theme.fg("dim", cancel) + theme.fg("muted", " cancel sign-in"), 1, 0));
		this.addChild(new Spacer(1));
		this.addChild(rule);
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		const keys = getKeybindings();
		// Once approved there is nothing left to cancel, so both keys mean "get on with it".
		if (this.approved) {
			if (keys.matches(data, "tui.select.confirm") || keys.matches(data, "tui.select.cancel")) {
				this.onContinue?.();
			}
			return;
		}
		if (keys.matches(data, "tui.select.cancel")) this.onCancel();
	}

	dispose(): void {
		this.loader.stop();
		clearTimeout(this.continueTimer);
	}
}

export type SignInResult = { token: string } | { error: string } | undefined;

/** Runs the device flow behind the screen. `undefined` means the user pressed escape. */
export function signIn(ctx: ExtensionCommandContext, origin: string): Promise<SignInResult> {
	return ctx.ui.custom<SignInResult>((tui, theme, _keybindings, done) => {
		const cancel = new AbortController();
		const screen = new SignInScreen(tui, theme, hostname(), () => cancel.abort());
		// Disposed here as well as by the host: a login that settles before the component is
		// attached would otherwise leave the spinner's interval running against a dead screen.
		const finish = (result: SignInResult): void => {
			screen.dispose();
			done(result);
		};
		let approved: SignInResult;
		screen.onContinue = () => finish(approved);
		login(
			origin,
			(userCode, uri) => {
				screen.showCode(userCode, uri);
				openBrowser(uri);
			},
			cancel.signal,
		)
			.then((token) => {
				approved = { token };
				screen.showApproved();
			})
			.catch((error: unknown) => {
				// Escape is the one failure the user already knows about, so it closes quietly.
				if (cancel.signal.aborted) finish(undefined);
				else finish({ error: error instanceof Error ? error.message : String(error) });
			});
		return screen;
	});
}
