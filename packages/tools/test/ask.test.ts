import { type Component, setKeybindings, type TUI } from "@knightcode/tui";
import type { ExtensionToolContext, Theme } from "@knightcodeai/cli";
import type { ToolRenderContext } from "@knightcodeai/cli/core/extensions/types";
import { KeybindingsManager } from "@knightcodeai/cli/core/keybindings";
import { Value } from "typebox/value";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { OTHER_LABEL } from "../src/ask/picker.ts";
import type { AskPicker } from "../src/ask/picker.ts";
import { askHeaderText, askRenderers, askResultText } from "../src/ask/render.ts";
import {
	type AskQuestion,
	type AskUserDetails,
	askUserSchema,
	askUserTool,
	askWithDialogs,
	formatAnswers,
	INTERRUPTED_TEXT,
	NO_USER_TEXT,
	validateQuestions,
} from "../src/ask/tool.ts";

const plainTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as unknown as Theme;
// Tags colours so assertions can see which role each span got.
const tagTheme = {
	fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
	bold: (text: string) => `*${text}*`,
} as unknown as Theme;

const options = [
	{ label: "SQLite (Recommended)", description: "One file, no server." },
	{ label: "Postgres", description: "Needs a running server." },
];
const db: AskQuestion = { id: "database", question: "Which database should the cache use?", options };
const auth: AskQuestion = {
	id: "auth",
	question: "Which auth flow?",
	options: [
		{ label: "OAuth", description: "Browser sign-in." },
		{ label: "API key", description: "A key in the environment." },
	],
};

beforeEach(() => setKeybindings(new KeybindingsManager()));

function option(label: string) {
	return { label, description: "d" };
}

describe("schema", () => {
	test("accepts 1-3 questions with 2-4 options each", () => {
		expect(Value.Check(askUserSchema, { questions: [db] })).toBe(true);
		expect(Value.Check(askUserSchema, { questions: [db, auth, { ...db, id: "c" }] })).toBe(true);
		const four = { ...db, options: ["a", "b", "c", "d"].map(option) };
		expect(Value.Check(askUserSchema, { questions: [four] })).toBe(true);
	});

	test("rejects 0 or 4 questions and 1 or 5 options", () => {
		expect(Value.Check(askUserSchema, { questions: [] })).toBe(false);
		expect(Value.Check(askUserSchema, { questions: [db, db, db, db] })).toBe(false);
		expect(Value.Check(askUserSchema, { questions: [{ ...db, options: [option("a")] }] })).toBe(false);
		const five = { ...db, options: ["a", "b", "c", "d", "e"].map(option) };
		expect(Value.Check(askUserSchema, { questions: [five] })).toBe(false);
	});

	// About 230 tokens today; it is paid on every request while the tool is active.
	test("the declaration stays small: description plus schema under 1,000 characters", () => {
		const declaration = JSON.stringify({
			name: askUserTool.name,
			description: askUserTool.description,
			parameters: askUserTool.parameters,
		});
		expect(declaration.length).toBeLessThan(1000);
	});
});

describe("validateQuestions", () => {
	test("accepts distinct ids with text", () => {
		expect(validateQuestions([db, auth])).toBeUndefined();
	});

	test("rejects duplicate ids, empty text and empty labels", () => {
		expect(validateQuestions([db, db])).toBe('Question ids must be unique; "database" repeats.');
		expect(validateQuestions([{ ...db, id: " " }])).toBe("Every question needs an id.");
		expect(validateQuestions([{ ...db, question: "" }])).toBe('Question "database" has no text.');
		expect(validateQuestions([{ ...db, options: [option("a"), option(" ")] }])).toBe(
			'Question "database" has an option with no label.',
		);
	});

	test("rejects repeated option labels, which the answer could not tell apart", () => {
		const repeated = {
			...db,
			options: [
				{ label: "Same", description: "a" },
				{ label: "Same ", description: "b" },
			],
		};
		expect(validateQuestions([repeated])).toBe('Question "database" repeats an option label; labels must be unique.');
	});
});

describe("formatAnswers", () => {
	test("one line per question in question order, with note, other and unanswered forms", () => {
		const third: AskQuestion = { ...auth, id: "scope" };
		const fourth: AskQuestion = { ...auth, id: "style" };
		const text = formatAnswers([db, auth, third, fourth], {
			style: {},
			auth: { label: "OAuth", note: "keep API keys as a fallback" },
			database: { label: "SQLite (Recommended)" },
			scope: { other: "only the CLI package" },
		});
		expect(text).toBe(
			[
				"database: SQLite (Recommended)",
				"auth: OAuth; note: keep API keys as a fallback",
				"scope: Other: only the CLI package",
				"style: unanswered",
			].join("\n"),
		);
	});
});

