import type { AssistantMessage } from "@knightcode/ai";
import {
	backgroundAnsi,
	type Color,
	type Component,
	colorToRgb,
	type EditorTheme,
	foregroundAnsi,
	getCapabilities,
	hyperlink,
	mixColors,
	parseColor,
	rgbColor,
	truncateToWidth,
	type TUI,
	visibleWidth,
} from "@knightcode/tui";
import { APP_NAME, VERSION } from "../../config.ts";
import type { ExtensionAPI, ExtensionContext } from "../../core/extensions/types.ts";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { addUsageToTotals, createUsageTotals } from "../../core/usage-totals.ts";
import { CustomEditor } from "../../modes/interactive/components/custom-editor.ts";
import { formatCwdForFooter, formatTokens } from "../../modes/interactive/components/footer.ts";
import { keyHint, keyText, rawKeyHint } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";

/**
 * KnightCode's own look: a gradient knight header, a rounded editor frame, and a two-line dashboard
 * footer. It lives here rather than in modes/interactive so resyncs with the base TUI never touch it;
 * `-builtin:ui` in the `extensions` setting restores the stock header, editor and footer.
 */

/** The knight from components/first-time-setup.ts. */
const LOGO = [
	"      ▄███▄▄     ",
	"  ▄▄█████████▄▄  ",
	"▀███▀▀▀█████████ ",
	"    ▄███████████ ",
	"   ██████████▀▀  ",
	"  ███████████▄▄  ",
	"  ▀▀▀▀▀▀▀▀▀▀▀▀▀  ",
];

/**
 * The knight for macOS Terminal, in whole cells. Terminal draws block characters from the font, short of the cell
 * edges, so every half block touching the body left a dark gap; only a cell's background reaches its edges. The
 * snout, ears and base were all half-block steps, so this is redrawn for whole cells at the same size.
 */
const APPLE_TERMINAL_LOGO = [
	"      ██  ██     ",
	"    █████████    ",
	"████████████████ ",
	"█    ███████████ ",
	"    ██████████   ",
	"  ███████████    ",
	"  █████████████  ",
];

// The site's brand ramp (apps/web: --brand #ff6a00 and the hero shader's warm stops), amber to ember.
// Light terminals get a deeper ramp: pale amber washes out on a white background.
const PALETTES: Record<"dark" | "light", Color[]> = {
	dark: ["#ffd08a", "#ffab3d", "#ff6a00", "#e04a12"].map((hex) => parseColor(hex)),
	light: ["#e8912e", "#d95500", "#b84300", "#8f3300"].map((hex) => parseColor(hex)),
};

// The glint is near-white on dark terminals; on light ones white would vanish into the background.
const HIGHLIGHTS: Record<"dark" | "light", Color> = { dark: parseColor("#fff4e0"), light: parseColor("#ffc46b") };

/** Seconds for the palette to flow one full wave, and for the glint to sweep once; then the header holds still. */
const FLOW_SECONDS = 5;
const GLINT_SWEEP_SECONDS = 1.6;
// Startup work blocks the event loop for ~1 s (stalls up to 165 ms measured), so the knight waits it out.
// ponytail: fixed delay, not a readiness signal; a slower machine can still stutter the glint.
const START_DELAY_MS = 1000;
// Windows timers tick every 15.6 ms and round up, so the interval lands on two ticks (31 ms) when it has slack.
// At 30 ms a millisecond of render work pushed ~15% of frames to three ticks (47 ms); 25 ms leaves 6 ms.
const FRAME_MS = 25;
// A late frame advances the animation by at most this much, so a stall pauses the glint instead of skipping it.
const MAX_STEP_MS = 50;

/** Sample the palette at `position` in [0, 1]. */
function sample(palette: Color[], position: number): Color {
	const scaled = Math.min(Math.max(position, 0), 1) * (palette.length - 1);
	const index = Math.min(Math.floor(scaled), palette.length - 2);
	return mixColors(palette[index]!, palette[index + 1]!, scaled - index);
}

