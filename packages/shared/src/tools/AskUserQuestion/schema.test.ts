import { describe, expect, test } from "bun:test";
import { AskUserQuestion } from "./index";

const parse = (val: unknown) => AskUserQuestion.input_schema.parse(val);

describe("AskUserQuestion input schema (legacy compatibility)", () => {
  test("accepts the canonical nested shape", () => {
    const out = parse({
      questions: [
        {
          question: "Pick one?",
          options: [
            { label: "A", description: "first" },
            { label: "B", description: "second" },
          ],
        },
      ],
    });
    expect(out.questions[0]!.question).toBe("Pick one?");
    expect(out.questions[0]!.options).toHaveLength(2);
    expect(out.questions[0]!.multi_select).toBe(false);
  });

  test("normalizes legacy flat shape with string options", () => {
    const out = parse({
      question: "Which auth?",
      options: ["OAuth", "JWT", "Session"],
      isMultiSelect: false,
    });
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0]!.question).toBe("Which auth?");
    expect(out.questions[0]!.options.map((o) => o.label)).toEqual([
      "OAuth",
      "JWT",
      "Session",
    ]);
    expect(out.questions[0]!.multi_select).toBe(false);
  });

  test("accepts multiSelect camelCase as an alias for multi_select", () => {
    const out = parse({
      question: "Pick many?",
      options: ["A", "B"],
      multiSelect: true,
    });
    expect(out.questions[0]!.multi_select).toBe(true);
  });

  test("normalizes nested shape with string options", () => {
    const out = parse({
      questions: [
        {
          question: "Pick?",
          options: ["A", "B"],
        },
      ],
    });
    expect(out.questions[0]!.options.map((o) => o.label)).toEqual(["A", "B"]);
  });

  test("description is optional", () => {
    const out = parse({
      questions: [
        {
          question: "Pick?",
          options: [{ label: "A" }, { label: "B" }],
        },
      ],
    });
    expect(out.questions[0]!.options[0]!.description).toBeUndefined();
  });
});