type Ui = {
	select?: (title: string, rows: string[]) => Promise<string | undefined>;
	input?: (title: string) => Promise<string | undefined>;
};

function fakeCtx(hasUI: boolean, mode: "tui" | "rpc" | "print", ui: Ui = {}) {
	const abort = vi.fn();
	let picker: AskPicker | undefined;
	const tui = { requestRender: () => {} } as unknown as TUI;
	const ctx = {
		hasUI,
		mode,
		abort,
		ui: {
			select: ui.select ?? (async () => undefined),
			input: ui.input ?? (async () => undefined),
			custom: (factory: (tui: TUI, theme: Theme, kb: unknown, done: (v: unknown) => void) => AskPicker) =>
				new Promise((resolve) => {
					picker = factory(tui, plainTheme, new KeybindingsManager(), resolve);
				}),
		},
	} as unknown as ExtensionToolContext;
	return { ctx, abort, picker: () => picker! };
}

function run(ctx: ExtensionToolContext, questions: AskQuestion[], signal?: AbortSignal) {
	return askUserTool.execute("call-1", { questions }, signal, undefined, ctx);
}

describe("execute", () => {
	test("with no user, returns the assumption text at once and lets the run continue", async () => {
		const { ctx, abort } = fakeCtx(false, "print");
		const result = await run(ctx, [db]);
		expect(result.content).toEqual([{ type: "text", text: NO_USER_TEXT }]);
		expect(result.details?.status).toBe("no_user");
		expect(abort).not.toHaveBeenCalled();
	});

	test("invalid questions throw before any UI opens", async () => {
		const select = vi.fn(async () => undefined);
		const { ctx } = fakeCtx(true, "rpc", { select });
		await expect(run(ctx, [db, db])).rejects.toThrow("repeats");
		expect(select).not.toHaveBeenCalled();
	});

	test("RPC: asks with select, and None of the above opens input", async () => {
		const prompts: Array<{ title: string; rows: string[] }> = [];
		const answers = ["Postgres — Needs a running server.", OTHER_LABEL];
		const { ctx } = fakeCtx(true, "rpc", {
			select: async (title, rows) => {
				prompts.push({ title, rows });
				return answers.shift();
			},
			input: async () => "  device code  ",
		});
		const result = await run(ctx, [db, auth]);
		expect(prompts[0]).toEqual({
			title: "Question 1/2: Which database should the cache use?",
			rows: ["SQLite (Recommended) — One file, no server.", "Postgres — Needs a running server.", OTHER_LABEL],
		});
		expect(result.content[0]).toEqual({ type: "text", text: "database: Postgres\nauth: Other: device code" });
		expect(result.details?.status).toBe("answered");
	});

	test("RPC: an empty typed answer leaves the question unanswered", async () => {
		const answers = await askWithDialogs([db], { select: async () => OTHER_LABEL, input: async () => " " }, undefined);
		expect(answers).toEqual({});
	});

	test("RPC: cancelling a dialog interrupts the run", async () => {
		const { ctx, abort } = fakeCtx(true, "rpc", { select: async () => undefined });
		const result = await run(ctx, [db]);
		expect(result.content).toEqual([{ type: "text", text: INTERRUPTED_TEXT }]);
		expect(result.details?.status).toBe("interrupted");
		expect(result.terminate).toBe(true);
		expect(abort).toHaveBeenCalledOnce();
	});

	test("TUI: answers come from the picker", async () => {
		const { ctx, picker } = fakeCtx(true, "tui");
		const pending = run(ctx, [db]);
		picker().handleInput("\r");
		const result = await pending;
		expect(result.content[0]).toEqual({ type: "text", text: "database: SQLite (Recommended)" });
	});

	test("TUI: a note typed in the picker reaches the model", async () => {
		const { ctx, picker } = fakeCtx(true, "tui");
		const pending = run(ctx, [db]);
		picker().handleInput("\t");
		for (const ch of "local") picker().handleInput(ch);
		picker().handleInput("\r");
		expect((await pending).content[0]).toEqual({ type: "text", text: "database: SQLite (Recommended); note: local" });
	});

	test("TUI: Esc in the picker interrupts the run", async () => {
		const { ctx, abort, picker } = fakeCtx(true, "tui");
		const pending = run(ctx, [db]);
		picker().handleInput("\x1b");
		expect((await pending).details?.status).toBe("interrupted");
		expect(abort).toHaveBeenCalledOnce();
	});

	test("an abort closes the picker and releases the turn", async () => {
		const { ctx, picker } = fakeCtx(true, "tui");
		const controller = new AbortController();
		const remove = vi.spyOn(controller.signal, "removeEventListener");
		const pending = run(ctx, [db], controller.signal);
		expect(picker()).toBeDefined();
		controller.abort();
		expect((await pending).details?.status).toBe("interrupted");
		expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
	});

	test("an already aborted turn opens no UI", async () => {
		const { ctx, picker } = fakeCtx(true, "tui");
		const controller = new AbortController();
		controller.abort();
		expect((await run(ctx, [db], controller.signal)).details?.status).toBe("interrupted");
		expect(picker()).toBeUndefined();
	});
});

