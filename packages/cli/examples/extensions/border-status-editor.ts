import { isAbsolute, relative, resolve, sep } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager } from "@knightcodeai/cli";
import type { Component, EditorTheme, TUI } from "@knightcode/tui";
import { truncateToWidth, visibleWidth } from "@knightcode/tui";

function fitBorder(
	left: string,
	right: string,
	width: number,
	border: (text: string) => string,
	fill: (text: string) => string = border,
): string {
	if (width <= 0) return "";
	if (width === 1) return border("─");

	let leftText = left;
	let rightText = right;
	const fixedWidth = 2;
	const minimumGap = 3;

	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(rightText) > 0
	) {
		rightText = truncateToWidth(rightText, Math.max(0, visibleWidth(rightText) - 1), "");
	}
	while (
		fixedWidth + visibleWidth(leftText) + visibleWidth(rightText) + minimumGap > width &&
		visibleWidth(leftText) > 0
	) {
		leftText = truncateToWidth(leftText, Math.max(0, visibleWidth(leftText) - 1), "");
	}

	const gapWidth = Math.max(0, width - fixedWidth - visibleWidth(leftText) - visibleWidth(rightText));
	return `${border("─")}${leftText}${fill("─".repeat(gapWidth))}${rightText}${border("─")}`;
}

function formatCwd(cwd: string): string {
	// HOME is commonly unset on Windows. A prefix test would also rewrite a sibling directory such
	// as /home/aliceworkspace when HOME is /home/alice, and would miss C:\Users vs c:\users on
	// Windows, where paths are case-insensitive; relative() normalizes both away.
	const home = process.env.HOME || process.env.USERPROFILE;
	if (!home) return cwd;
	const rest = relative(resolve(home), resolve(cwd));
	if (rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest)) return cwd;
	return rest === "" ? "~" : `~${sep}${rest}`;
}

function formatContext(ctx: ExtensionContext): string {
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	if (!contextWindow || !usage || usage.percent === null) {
		return "ctx ?";
	}
	return `ctx ${Math.round(usage.percent)}%/${(contextWindow / 1000).toFixed(0)}k`;
}

function formatThinking(level: string): string {
	return level === "off" ? "off" : level;
}

class EmptyFooter implements Component {
	render(): string[] {
		return [];
	}

	invalidate(): void {}
}

export default function (knightcode: ExtensionAPI) {
	let isWorking = false;
	let spinnerIndex = 0;
	let spinnerTimer: ReturnType<typeof setInterval> | undefined;
	let activeTui: TUI | undefined;
	const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

	const stopSpinner = () => {
		if (spinnerTimer) {
			clearInterval(spinnerTimer);
			spinnerTimer = undefined;
		}
	};

	knightcode.on("agent_start", () => {
		isWorking = true;
		stopSpinner();
		spinnerTimer = setInterval(() => {
			spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
			activeTui?.requestRender();
		}, 80);
		activeTui?.requestRender();
	});

	knightcode.on("agent_settled", () => {
		isWorking = false;
		stopSpinner();
		activeTui?.requestRender();
	});

	knightcode.on("session_shutdown", () => {
		stopSpinner();
		activeTui = undefined;
	});

	knightcode.on("session_start", (_event, ctx) => {
		ctx.ui.setWorkingVisible(false);
		ctx.ui.setFooter(() => new EmptyFooter());

		let branch: string | undefined;

		const refreshBranch = async () => {
			const result = await knightcode
				.exec("git", ["branch", "--show-current"], { cwd: ctx.cwd })
				.catch(() => undefined);
			const stdout = result?.stdout.trim();
			branch = stdout && stdout.length > 0 ? stdout : undefined;
			activeTui?.requestRender();
		};
		void refreshBranch();

		class BorderStatusEditor extends CustomEditor {
			constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
				super(tui, theme, keybindings, { paddingX: 0 });
				activeTui = tui;
			}

			render(width: number): string[] {
				const lines = super.render(width);
				if (lines.length < 2) return lines;

				const thm = ctx.ui.theme;
				const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
				const thinking = knightcode.getThinkingLevel();
				const topLeft = isWorking ? thm.fg("accent", ` ${spinnerFrames[spinnerIndex]} `) : "";
				const topRight = "";
				const bottomLeft = thm.fg("muted", ` ${model} · ${formatThinking(thinking)} `);
				const bottomRight = thm.fg(
					"muted",
					` ${formatContext(ctx)} · ${formatCwd(ctx.cwd)}${branch ? ` (${branch})` : ""} `,
				);
				const borderColor = (text: string) => this.borderColor(text);

				lines[0] = fitBorder(topLeft, topRight, width, borderColor);
				lines[lines.length - 1] = fitBorder(bottomLeft, bottomRight, width, borderColor);
				return lines;
			}
		}

		ctx.ui.setEditorComponent((tui, theme, keybindings) => new BorderStatusEditor(tui, theme, keybindings));
	});
}
