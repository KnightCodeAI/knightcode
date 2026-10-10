import { type Component, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@knightcode/tui";
import type { KeybindingsManager } from "../../core/keybindings.ts";
import { DynamicBorder } from "../../modes/interactive/components/dynamic-border.ts";
import { formatKeyText } from "../../modes/interactive/components/keybinding-hints.ts";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { formatUsageDuration, type UsageRow, type UsageWindow } from "./providers.ts";

/** Read-only inline component. Credentials and requests belong to the command, not the panel. */
export class UsagePanel implements Component {
	private readonly theme: Theme;
	private readonly keybindings: KeybindingsManager;
	private readonly onClose: () => void;
	private readonly border: DynamicBorder;
	private rows: readonly UsageRow[] | undefined;
	private readError = false;

	constructor(theme: Theme, keybindings: KeybindingsManager, onClose: () => void) {
		this.theme = theme;
		this.keybindings = keybindings;
		this.onClose = onClose;
		this.border = new DynamicBorder((line) => this.theme.fg("accent", line));
	}

	setRows(rows: readonly UsageRow[]): void {
		this.rows = rows;
		this.readError = false;
	}

	setReadError(): void {
		this.readError = true;
	}

	invalidate(): void {
		// Theme and time-dependent text are computed on every render.
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.cancel")) this.onClose();
	}

	render(width: number): string[] {
		const theme = this.theme;
		const padding = " ".repeat(Math.min(2, Math.max(0, Math.floor(width / 2))));
		const contentWidth = Math.max(0, width - padding.length * 2);
		const indent = " ".repeat(Math.min(2, Math.max(0, contentWidth - 1)));
		const detailWidth = contentWidth - indent.length;
		const lines = ["", theme.fg("accent", theme.bold("Subscription usage")), ""];
		const appendDetail = (text: string) => {
			lines.push(
				...wrapTextWithAnsi(text, Math.max(1, detailWidth)).map((line) => indent + truncateToWidth(line, detailWidth)),
			);
		};
		if (this.readError) appendDetail(theme.fg("error", "Could not read sign-ins."));
		else if (!this.rows) appendDetail(theme.fg("muted", "Checking sign-ins…"));
		else if (this.rows.length === 0)
			appendDetail(theme.fg("muted", "No subscription sign-ins. Run /login to connect Claude, Codex or Grok."));
		else
			for (const row of this.rows) {
				const plan = row.state === "ok" && row.usage.planName ? theme.fg("muted", ` · ${row.usage.planName}`) : "";
				lines.push(theme.bold(row.account.displayName) + plan, "");
				if (row.state === "unsupported") {
					appendDetail(
						theme.fg("muted", row.account.unsupportedReason ?? "Usage lookup is not available for this provider."),
					);
				} else if (row.state === "loading") appendDetail(theme.fg("muted", "Checking…"));
				else if (row.state === "error") appendDetail(theme.fg("error", row.failure.message));
				else {
					if (row.account.providerId === "anthropic") {
						const extra = row.usage.extraUsage;
						const value = !extra
							? "unavailable"
							: !extra.enabled
								? "off"
								: "unlimited" in extra
									? "unlimited"
									: extra.usedPercent === null
										? "unavailable"
										: `${Number(extra.usedPercent.toFixed(1))}% of monthly limit used`;
						appendDetail(`Extra usage: ${value}`);
						appendDetail(theme.fg("muted", "KnightCode draws from extra usage, not these plan limits."));
						if (row.usage.windows.length > 0) lines.push("");
					}
					if (row.usage.windows.length === 0) appendDetail(theme.fg("muted", "No usage windows reported."));
					for (const [index, window] of row.usage.windows.entries()) {
						if (index > 0) lines.push("");
						appendDetail(this.windowLine(window, detailWidth));
					}
					const time = new Date(row.usage.checkedAt).toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
						hour12: false,
					});
					lines.push("");
					appendDetail(theme.fg("muted", `Checked ${time}`));
				}
				lines.push("");
			}
		const keys = formatKeyText(this.keybindings.getKeys("tui.select.cancel").join("/"));
		if (lines.at(-1) !== "") lines.push("");
		lines.push(theme.fg("dim", keys) + theme.fg("muted", " close"), "");
		return [
			...this.border.render(width),
			...lines.map((line) => (line ? padding + truncateToWidth(line, contentWidth) : "")),
			...this.border.render(width),
		].map((line) => truncateToWidth(line, width));
	}

	private windowLine(window: UsageWindow, width: number): string {
		// Compact labels at narrow widths keep the number/status ahead of the reset text.
		const label = width < 60 ? window.label : window.label + " ".repeat(Math.max(0, 20 - visibleWidth(window.label)));
		const now = Date.now();
		if (window.resetsAt !== null && window.resetsAt <= now) {
			return `${label}  ${this.theme.fg("muted", "unavailable · reset passed · run /usage again")}`;
		}
		const remaining = window.remainingPercent;
		const color = remaining === null ? "muted" : remaining >= 50 ? "success" : remaining >= 20 ? "warning" : "error";
		const allowance = remaining === null ? "unavailable" : `${Number(remaining.toFixed(1))}% left`;
		const reset = window.resetsAt === null ? "" : ` · resets in ${formatUsageDuration(window.resetsAt - now)}`;
		// Reserve room for the widest percentage and the full reset text before adding a bar.
		const barWidth =
			width < 60 ? 0 : Math.max(0, Math.min(20, width - visibleWidth(label) - 9 - visibleWidth(reset) - 4));
		let bar = "";
		if (remaining !== null && barWidth >= 8) {
			const filled = Math.max(0, Math.min(barWidth, Math.round((barWidth * remaining) / 100)));
			bar = this.theme.fg(color, "█".repeat(filled) + "░".repeat(barWidth - filled)) + "  ";
		}
		return `${label}  ${bar}${this.theme.fg(color, allowance)}${this.theme.fg("muted", reset)}`;
	}
}
