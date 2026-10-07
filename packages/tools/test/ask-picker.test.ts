import { setKeybindings, visibleWidth } from "@knightcode/tui";
import type { Theme } from "@knightcodeai/cli";
import { KeybindingsManager } from "@knightcodeai/cli/core/keybindings";
import { beforeEach, describe, expect, test } from "vitest";
import { AskPicker } from "../src/ask/picker.ts";
import type { AskAnswers, AskQuestion } from "../src/ask/tool.ts";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;

const KEY = { up: "\x1b[A", down: "\x1b[B", right: "\x1b[C", left: "\x1b[D", enter: "\r", tab: "\t", esc: "\x1b" };

const db: AskQuestion = {
	id: "database",
	question: "Which database should the cache use?",
	options: [
		{ label: "SQLite (Recommended)", description: "One file, no server." },
		{ label: "Postgres", description: "Needs a running server." },
	],
};
const auth: AskQuestion = {
	id: "auth",
	question: "Which auth flow?",
	options: [
		{ label: "OAuth", description: "Browser sign-in." },
		{ label: "API key", description: "A key in the environment." },
	],
};

function open(questions: AskQuestion[], keybindings = new KeybindingsManager(), signal?: AbortSignal) {
	// Input reads the global keybindings, so they must match the ones the picker gets.
	setKeybindings(keybindings);
	const result: { done: boolean; answers?: AskAnswers } = { done: false };
	const picker = new AskPicker(
		questions,
		{ requestRender: () => {} },
		theme,
		keybindings,
		(answers) => {
			result.done = true;
			result.answers = answers;
		},
		signal,
	);
	const press = (...keys: string[]) => {
		for (const key of keys) picker.handleInput(key);
	};
	const type = (text: string) => press(...text);
	const screen = (width = 80) => picker.render(width).join("\n");
	return { picker, result, press, type, screen };
}

beforeEach(() => setKeybindings(new KeybindingsManager()));

