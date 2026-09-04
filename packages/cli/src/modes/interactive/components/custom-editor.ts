import { Editor, type EditorOptions, type EditorTheme, type TUI, visibleWidth } from "@knightcode/tui";
import type { AppKeybinding, KeybindingsManager } from "../../../core/keybindings.ts";
import type { WorkingStatusIndicator } from "./status-indicator.ts";

export type CustomEditorOptions = EditorOptions & {
	/** Render the streaming working status in the editor's top border. */
	embedWorkingStatus?: boolean;
};

/**
 * Custom editor that handles app-level keybindings for the coding agent.
 */
export class CustomEditor extends Editor {
	private keybindings: KeybindingsManager;
	private workingStatusIndicator: WorkingStatusIndicator | undefined;
	public readonly embedWorkingStatus: boolean;
	public actionHandlers: Map<AppKeybinding, () => void> = new Map();

	// Special handlers that can be dynamically replaced
	public onEscape?: () => void;
	public onCtrlD?: () => void;
	public onPasteImage?: () => void;
	/** Handler for extension-registered shortcuts. Returns true if handled. */
	public onExtensionShortcut?: (data: string) => boolean;

	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, options?: CustomEditorOptions) {
		super(tui, theme, options);
		this.keybindings = keybindings;
		this.embedWorkingStatus = options?.embedWorkingStatus ?? false;
	}

	setWorkingStatusIndicator(indicator: WorkingStatusIndicator | undefined): void {
		this.workingStatusIndicator = indicator;
	}

	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		if (!this.embedWorkingStatus || !this.workingStatusIndicator || width <= 0) {
			return super.renderTopBorder(width, hiddenLineCount);
		}

		const message = this.workingStatusIndicator.renderInBorder(Math.max(1, width - 5));
		const messageWidth = visibleWidth(message);
		if (messageWidth === 0) return super.renderTopBorder(width, hiddenLineCount);

		const overflowLabel = hiddenLineCount > 0 ? ` ↑ ${hiddenLineCount} more ` : undefined;
		const overflowLabelWidth = overflowLabel ? visibleWidth(overflowLabel) : 0;
		const overflowStart = Math.floor((width - overflowLabelWidth) / 2);
		// Whether a status of the given width leaves room for the centred overflow label.
		const fitsBesideOverflow = (statusWidth: number) =>
			overflowLabel !== undefined && overflowLabelWidth + 2 <= width && overflowStart - (3 + statusWidth + 1) >= 1;

		const withOverflow = (status: string, statusWidth: number) =>
			this.borderColor("── ") +
			status +
			this.borderColor(
				` ${"─".repeat(overflowStart - (3 + statusWidth + 1))}${overflowLabel}${"─".repeat(width - overflowStart - overflowLabelWidth)}`,
			);

		// Widest first: message beside the overflow count, then the message alone,
		// then the spinner glyph beside the count, then the glyph alone. The message
		// is kept for as long as it fits — a bare glyph in a wide border says less
		// than the message does, and the hidden lines are still reachable by
		// scrolling.
		if (fitsBesideOverflow(messageWidth)) return withOverflow(message, messageWidth);
		if (width >= messageWidth + 5) {
			return this.borderColor("── ") + message + this.borderColor(` ${"─".repeat(width - messageWidth - 4)}`);
		}

		const spinner = this.workingStatusIndicator.renderSpinnerInBorder(width);
		const spinnerWidth = visibleWidth(spinner);
		if (fitsBesideOverflow(spinnerWidth)) return withOverflow(spinner, spinnerWidth);

		const prefixWidth = Math.min(3, Math.max(0, width - spinnerWidth));
		return (
			this.borderColor("─".repeat(prefixWidth)) +
			spinner +
			this.borderColor("─".repeat(Math.max(0, width - prefixWidth - spinnerWidth)))
		);
	}

	/**
	 * Register a handler for an app action.
	 */
	onAction(action: AppKeybinding, handler: () => void): void {
		this.actionHandlers.set(action, handler);
	}

	handleInput(data: string): void {
		// Check extension-registered shortcuts first
		if (this.onExtensionShortcut?.(data)) {
			return;
		}

		// Check for clipboard paste keybinding
		if (this.keybindings.matches(data, "app.clipboard.pasteImage")) {
			this.onPasteImage?.();
			return;
		}

		// Check app keybindings first

		// Escape/interrupt - only if autocomplete is NOT active
		if (this.keybindings.matches(data, "app.interrupt")) {
			if (!this.isShowingAutocomplete()) {
				// Use dynamic onEscape if set, otherwise registered handler
				const handler = this.onEscape ?? this.actionHandlers.get("app.interrupt");
				if (handler) {
					handler();
					return;
				}
			}
			// Let parent handle escape for autocomplete cancellation
			super.handleInput(data);
			return;
		}

		// Exit (Ctrl+D) - only when editor is empty
		if (this.keybindings.matches(data, "app.exit")) {
			if (this.getText().length === 0) {
				const handler = this.onCtrlD ?? this.actionHandlers.get("app.exit");
				if (handler) handler();
				return;
			}
			// Fall through to editor handling for delete-char-forward when not empty
		}

		// Explicit history bindings take precedence over app actions while the editor is focused.
		// This lets users bind Ctrl+P even though it cycles models by default.
		if (
			this.keybindings.matches(data, "tui.editor.historyPrevious") ||
			this.keybindings.matches(data, "tui.editor.historyNext")
		) {
			super.handleInput(data);
			return;
		}

		// Check all other app actions
		for (const [action, handler] of this.actionHandlers) {
			if (action !== "app.interrupt" && action !== "app.exit" && this.keybindings.matches(data, action)) {
				handler();
				return;
			}
		}

		// Pass to parent for editor handling
		super.handleInput(data);
	}
}
