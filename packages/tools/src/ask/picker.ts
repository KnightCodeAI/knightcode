import {
	type Component,
	type Focusable,
	Input,
	type Keybinding,
	type KeybindingsManager,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@knightcode/tui";
import type { Theme } from "@knightcodeai/cli";
import { formatKeyText } from "@knightcodeai/cli/modes/interactive/components/keybinding-hints";
import type { AskAnswers, AskQuestion } from "./tool.ts";

/** The row every question gets after the model's options; choosing it asks for the user's own answer. */
export const OTHER_LABEL = "None of the above";
const OTHER_DESCRIPTION = "Type your own answer.";

/** `options`: choosing a row. `note` and `other`: typing in the text field. `confirm`: submitting with gaps. */
type Mode = "options" | "note" | "other" | "confirm";

interface QuestionState {
	/** Highlighted row; `options.length` is the "None of the above" row. */
	selected: number;
	/** Whether the user answered the question, as opposed to only moving through it. */
	committed: boolean;
	note: string;
	other: string;
}

function wrapWithPrefix(prefix: string, text: string, width: number): string[] {
	const prefixWidth = visibleWidth(prefix);
	if (prefixWidth >= width) return wrapTextWithAnsi(prefix + text, width);
	const indent = " ".repeat(prefixWidth);
	return wrapTextWithAnsi(text, width - prefixWidth).map((line, i) => (i === 0 ? prefix : indent) + line);
}

/**
 * The ask_user picker: one question at a time, its options with their descriptions, a final
 * "None of the above" row that opens a text field, and an optional note on the chosen option.
 * Resolves with the answers, or undefined when the user interrupts or the turn is aborted.
 */
export class AskPicker implements Component, Focusable {
	focused = false;
	private readonly questions: AskQuestion[];
	private readonly tui: Pick<TUI, "requestRender">;
	private readonly theme: Theme;
	private readonly keybindings: Pick<KeybindingsManager, "matches" | "getKeys">;
	private readonly done: (answers: AskAnswers | undefined) => void;
	private readonly signal: AbortSignal | undefined;
	private readonly states: QuestionState[];
	private current = 0;
	private mode: Mode = "options";
	private confirmIndex = 0;
	private input: Input | undefined;
	private finished = false;
	// ctx.ui.custom takes no signal, so the picker closes itself when the turn is aborted.
	private readonly onAbort = () => this.finish(undefined);

	constructor(
		questions: AskQuestion[],
		tui: Pick<TUI, "requestRender">,
		theme: Theme,
		keybindings: Pick<KeybindingsManager, "matches" | "getKeys">,
		done: (answers: AskAnswers | undefined) => void,
		signal: AbortSignal | undefined,
	) {
		this.questions = questions;
		this.tui = tui;
		this.theme = theme;
		this.keybindings = keybindings;
		this.done = done;
		this.signal = signal;
		this.states = questions.map(() => ({ selected: 0, committed: false, note: "", other: "" }));
		signal?.addEventListener("abort", this.onAbort, { once: true });
	}

	handleInput(data: string): void {
		if (this.finished) return;
		if (this.mode === "confirm") this.handleConfirm(data);
		else if (this.input) {
			if (this.keybindings.matches(data, "tui.input.tab")) this.closeText();
			// Enter and Esc reach onSubmit and onEscape.
			else this.input.handleInput(data);
		} else this.handleOptions(data);
		this.tui.requestRender();
	}

	invalidate(): void {
		this.input?.invalidate();
	}

	dispose(): void {
		this.signal?.removeEventListener("abort", this.onAbort);
	}

	render(width: number): string[] {
		const t = this.theme;
		const w = Math.max(1, width);
		const lines = [t.fg("border", "─".repeat(w))];
		lines.push(...(this.mode === "confirm" ? this.renderConfirm(w) : this.renderQuestion(w)));
		lines.push("", ...wrapWithPrefix(" ", this.hints(), w), t.fg("border", "─".repeat(w)));
		return lines;
	}

	private question(): AskQuestion {
		return this.questions[this.current]!;
	}

	private state(): QuestionState {
		return this.states[this.current]!;
	}

	private onOtherRow(): boolean {
		return this.state().selected === this.question().options.length;
	}

	private unanswered(): number {
		return this.states.filter((s) => !s.committed).length;
	}

	private handleOptions(data: string): void {
		const kb = this.keybindings;
		const state = this.state();
		const rows = this.question().options.length + 1;
		if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")) {
			const step = kb.matches(data, "tui.select.up") ? -1 : 1;
			state.selected = (state.selected + step + rows) % rows;
			state.committed = false;
		} else if (this.questions.length > 1 && kb.matches(data, "tui.select.left")) {
			this.current = (this.current - 1 + this.questions.length) % this.questions.length;
		} else if (this.questions.length > 1 && kb.matches(data, "tui.select.right")) {
			this.current = (this.current + 1) % this.questions.length;
		} else if (kb.matches(data, "tui.input.tab")) {
			this.openText(this.onOtherRow() ? "other" : "note");
		} else if (kb.matches(data, "tui.select.confirm")) {
			if (this.onOtherRow()) this.openText("other");
			else {
				state.committed = true;
				this.advance();
			}
		} else if (kb.matches(data, "tui.select.cancel")) {
			this.finish(undefined);
		}
	}

	private handleConfirm(data: string): void {
		const kb = this.keybindings;
		if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")) {
			this.confirmIndex = 1 - this.confirmIndex;
		} else if (kb.matches(data, "tui.select.confirm")) {
			if (this.confirmIndex === 0) this.finish(this.answers());
			else this.goBack();
		} else if (kb.matches(data, "tui.select.cancel")) {
			this.goBack();
		}
	}

	private openText(mode: "note" | "other"): void {
		const t = this.theme;
		const input = new Input({
			prompt: t.fg("accent", "› "),
			placeholder: mode === "note" ? "Add a note" : "Type your answer",
			placeholderStyle: (text) => t.fg("dim", text),
		});
		const saved = mode === "note" ? this.state().note : this.state().other;
		// A paste leaves the cursor after the restored text; setValue would leave it at the start.
		if (saved) input.handleInput(`\x1b[200~${saved}\x1b[201~`);
		input.onSubmit = (value) => this.submitText(value.trim());
		input.onEscape = () => this.closeText();
		this.input = input;
		this.mode = mode;
		if (mode === "other") this.state().selected = this.question().options.length;
	}

	private submitText(text: string): void {
		const state = this.state();
		const mode = this.mode;
		this.input = undefined;
		this.mode = "options";
		if (mode === "note") {
			state.note = text;
			state.committed = true;
			this.advance();
		} else if (text) {
			state.other = text;
			state.committed = true;
			this.advance();
		} else {
			state.other = "";
			state.committed = false;
		}
	}

	/** Tab or Esc in the text field: a note is cleared, typed answer text is discarded. */
	private closeText(): void {
		const state = this.state();
		if (this.mode === "note") {
			state.note = "";
			state.committed = false;
		}
		this.input = undefined;
		this.mode = "options";
	}

	private advance(): void {
		if (this.current < this.questions.length - 1) {
			this.current++;
		} else if (this.unanswered() === 0) {
			this.finish(this.answers());
		} else {
			this.mode = "confirm";
			this.confirmIndex = 0;
		}
	}

	private goBack(): void {
		this.mode = "options";
		this.current = Math.max(
			0,
			this.states.findIndex((s) => !s.committed),
		);
	}

	private answers(): AskAnswers {
		const answers: AskAnswers = {};
		for (const [i, q] of this.questions.entries()) {
			const state = this.states[i]!;
			if (!state.committed) continue;
			const option = q.options[state.selected];
			if (option) answers[q.id] = state.note ? { label: option.label, note: state.note } : { label: option.label };
			else if (state.other) answers[q.id] = { other: state.other };
		}
		return answers;
	}

	private finish(answers: AskAnswers | undefined): void {
		if (this.finished) return;
		this.finished = true;
		this.dispose();
		this.done(answers);
	}

	private row(index: number, selected: boolean, label: string, description: string, width: number): string[] {
		const t = this.theme;
		const marker = selected ? t.fg("accent", "→ ") : "  ";
		const text = `${index + 1}. ${label}`;
		return [
			...wrapWithPrefix(` ${marker}`, selected ? t.fg("accent", text) : t.fg("text", text), width),
			...wrapWithPrefix("      ", t.fg("muted", description), width),
		];
	}

	private renderQuestion(width: number): string[] {
		const t = this.theme;
		const q = this.question();
		const state = this.state();
		const unanswered = this.unanswered();
		const progress = t.fg("accent", t.bold(`Question ${this.current + 1}/${this.questions.length}`));
		const lines = [
			...wrapWithPrefix(" ", progress + (unanswered ? t.fg("muted", ` (${unanswered} unanswered)`) : ""), width),
			...wrapWithPrefix(" ", t.fg("text", q.question), width),
			"",
		];
		for (const [i, option] of q.options.entries()) {
			lines.push(...this.row(i, state.selected === i, option.label, option.description, width));
		}
		const other = q.options.length;
		lines.push(...this.row(other, state.selected === other, OTHER_LABEL, OTHER_DESCRIPTION, width));

		if (this.input) {
			this.input.focused = this.focused;
			lines.push("", ...this.input.render(Math.max(1, width - 1)).map((line) => ` ${line}`));
		} else if (state.note && !this.onOtherRow()) {
			lines.push("", ...wrapWithPrefix(" ", t.fg("muted", `note: ${state.note}`), width));
		} else if (state.other && this.onOtherRow()) {
			lines.push("", ...wrapWithPrefix(" ", t.fg("muted", `answer: ${state.other}`), width));
		}
		return lines;
	}

	private renderConfirm(width: number): string[] {
		const t = this.theme;
		const count = this.unanswered();
		const questions = count === 1 ? "question" : "questions";
		return [
			...wrapWithPrefix(" ", t.fg("accent", t.bold("Submit with unanswered questions?")), width),
			...wrapWithPrefix(" ", t.fg("muted", `${count} unanswered ${questions}`), width),
			"",
			...this.row(0, this.confirmIndex === 0, "Submit", `Submit with ${count} unanswered ${questions}`, width),
			...this.row(1, this.confirmIndex === 1, "Go back", "Return to the first unanswered question", width),
		];
	}

	/** The first key of a binding as shown to the user, so a remapped key shows its new name. */
	private key(id: Keybinding): string {
		return formatKeyText(this.keybindings.getKeys(id)[0] ?? "");
	}

	private hints(): string {
		const t = this.theme;
		const hint = (key: string, description: string) => `${t.fg("dim", key)} ${t.fg("muted", description)}`;
		const hints: string[] = [];
		if (this.mode === "confirm") {
			hints.push(hint(this.key("tui.select.confirm"), "select"), hint(this.key("tui.select.cancel"), "go back"));
		} else if (this.mode === "note") {
			hints.push(
				hint(this.key("tui.input.submit"), "save note"),
				hint(`${this.key("tui.input.tab")}/${this.key("tui.select.cancel")}`, "clear note"),
			);
		} else if (this.mode === "other") {
			hints.push(hint(this.key("tui.input.submit"), "submit answer"), hint(this.key("tui.select.cancel"), "back"));
		} else {
			const n = this.questions.length;
			if (!this.onOtherRow()) hints.push(hint(this.key("tui.input.tab"), "add note"));
			const submit = this.onOtherRow()
				? "type answer"
				: n === 1
					? "submit"
					: this.current === n - 1
						? "submit all"
						: "submit answer";
			hints.push(hint(this.key("tui.select.confirm"), submit));
			if (n > 1) hints.push(hint(`${this.key("tui.select.left")}/${this.key("tui.select.right")}`, "questions"));
			hints.push(hint(this.key("tui.select.cancel"), "interrupt"));
		}
		return hints.join(t.fg("dim", " · "));
	}
}
