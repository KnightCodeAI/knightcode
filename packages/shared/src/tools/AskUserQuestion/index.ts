import { z } from "zod";
import { defineTool } from "../defineTool";
import { semanticBoolean } from "../primitives";

const question_option_schema = z.object({
  label: z
    .string()
    .describe(
      "The display text for this option (1-5 words). What the user sees and selects.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "Explanation of what this option means or what will happen if chosen. Useful for context about trade-offs or implications.",
    ),
  preview: z
    .string()
    .optional()
    .describe(
      "Optional preview content rendered when this option is focused. Use for ASCII mockups, code snippets, or visual comparisons.",
    ),
});

const question_schema = z.object({
  question: z
    .string()
    .describe(
      'The complete question to ask the user. Clear, specific, and ending with "?".',
    ),
  header: z
    .string()
    .optional()
    .describe(
      'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
    ),
  options: z
    .array(question_option_schema)
    .min(2)
    .max(4)
    .describe(
      "2-4 distinct mutually exclusive options (unless multi_select). Do NOT add an 'Other' option — that is provided automatically.",
    ),
  multi_select: semanticBoolean(
    z.boolean().optional().default(false),
  ).describe(
    "Set true to allow the user to select multiple options (checkboxes) instead of one (radio). Use when choices are not mutually exclusive.",
  ),
});

// Smaller models and older message histories may send the legacy flat shape
// `{ question, options: string[], isMultiSelect }`. Normalize before parsing
// so the chat route's validateUIMessages doesn't reject the whole turn.
function normalizeQuestion(q: unknown): unknown {
  if (!q || typeof q !== "object") return q;
  const v = q as Record<string, unknown>;
  const rawOptions = Array.isArray(v.options) ? v.options : [];
  const options = rawOptions.map((o) =>
    typeof o === "string" ? { label: o } : o,
  );
  const multi =
    v.multi_select ??
    (v as { multiSelect?: unknown }).multiSelect ??
    (v as { isMultiSelect?: unknown }).isMultiSelect ??
    false;
  return {
    ...v,
    options,
    multi_select: multi,
  };
}

const input_schema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const v = val as Record<string, unknown>;
    // Legacy flat shape: { question, options, isMultiSelect } → wrap.
    if (!Array.isArray(v.questions) && typeof v.question === "string") {
      return { questions: [normalizeQuestion(v)] };
    }
    // New shape: still normalize each question's options + multi_select alias.
    if (Array.isArray(v.questions)) {
      return { ...v, questions: v.questions.map(normalizeQuestion) };
    }
    return val;
  },
  z.object({
    questions: z
      .array(question_schema)
      .min(1)
      .max(4)
      .describe("1-4 questions to ask the user in a single batch"),
  }),
);

export const AskUserQuestion = defineTool({
  name: "AskUserQuestion",
  is_deferred: true,
  is_read_only: true,
  is_concurrency_safe: false,
  search_hint: "ask the user a multi-choice question",
  input_schema,
  description: `Ask the user 1-4 multiple-choice questions in a single batch. Each option may include a markdown preview for side-by-side comparison.

Usage notes:
- Users can always select "Other" for free-text input — do not add an "Other" option manually.
- multi_select: true for non-exclusive choices (checkboxes); false for single choice (radio).
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.
- Reserve for decisions where the answer changes what you do next — not for preferences with an obvious default.
- Use the optional preview field on options when presenting concrete artifacts users need to visually compare (ASCII mockups, code snippets, diagram variations, config examples). Do NOT use previews for simple preference questions where labels and descriptions suffice.

Plan mode note:
- In plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan.
- Do NOT use this tool to ask "Is my plan ready?" or "Should I proceed?" — use ExitPlanMode for plan approval.
- IMPORTANT: Do not reference "the plan" in your questions because the user cannot see the plan until you call ExitPlanMode.`,
});

export type AskUserQuestionInput = z.infer<typeof input_schema>;
export type QuestionOption = z.infer<typeof question_option_schema>;
export type Question = z.infer<typeof question_schema>;
