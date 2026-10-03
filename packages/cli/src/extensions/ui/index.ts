import type { AssistantMessage } from "@knightcode/ai";
import {
	type Color,
	type EditorTheme,
	foregroundAnsi,
	getCapabilities,
	hyperlink,
	mixColors,
	parseColor,
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

// The site's brand ramp (apps/web: --brand #ff6a00 and the hero shader's warm stops), amber to ember.
// Light terminals get a deeper ramp: pale amber washes out on a white background.
const PALETTES: Record<"dark" | "light", Color[]> = {
	dark: ["#ffd08a", "#ffab3d", "#ff6a00", "#e04a12"].map((hex) => parseColor(hex)),
	light: ["#e8912e", "#d95500", "#b84300", "#8f3300"].map((hex) => parseColor(hex)),
};

/** Sample the palette at `position` in [0, 1]. */
function sample(palette: Color[], position: number): Color {
	const scaled = Math.min(Math.max(position, 0), 1) * (palette.length - 1);
	const index = Math.min(Math.floor(scaled), palette.length - 2);
	return mixColors(palette[index]!, palette[index + 1]!, scaled - index);
}

function gradient(text: string, theme: Theme, phase = 0): string {
	const chars = [...text];
	const span = Math.max(chars.length - 1, 1);
	const mode = theme.getColorMode();
	const palette = PALETTES[theme.appearance];
	return chars
		.map((ch, i) => (ch === " " ? ch : `${foregroundAnsi(sample(palette, i / span / 1.4 + phase), mode)}${ch}\x1b[39m`))
		.join("");
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

		ctx.ui.setHeader((_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const logoWidth = Math.max(...LOGO.map((line) => visibleWidth(line)));
				const logo = LOGO.map((line, row) => gradient(line.padEnd(logoWidth), theme, row * 0.04));
				const title = `${theme.bold(gradient(APP_NAME === "knightcode" ? "KnightCode" : APP_NAME, theme, 0.15))}${theme.fg("dim", ` v${VERSION}`)}`;
				const cwd = theme.fg("muted", formatCwdForFooter(ctx.cwd, process.env.HOME || process.env.USERPROFILE));
				const separator = theme.fg("muted", " · ");
				const text = [
					title,
					cwd,
					"",
					[
						keyHint("app.interrupt", "interrupt"),
						rawKeyHint(`${keyText("app.clear")}/${keyText("app.exit")}`, "clear/exit"),
					].join(separator),
					[rawKeyHint("/", "commands"), rawKeyHint("!", "bash")].join(separator),
				];

				// Knight on the left, text beside it and vertically centred, all flush with the transcript's 1-column pad.
				const indent = " ";
				const gap = " ".repeat(3);
				const textWidth = Math.max(...text.map((line) => visibleWidth(line)));
				const fit = (line: string) => truncateToWidth(`${indent}${line}`, width);
				if (indent.length + logoWidth + gap.length + textWidth > width) {
					return ["", ...logo.map(fit), "", ...text.map(fit), ""];
				}
				const top = Math.floor((logo.length - text.length) / 2);
				return ["", ...logo.map((line, row) => fit(`${line}${gap}${text[row - top] ?? ""}`)), ""];
			},
		}));

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
					const stats = `${context}${theme.fg("muted", ` · $${cost.toFixed(2)} · ${speed}`)}${statuses}`;

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
		refreshCost(ctx);
	});

	knightcode.on("model_select", () => {
		answeredBy = undefined;
	});
	knightcode.on("session_tree", (_event, ctx) => refreshCost(ctx));
	knightcode.on("session_compact", (_event, ctx) => refreshCost(ctx));
	knightcode.on("agent_end", (_event, ctx) => void refreshChangedFiles(ctx.cwd));

	knightcode.on("session_shutdown", (_event, ctx) => {
		requestRender = undefined;
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader(undefined);
		ctx.ui.setFooter(undefined);
		if (installedEditor) ctx.ui.setEditorComponent(undefined);
		installedEditor = false;
	});
}