describe("AskPicker", () => {
	test("shows progress, the question, numbered options with descriptions and None of the above", () => {
		const { screen } = open([db, auth]);
		const text = screen();
		expect(text).toContain("Question 1/2 (2 unanswered)");
		expect(text).toContain("Which database should the cache use?");
		expect(text).toContain("→ 1. SQLite (Recommended)");
		expect(text).toContain("      One file, no server.");
		expect(text).toContain("  2. Postgres");
		expect(text).toContain("  3. None of the above");
		expect(text).toContain("tab add note · enter submit answer · left/right questions · escape interrupt");
	});

	test("a title and other row replace the progress line and None of the above", () => {
		setKeybindings(new KeybindingsManager());
		const done: (AskAnswers | undefined)[] = [];
		const picker = new AskPicker(
			[db],
			{ requestRender: () => {} },
			theme,
			new KeybindingsManager(),
			(answers) => done.push(answers),
			undefined,
			{
				title: "Plan revision 2",
				other: { label: "Revise the plan", description: "Tell the model what to change." },
				cancel: "keep planning",
			},
		);
		const text = picker.render(80).join("\n");
		expect(text).toContain("Plan revision 2");
		expect(text).not.toContain("Question 1/1");
		expect(text).toContain("3. Revise the plan");
		expect(text).not.toContain("None of the above");
		expect(text).toContain("escape keep planning");
		for (const key of [KEY.down, KEY.down, KEY.enter, ..."shorter", KEY.enter]) picker.handleInput(key);
		expect(done).toEqual([{ database: { other: "shorter" } }]);
	});

	test("Enter commits and advances; Enter on the last question submits", () => {
		const { press, result, screen } = open([db, auth]);
		press(KEY.enter);
		expect(result.done).toBe(false);
		expect(screen()).toContain("Question 2/2 (1 unanswered)");
		expect(screen()).toContain("enter submit all");
		press(KEY.down, KEY.enter);
		expect(result).toEqual({
			done: true,
			answers: { database: { label: "SQLite (Recommended)" }, auth: { label: "API key" } },
		});
	});

	test("up and down wrap around the rows", () => {
		const { press, screen } = open([db]);
		press(KEY.up);
		expect(screen()).toContain("→ 3. None of the above");
		press(KEY.down);
		expect(screen()).toContain("→ 1. SQLite (Recommended)");
	});

	test("Tab opens a note; Enter saves it with the option and advances", () => {
		const { press, type, result, screen } = open([db]);
		press(KEY.down, KEY.tab);
		expect(screen()).toContain("enter save note · tab/escape clear note");
		type("only on CI");
		press(KEY.enter);
		expect(result.answers).toEqual({ database: { label: "Postgres", note: "only on CI" } });
	});

	test("Esc in a note clears it and returns to the options", () => {
		const { press, type, result, screen } = open([db]);
		press(KEY.tab);
		type("draft");
		press(KEY.esc);
		expect(result.done).toBe(false);
		expect(screen()).not.toContain("draft");
		press(KEY.enter);
		expect(result.answers).toEqual({ database: { label: "SQLite (Recommended)" } });
	});

	test("a saved note is shown and reopens with its text", () => {
		const { press, type, screen } = open([db, auth]);
		press(KEY.tab);
		type("local");
		press(KEY.enter, KEY.left);
		expect(screen()).toContain("note: local");
		press(KEY.tab);
		type("!");
		expect(screen()).toContain("local!");
	});

	test("choosing another option drops the note written for the previous one", () => {
		const { press, type, result, screen } = open([db, auth]);
		press(KEY.tab);
		type("keep the file local");
		press(KEY.enter, KEY.left, KEY.down);
		expect(screen()).not.toContain("note: keep the file local");
		press(KEY.enter, KEY.enter);
		expect(result.answers).toEqual({ database: { label: "Postgres" }, auth: { label: "OAuth" } });
	});

	test("None of the above opens a text field and answers with the typed text", () => {
		const { press, type, result, screen } = open([db]);
		press(KEY.down, KEY.down);
		expect(screen()).not.toContain("tab add note");
		expect(screen()).toContain("enter type answer");
		press(KEY.enter);
		// The placeholder's first letter is drawn in reverse video as the cursor.
		expect(screen()).toContain("ype your answer");
		expect(screen()).toContain("enter submit answer · escape back");
		type(" Redis ");
		press(KEY.enter);
		expect(result.answers).toEqual({ database: { other: "Redis" } });
	});

	test("an empty typed answer leaves the question open", () => {
		const { press, result, screen } = open([db]);
		press(KEY.up, KEY.enter, KEY.enter);
		expect(result.done).toBe(false);
		expect(screen()).toContain("Question 1/1 (1 unanswered)");
	});

	test("left and right move between questions only while the options have focus", () => {
		const { press, type, screen } = open([db, auth]);
		press(KEY.right);
		expect(screen()).toContain("Question 2/2");
		press(KEY.right);
		expect(screen()).toContain("Question 1/2");
		press(KEY.tab);
		type("ab");
		press(KEY.left, KEY.right);
		expect(screen()).toContain("Question 1/2");
	});

	test("submitting with a gap asks first; Go back lands on the unanswered question", () => {
		const { press, result, screen } = open([db, auth]);
		press(KEY.right, KEY.enter);
		expect(screen()).toContain("Submit with unanswered questions?");
		expect(screen()).toContain("→ 1. Submit");
		press(KEY.down, KEY.enter);
		expect(result.done).toBe(false);
		expect(screen()).toContain("Question 1/2 (1 unanswered)");
		press(KEY.enter, KEY.enter);
		expect(result.answers).toEqual({ database: { label: "SQLite (Recommended)" }, auth: { label: "OAuth" } });
	});

	test("Submit in the confirmation sends only the answered questions", () => {
		const { press, result } = open([db, auth]);
		press(KEY.right, KEY.enter, KEY.enter);
		expect(result).toEqual({ done: true, answers: { auth: { label: "OAuth" } } });
	});

	test("Esc with no text field open interrupts", () => {
		const { press, result } = open([db]);
		press(KEY.esc);
		expect(result).toEqual({ done: true, answers: undefined });
		press(KEY.enter);
		expect(result.answers).toBeUndefined();
	});

	test("a remapped confirm key works and its hint shows the new key", () => {
		const { press, result, screen } = open([db], new KeybindingsManager({ "tui.select.confirm": "ctrl+s" }));
		expect(screen()).toContain("ctrl+s submit");
		press(KEY.enter);
		expect(result.done).toBe(false);
		press("\x13");
		expect(result.answers).toEqual({ database: { label: "SQLite (Recommended)" } });
	});

	test("an abort resolves undefined and removes the listener", () => {
		const controller = new AbortController();
		const { result } = open([db], new KeybindingsManager(), controller.signal);
		controller.abort();
		expect(result).toEqual({ done: true, answers: undefined });
	});

	test("dispose removes the abort listener", () => {
		const controller = new AbortController();
		const { picker, result } = open([db], new KeybindingsManager(), controller.signal);
		picker.dispose();
		controller.abort();
		expect(result.done).toBe(false);
	});

	test("every line fits a narrow terminal", () => {
		const { press, screen } = open([db, auth]);
		press(KEY.tab);
		for (const width of [20, 40]) {
			for (const line of screen(width).split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
	});
});