// Sampled once and stored as RGB: an oklch mix and conversion for every pixel of every frame cost ~6 ms per render.
const RAMP_STEPS = 64;
const ramp = (palette: Color[]) =>
	Array.from({ length: RAMP_STEPS }, (_, i) => {
		const { r, g, b } = colorToRgb(sample(palette, i / (RAMP_STEPS - 1)));
		return rgbColor(r, g, b);
	});
const RAMPS: Record<"dark" | "light", Color[]> = { dark: ramp(PALETTES.dark), light: ramp(PALETTES.light) };

/**
 * Header color at `x` columns and `y` half-rows, so a unit is roughly square. The palette flows diagonally as a
 * wave, and a glint sweeps once across the knight and on through the title.
 */
function shimmer(theme: Theme, x: number, y: number, time: number): Color {
	const diagonal = x + y;
	const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * (diagonal / 40 - time / FLOW_SECONDS));
	const base = RAMPS[theme.appearance][Math.round(wave * (RAMP_STEPS - 1))]!;
	const sweep = time / GLINT_SWEEP_SECONDS;
	const glow = Math.exp(-(((diagonal - (sweep * 60 - 10)) / 3) ** 2));
	if (glow < 0.01) return base;
	return mixColors(base, HIGHLIGHTS[theme.appearance], glow * 0.8, "srgb");
}

/** The knight drawn in half-cell pixels: a full block becomes `▀` over a background, so each half has its own color. */
function knight(theme: Theme, time: number): string[] {
	const mode = theme.getColorMode();
	// In macOS Terminal full cells are background-colored spaces, one color each (the halves' mix): a `▀` falls short
	// of the cell edges there and showed the background around every cell as a grid.
	const appleTerminal = process.env.TERM_PROGRAM === "Apple_Terminal";
	return (appleTerminal ? APPLE_TERMINAL_LOGO : LOGO).map((line, row) => {
		// Colors are written only when they change and reset once per row; per-cell resets bloated every frame.
		let out = "";
		let fg = "";
		let bg = "";
		const cell = (ch: string, nextFg: string, nextBg: string) => {
			if (nextFg && nextFg !== fg) {
				out += nextFg;
				fg = nextFg;
			}
			if (nextBg !== bg) {
				out += nextBg || "\x1b[49m";
				bg = nextBg;
			}
			out += ch;
		};
		// 256 colors (macOS Terminal) snap neighbouring pixels of the diagonal ramp to different palette steps, a
		// checkerboard. Ramping by row alone gives clean horizontal bands instead.
		const color = (x: number, half: number) => shimmer(theme, mode === "truecolor" ? x : 0, row * 2 + half, time);
		[...line].forEach((ch, x) => {
			if (ch === "█" && appleTerminal)
				cell(" ", "", backgroundAnsi(mixColors(color(x, 0), color(x, 1), 0.5, "srgb"), mode));
			else if (ch === "█") cell("▀", foregroundAnsi(color(x, 0), mode), backgroundAnsi(color(x, 1), mode));
			else if (ch === "▀") cell(ch, foregroundAnsi(color(x, 0), mode), "");
			else if (ch === "▄") cell(ch, foregroundAnsi(color(x, 1), mode), "");
			else cell(ch, "", "");
		});
		return fg || bg ? `${out}\x1b[39;49m` : out;
	});
}

/** The knight, title, cwd and key hints. The gradient glints once, only while the header is on screen in truecolor. */
export class KnightHeader implements Component {
	private readonly tui: TUI;
	private readonly theme: Theme;
	private readonly cwd: string;
	private readonly start = performance.now();
	/** Animation seconds, advanced in render by real time between frames. */
	private time = 0;
	private lastFrame: number | undefined;
	private readonly timer: ReturnType<typeof setInterval>;