describe("render", () => {
	const details = (patch: Partial<AskUserDetails>): AskUserDetails => ({
		questions: [db, auth],
		answers: {},
		status: "answered",
		...patch,
	});
	const result = (d: AskUserDetails) => ({ content: [{ type: "text" as const, text: "x" }], details: d });

	test("the header reads Questions, never the tool name: the count while asking, then how many were answered", () => {
		const args = { questions: [db, auth] };
		expect(askHeaderText(args, undefined, tagTheme)).toBe("*Questions*<muted> 2 questions for you</muted>");
		expect(askHeaderText(undefined, undefined, plainTheme)).toBe("Questions 0 questions for you");
		const answered = details({ answers: { database: { label: "SQLite" } } });
		expect(askHeaderText(args, answered, tagTheme)).toBe("*Questions*<muted> 1/2 answered</muted>");
		expect(askHeaderText(args, details({ status: "interrupted" }), plainTheme)).toBe(
			"Questions 0/2 answered (interrupted)",
		);
		expect(askHeaderText(args, details({ status: "no_user" }), plainTheme)).toBe("Questions not asked: no user");
		expect(askHeaderText(args, "failed", plainTheme)).toBe("Questions not asked");
	});

	test("an answered result lists each question with its answer and note", () => {
		const text = askResultText(
			result(details({ answers: { database: { label: "SQLite", note: "keep it local" } } })),
			plainTheme,
		);
		expect(text).toBe(
			[
				"• Which database should the cache use?",
				"  answer: SQLite",
				"  note: keep it local",
				"• Which auth flow? (unanswered)",
			].join("\n"),
		);
	});

	test("a typed answer, the no-user case and an error", () => {
		expect(askResultText(result(details({ answers: { auth: { other: "device code" } } })), plainTheme)).toContain(
			"  answer: device code",
		);
		expect(askResultText(result(details({ status: "no_user" })), plainTheme)).toBe(
			"The agent takes the recommended options.",
		);
		expect(askResultText({ content: [{ type: "text", text: "bad ids\nmore" }] }, plainTheme)).toBe("bad ids");
	});

	test("the call row's header switches to the outcome once the result renders", () => {
		// The tool row calls renderCall then renderResult on every update, sharing one state object.
		const args = { questions: [db, auth] };
		const state = {};
		const slots: { call?: Component; result?: Component } = {};
		const update = (res?: ReturnType<typeof result>) => {
			const ctx = (slot: "call" | "result") =>
				({ args, state, lastComponent: slots[slot] }) as unknown as ToolRenderContext<never, typeof args>;
			slots.call = askRenderers.renderCall!(args, plainTheme, ctx("call"));
			if (res)
				slots.result = askRenderers.renderResult!(
					res,
					{ expanded: false, isPartial: false },
					plainTheme,
					ctx("result"),
				);
		};
		update();
		expect(slots.call!.render(80)[0]).toContain("Questions 2 questions for you");
		update(result(details({ answers: { auth: { label: "OAuth" } } })));
		expect(slots.call!.render(80)[0]).toContain("Questions 1/2 answered");
		// A later update (expand, theme change) keeps the outcome.
		update(result(details({ answers: { auth: { label: "OAuth" } } })));
		expect(slots.call!.render(80)[0]).toContain("Questions 1/2 answered");
		expect(slots.result!.render(80).join("\n")).toContain("answer: OAuth");
	});
});