	constructor(tui: TUI, theme: Theme, cwd: string) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.timer = setInterval(() => {
			if (performance.now() - this.start < START_DELAY_MS) return;
			if (this.live() && this.time < GLINT_SWEEP_SECONDS) tui.requestRender();
			else clearInterval(this.timer);
		}, FRAME_MS);
		this.timer.unref?.();
	}

	/**
	 * Once the header leaves the screen its frame freezes: in regular mode, changing a row above the viewport
	 * redraws everything and clears the scrollback. 256-color terminals keep the still frame; the steps would flicker.
	 */
	private live(): boolean {
		return this.tui.viewportTop === 0 && this.theme.getColorMode() === "truecolor";
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.timer);
	}

	render(width: number): string[] {
		const theme = this.theme;
		const now = performance.now();
		if (this.live() && now - this.start >= START_DELAY_MS) {
			const step = Math.min(now - (this.lastFrame ?? now), MAX_STEP_MS) / 1000;
			this.time = Math.min(this.time + step, GLINT_SWEEP_SECONDS);
			this.lastFrame = now;
		}
		const logoWidth = Math.max(...LOGO.map((line) => visibleWidth(line)));
		const logo = knight(theme, this.time);
		const cwd = theme.fg("muted", formatCwdForFooter(this.cwd, process.env.HOME || process.env.USERPROFILE));
		const separator = theme.fg("muted", " · ");
		const hints = [
			[
				keyHint("app.interrupt", "interrupt"),
				rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
			].join(separator),
			[rawKeyHint("/", "commands"), rawKeyHint("!", "bash")].join(separator),
		];
		const name = APP_NAME === "knightcode" ? "KnightCode" : APP_NAME;
		// The title sits in the same color space as the knight, so the glint carries on into it.
		const title = (x: number, y: number) => {
			const mode = theme.getColorMode();
			const letters = [...name].map((ch, i) => `${foregroundAnsi(shimmer(theme, x + i, y, this.time), mode)}${ch}`);
			return `${theme.bold(`${letters.join("")}\x1b[39m`)}${theme.fg("dim", ` v${VERSION}`)}`;
		};

		// Knight on the left, text beside it and vertically centred, all flush with the transcript's 1-column pad.
		const indent = " ";
		const gap = " ".repeat(3);
		const below = [cwd, "", ...hints];
		const textWidth = Math.max(visibleWidth(`${name} v${VERSION}`), ...below.map((line) => visibleWidth(line)));
		const fit = (line: string) => truncateToWidth(`${indent}${line}`, width);
		if (indent.length + logoWidth + gap.length + textWidth > width) {
			return ["", ...logo.map(fit), "", ...[title(0, (LOGO.length + 1) * 2), ...below].map(fit), ""];
		}
		const top = Math.floor((LOGO.length - below.length - 1) / 2);
		const text = [title(logoWidth + gap.length, top * 2 + 0.5), ...below];
		return ["", ...logo.map((line, row) => fit(`${line}${gap}${text[row - top] ?? ""}`)), ""];
	}
}

/** `left` and `right` on one row; when both don't fit, left keeps ~45% and both truncate. */
function columns(left: string, right: string, width: number): string {
	if (!right) return truncateToWidth(left, width);
	const gap = width - visibleWidth(left) - visibleWidth(right);
	if (gap >= 1) return `${left}${" ".repeat(gap)}${right}`;
	const leftWidth = Math.max(1, Math.floor(width * 0.45));
	const fittedLeft = truncateToWidth(left, leftWidth);
	const fittedRight = truncateToWidth(right, Math.max(1, width - visibleWidth(fittedLeft) - 1));
	return truncateToWidth(
		`${fittedLeft}${" ".repeat(Math.max(1, width - visibleWidth(fittedLeft) - visibleWidth(fittedRight)))}${fittedRight}`,
		width,
	);
}

function oneLine(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

/** The default editor inside a rounded frame. Side rails sit in the outer padding column. */
export class FramedEditor extends CustomEditor {
	private framed = false;
	private bottomBorder = "";

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(tui, theme, keybindings, { paddingX: 2, embedWorkingStatus: true });
	}

	override setPaddingX(padding: number): void {
		// One column for the rail, one so a cursor at the line end never lands on it.
		super.setPaddingX(Math.max(2, padding));
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		if (!this.framed) return super.renderTopBorder(width, hiddenLineCount);
		return `${this.borderColor("╭")}${super.renderTopBorder(width - 2, hiddenLineCount)}${this.borderColor("╮")}`;
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		if (!this.framed) return super.renderBottomBorder(width, hiddenLineCount);
		this.bottomBorder = `${this.borderColor("╰")}${super.renderBottomBorder(width - 2, hiddenLineCount)}${this.borderColor("╯")}`;
		return this.bottomBorder;
	}

	override render(width: number): string[] {
		this.framed = width >= 6;
		const lines = super.render(width);
		if (!this.framed) return lines;
		// Content rows start and end with plain padding spaces; the autocomplete list below the frame keeps its padding.
		const end = lines.indexOf(this.bottomBorder, 1);
		const rail = this.borderColor("│");
		for (let i = 1; i < end; i++) lines[i] = `${rail}${lines[i]!.slice(1, -1)}${rail}`;
		return lines;
	}
}

export default function uiExtension(knightcode: ExtensionAPI): void {
	let cost = 0;
	let tokensPerSecond: number | undefined;
	let streamStart: number | undefined;
	let answeredBy: string | undefined;
	let changedFiles: number | undefined;
	let pullRequest: { number: number; url: string } | undefined;
	let requestRender: (() => void) | undefined;
	let installedEditor = false;

	const refreshCost = (ctx: ExtensionContext) => {
		// Same accounting as the stock footer: every usage-bearing entry, not just the current branch.
		const totals = createUsageTotals();
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "usage") addUsageToTotals(totals, entry.usage);
			else if (entry.type === "message" && entry.message.role === "assistant")
				addUsageToTotals(totals, entry.message.usage);
			else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage)
				addUsageToTotals(totals, entry.message.usage);
			else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage)
				addUsageToTotals(totals, entry.usage);
		}
		cost = totals.cost;
		requestRender?.();
	};

	const refreshChangedFiles = async (cwd: string) => {
		const result = await knightcode
			.exec("git", ["status", "--porcelain"], { cwd, timeout: 5000 })
			.catch(() => undefined);
		changedFiles = result?.code === 0 ? result.stdout.split("\n").filter((line) => line.trim()).length : undefined;
		requestRender?.();
	};

	const refreshPullRequest = async (cwd: string) => {
		// gh is optional: missing, signed out, or no PR for the branch all mean "no PR".
		const result = await knightcode
			.exec("gh", ["pr", "view", "--json", "number,url"], { cwd, timeout: 10000 })
			.catch(() => undefined);
		try {
			pullRequest = result?.code === 0 ? JSON.parse(result.stdout) : undefined;
		} catch {
			pullRequest = undefined;
		}
		requestRender?.();
	};

	const refreshGit = (cwd: string) => {
		void refreshChangedFiles(cwd);
		void refreshPullRequest(cwd);
	};

	knightcode.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		cost = 0;
		tokensPerSecond = undefined;
		answeredBy = undefined;
		changedFiles = undefined;
		pullRequest = undefined;

		ctx.ui.setHeader((tui, theme) => new KnightHeader(tui, theme, ctx.cwd));

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const stopBranchWatch = footerData.onBranchChange(() => refreshGit(ctx.cwd));
			return {
				dispose: stopBranchWatch,
				invalidate() {},
				render(width: number): string[] {
					let cwd = formatCwdForFooter(ctx.sessionManager.getCwd(), process.env.HOME || process.env.USERPROFILE);
					const sessionName = ctx.sessionManager.getSessionName();
					if (sessionName) cwd += ` • ${sessionName}`;

					const model = ctx.model;
					const modelLabel = model
						? `${model.provider}/${model.id}${model.reasoning ? ` · ${knightcode.getThinkingLevel()}` : ""}${answeredBy && answeredBy !== model.id ? ` → ${answeredBy}` : ""}`
						: "no model";

					const usage = ctx.getContextUsage();
					const contextWindow = usage?.contextWindow ?? model?.contextWindow ?? 0;
					const percent = usage?.percent ?? null;
					let context = `${percent === null ? "?" : Math.round(percent)}%/${contextWindow ? formatTokens(contextWindow) : "?"}`;
					if (percent !== null && percent > 90) context = theme.fg("error", context);
					else if (percent !== null && percent > 70) context = theme.fg("warning", context);
					const speed = tokensPerSecond === undefined ? "— tok/s" : `${Math.round(tokensPerSecond)} tok/s`;
					// Extension statuses ("remote active") are short accents on the session: they ride the stats line
					// rather than growing the footer by a row. Appended last so their own colours can't bleed back.
					const statuses = [...footerData.getExtensionStatuses().entries()]
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, text]) => ` ${theme.fg("muted", "·")} ${oneLine(text)}`)
						.join("");
					const stats = `${context}${theme.fg("muted", ` · $${cost.toFixed(3)} · ${speed}`)}${statuses}`;

					const branch = footerData.getGitBranch();
					const gitParts: string[] = [];
					if (branch) gitParts.push(branch);
					if (branch && changedFiles !== undefined)
						gitParts.push(`${changedFiles} ${changedFiles === 1 ? "file" : "files"} changed`);
					if (pullRequest) {
						const label = `PR #${pullRequest.number}`;
						gitParts.push(getCapabilities().hyperlinks ? hyperlink(label, pullRequest.url) : label);
					}

					return [
						columns(theme.fg("text", cwd), theme.fg("muted", modelLabel), width),
						columns(theme.fg("muted", stats), theme.fg("muted", gitParts.join(" · ")), width),
					];
				},
			};
		});

		// A file or package extension that brought its own editor (vim mode and the like) loaded first; keep it.
		installedEditor = !ctx.ui.getEditorComponent();
		if (installedEditor) {
			ctx.ui.setEditorComponent((tui, theme, keybindings) => new FramedEditor(tui, theme, keybindings));
		}

		refreshCost(ctx);
		refreshGit(ctx.cwd);
	});

	knightcode.on("message_update", (event) => {
		if (event.message.role === "assistant" && streamStart === undefined) streamStart = Date.now();
	});

	knightcode.on("message_end", (event, ctx) => {
		if (event.message.role === "assistant") {
			const message = event.message as AssistantMessage;
			// A virtual model routes each request; show where the latest response went.
			answeredBy = message.model;
			if (streamStart !== undefined) {
				// Measured from the first streamed token, so time-to-first-token doesn't drag the rate down.
				const seconds = (Date.now() - streamStart) / 1000;
				if (seconds > 0.2 && message.usage.output > 0) tokensPerSecond = message.usage.output / seconds;
			}
		}
		streamStart = undefined;
	});

	knightcode.on("model_select", () => {
		answeredBy = undefined;
		tokensPerSecond = undefined;
	});
	knightcode.on("session_tree", (_event, ctx) => refreshCost(ctx));
	knightcode.on("session_compact", (_event, ctx) => refreshCost(ctx));
	// A message is persisted only after its message_end handlers run, so totals are read once each turn ends.
	knightcode.on("turn_end", (_event, ctx) => refreshCost(ctx));
	knightcode.on("agent_end", (_event, ctx) => {
		refreshCost(ctx);
		void refreshChangedFiles(ctx.cwd);
	});

	knightcode.on("session_shutdown", (_event, ctx) => {
		requestRender = undefined;
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(undefined);
		ctx.ui.setFooter(undefined);
		if (installedEditor) ctx.ui.setEditorComponent(undefined);
		installedEditor = false;
	});
}
