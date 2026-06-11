import { useCallback, useMemo, useRef, useState } from "react";
import { type InputRenderable, TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/react";
import { useTheme } from "../../providers/theme";
import { PermissionPanel } from "./permission-panel";

type QuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

type Question = {
  question: string;
  header?: string;
  options: QuestionOption[];
  multi_select?: boolean;
};

export type Answer = {
  question: string;
  answer: string | string[];
};

type Props = {
  toolCallId: string;
  questions: Question[];
  onAnswer: (toolCallId: string, answers: Answer[]) => void;
};

type PerQuestionState = {
  // Single-select: string label. Multi-select: array of labels.
  selected?: string | string[];
  // Free-text "Other" answer for this question, if any.
  custom?: string;
};

const CHECK_ON = "☒";
const CHECK_OFF = "☐";

function defaultStateForQuestion(q: Question): PerQuestionState {
  return q.multi_select ? { selected: [] } : {};
}

function hasAnswer(state: PerQuestionState | undefined): boolean {
  if (!state) return false;
  if (Array.isArray(state.selected)) return state.selected.length > 0;
  if (typeof state.selected === "string" && state.selected.length > 0) {
    return true;
  }
  if (state.custom && state.custom.length > 0) return true;
  return false;
}

function answerFromState(
  q: Question,
  state: PerQuestionState | undefined,
): string | string[] {
  if (!state) return q.multi_select ? [] : "";
  if (q.multi_select) {
    const arr = Array.isArray(state.selected) ? [...state.selected] : [];
    if (state.custom) arr.push(state.custom);
    return arr;
  }
  if (state.custom) return state.custom;
  return typeof state.selected === "string" ? state.selected : "";
}

export function InlineQuestion({ toolCallId, questions, onAnswer }: Props) {
  const { colors } = useTheme();
  // Question index. questions.length means we're on the Submit tab.
  const [qIndex, setQIndex] = useState(0);
  // Per-question state keyed by index (stable references to questions[] indices).
  const [states, setStates] = useState<Record<number, PerQuestionState>>(() => {
    const init: Record<number, PerQuestionState> = {};
    questions.forEach((q, i) => {
      init[i] = defaultStateForQuestion(q);
    });
    return init;
  });
  // Focused option index within the current question.
  const [optionIndex, setOptionIndex] = useState(0);
  const [isWritingCustom, setIsWritingCustom] = useState(false);
  const customInputRef = useRef<InputRenderable>(null);

  const currentQuestion =
    qIndex < questions.length ? questions[qIndex] : undefined;
  const allAnswered = useMemo(
    () => questions.every((_, i) => hasAnswer(states[i])),
    [questions, states],
  );

  // The AskUserQuestion tool always provides an "Other" escape hatch, even when
  // options carry previews — so it's appended unconditionally.
  const allOptions = useMemo<QuestionOption[]>(() => {
    if (!currentQuestion) return [];
    return [
      ...currentQuestion.options,
      { label: "Other (write a custom answer)" },
    ];
  }, [currentQuestion]);

  const focusedOption = allOptions[optionIndex];
  const previewText = focusedOption?.preview;
  const isCustomOption =
    !!focusedOption && focusedOption.label === "Other (write a custom answer)";

  const goToQuestion = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(questions.length, next));
      setQIndex(clamped);
      setOptionIndex(0);
      setIsWritingCustom(false);
    },
    [questions.length],
  );

  const updateCurrentState = useCallback(
    (update: (s: PerQuestionState) => PerQuestionState) => {
      setStates((prev) => ({
        ...prev,
        [qIndex]: update(prev[qIndex] ?? {}),
      }));
    },
    [qIndex],
  );

  const submitAll = useCallback(() => {
    const out: Answer[] = questions.map((q, i) => ({
      question: q.question,
      answer: answerFromState(q, states[i]),
    }));
    onAnswer(toolCallId, out);
  }, [onAnswer, questions, states, toolCallId]);

  const handleOptionEnter = useCallback(() => {
    if (!currentQuestion) return;
    const opt = allOptions[optionIndex];
    if (!opt) return;
    if (opt.label === "Other (write a custom answer)") {
      setIsWritingCustom(true);
      return;
    }
    if (currentQuestion.multi_select) {
      // Toggle the option in/out
      updateCurrentState((s) => {
        const current = Array.isArray(s.selected) ? [...s.selected] : [];
        const idx = current.indexOf(opt.label);
        if (idx >= 0) current.splice(idx, 1);
        else current.push(opt.label);
        return { ...s, selected: current };
      });
      return;
    }
    // Single-select: record the answer and advance to next question (or Submit tab).
    updateCurrentState((s) => ({
      ...s,
      selected: opt.label,
      custom: undefined,
    }));
    goToQuestion(qIndex + 1);
  }, [
    allOptions,
    currentQuestion,
    goToQuestion,
    optionIndex,
    qIndex,
    updateCurrentState,
  ]);

  useKeyboard((key) => {
    if (isWritingCustom) {
      if (key.name === "escape") {
        key.preventDefault();
        setIsWritingCustom(false);
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        key.preventDefault();
        const v = customInputRef.current?.value?.trim() ?? "";
        if (!v) return;
        updateCurrentState((s) => ({ ...s, custom: v }));
        setIsWritingCustom(false);
        if (!currentQuestion?.multi_select) {
          goToQuestion(qIndex + 1);
        }
      }
      return;
    }

    // On the Submit tab
    if (qIndex === questions.length) {
      if (key.name === "left" || (key.shift && key.name === "tab")) {
        key.preventDefault();
        goToQuestion(qIndex - 1);
        return;
      }
      if (key.name === "enter" || key.name === "return") {
        key.preventDefault();
        if (allAnswered) submitAll();
        return;
      }
      return;
    }

    // Within a question
    if (key.name === "down" || key.name === "j") {
      key.preventDefault();
      setOptionIndex((p) => (p + 1) % allOptions.length);
    } else if (key.name === "up" || key.name === "k") {
      key.preventDefault();
      setOptionIndex((p) => (p - 1 + allOptions.length) % allOptions.length);
    } else if (key.name === "left" || (key.shift && key.name === "tab")) {
      key.preventDefault();
      goToQuestion(qIndex - 1);
    } else if (key.name === "right" || key.name === "tab") {
      key.preventDefault();
      goToQuestion(qIndex + 1);
    } else if (key.name === "space" && currentQuestion?.multi_select) {
      key.preventDefault();
      handleOptionEnter();
    } else if (key.name === "enter" || key.name === "return") {
      key.preventDefault();
      handleOptionEnter();
    }
  });

  if (questions.length === 0) return null;

  return (
    <box flexDirection="column" width="100%" marginY={1}>
      <PermissionPanel
        title={questions.length === 1 ? "Question" : "Questions"}
      >
        <box flexDirection="column" width="100%" marginTop={1}>
          <NavigationBar
            questions={questions}
            states={states}
            currentIndex={qIndex}
            inactiveColor={colors.dimSeparator}
            activeBg={colors.selection}
            textColor={colors.text}
            inverseColor={colors.inverseText}
          />

          {qIndex < questions.length && currentQuestion ? (
            <QuestionBody
              question={currentQuestion}
              state={
                states[qIndex] ?? defaultStateForQuestion(currentQuestion)
              }
              allOptions={allOptions}
              optionIndex={optionIndex}
              previewText={previewText}
              isCustomFocused={isCustomOption}
              isWritingCustom={isWritingCustom}
              customInputRef={customInputRef}
              colors={colors}
            />
          ) : (
            <SubmitView
              questions={questions}
              states={states}
              allAnswered={allAnswered}
              colors={colors}
            />
          )}
        </box>
      </PermissionPanel>

      {/* Help bar — outside the panel, like the permission dialogs. */}
      <box flexDirection="row" gap={2} paddingX={1} marginTop={1}>
        {isWritingCustom ? (
          <>
            <text fg={colors.success}>[Enter] Submit</text>
            <text fg={colors.dimSeparator}>[Esc] Cancel</text>
          </>
        ) : qIndex === questions.length ? (
          <>
            <text fg={allAnswered ? colors.success : colors.dimSeparator}>
              [Enter]{" "}
              {allAnswered ? "Submit answers" : "Answer all questions first"}
            </text>
            <text fg={colors.dimSeparator}>[←] Back</text>
          </>
        ) : (
          <>
            <text fg={colors.dimSeparator}>↑↓ Navigate</text>
            {currentQuestion?.multi_select ? (
              <text fg={colors.dimSeparator}>[Space] Toggle</text>
            ) : null}
            <text fg={colors.success}>
              [Enter] {currentQuestion?.multi_select ? "Toggle" : "Select"}
            </text>
            <text fg={colors.dimSeparator}>[← →] Question</text>
          </>
        )}
      </box>
    </box>
  );
}

function NavigationBar({
  questions,
  states,
  currentIndex,
  inactiveColor,
  activeBg,
  textColor,
  inverseColor,
}: {
  questions: Question[];
  states: Record<number, PerQuestionState>;
  currentIndex: number;
  inactiveColor: string;
  activeBg: string;
  textColor: string;
  inverseColor: string;
}) {
  return (
    <box flexDirection="row" gap={1} marginBottom={1}>
      <text fg={currentIndex === 0 ? inactiveColor : textColor}>←</text>
      {questions.map((q, i) => {
        const isCurrent = i === currentIndex;
        const checkbox = hasAnswer(states[i]) ? CHECK_ON : CHECK_OFF;
        const display = q.header || `Q${i + 1}`;
        return isCurrent ? (
          <box key={i} backgroundColor={activeBg} paddingX={1}>
            <text fg={inverseColor} attributes={TextAttributes.BOLD}>
              {checkbox} {display}
            </text>
          </box>
        ) : (
          <box key={i} paddingX={1}>
            <text fg={textColor}>
              {checkbox} {display}
            </text>
          </box>
        );
      })}
      {currentIndex === questions.length ? (
        <box backgroundColor={activeBg} paddingX={1}>
          <text fg={inverseColor} attributes={TextAttributes.BOLD}>
            ✓ Submit
          </text>
        </box>
      ) : (
        <box paddingX={1}>
          <text fg={textColor}>✓ Submit</text>
        </box>
      )}
      <text fg={currentIndex === questions.length ? inactiveColor : textColor}>
        →
      </text>
    </box>
  );
}

function QuestionBody({
  question,
  state,
  allOptions,
  optionIndex,
  previewText,
  isCustomFocused,
  isWritingCustom,
  customInputRef,
  colors,
}: {
  question: Question;
  state: PerQuestionState;
  allOptions: QuestionOption[];
  optionIndex: number;
  previewText?: string;
  isCustomFocused: boolean;
  isWritingCustom: boolean;
  customInputRef: React.RefObject<InputRenderable | null>;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const selected = state.selected;
  const isSelectedLabel = (label: string): boolean => {
    if (Array.isArray(selected)) return selected.includes(label);
    return selected === label;
  };

  return (
    <box flexDirection="column" gap={0} marginBottom={1}>
      {/* Question text + header chip */}
      <box flexDirection="row" gap={2}>
        {question.header ? (
          <box backgroundColor={colors.dimSeparator} paddingX={1}>
            <text fg={colors.inverseText}>{question.header}</text>
          </box>
        ) : null}
        <text fg={colors.text} attributes={TextAttributes.BOLD}>
          {question.question}
        </text>
      </box>

      {/* Body: options on left, optional preview on right */}
      <box flexDirection="row" gap={2} marginY={1} width="100%">
        <box
          flexDirection="column"
          gap={0}
          width={previewText ? "40%" : "100%"}
        >
          {isWritingCustom ? (
            <box flexDirection="column" gap={1}>
              <text fg={colors.success}>Custom answer:</text>
              <input
                ref={customInputRef}
                placeholder="Type and press Enter…"
                focused
              />
            </box>
          ) : (
            allOptions.map((opt, idx) => {
              const isFocused = idx === optionIndex;
              const isChecked = isSelectedLabel(opt.label);
              const prefix = question.multi_select
                ? isChecked
                  ? "[x] "
                  : "[ ] "
                : isChecked
                  ? "● "
                  : "○ ";
              return (
                <box key={idx} flexDirection="column" gap={0}>
                  <box flexDirection="row" gap={1}>
                    <text fg={isFocused ? colors.primary : colors.dimSeparator}>
                      {isFocused ? "❯ " : "  "}
                      {prefix}
                    </text>
                    <text
                      fg={
                        isFocused
                          ? colors.primary
                          : isChecked
                            ? colors.success
                            : undefined
                      }
                      attributes={isFocused ? TextAttributes.BOLD : undefined}
                    >
                      {opt.label}
                    </text>
                  </box>
                  {isFocused && opt.description ? (
                    <box paddingLeft={4}>
                      <text
                        fg={colors.dimSeparator}
                        attributes={TextAttributes.DIM}
                      >
                        {opt.description}
                      </text>
                    </box>
                  ) : null}
                </box>
              );
            })
          )}
          {state.custom && !isWritingCustom ? (
            <box marginTop={1} flexDirection="row" gap={1}>
              <text fg={colors.success}>● Your answer:</text>
              <text fg={colors.success} attributes={TextAttributes.BOLD}>
                {state.custom}
              </text>
            </box>
          ) : null}
        </box>

        {previewText && !isWritingCustom ? (
          <box
            flexDirection="column"
            width="60%"
            border={["top", "bottom", "left", "right"]}
            borderColor={colors.dimSeparator}
            paddingX={1}
          >
            <text fg={colors.dimSeparator} attributes={TextAttributes.DIM}>
              Preview
            </text>
            {previewText.split("\n").map((line, i) => (
              <text key={i} fg={colors.text}>
                {line || " "}
              </text>
            ))}
          </box>
        ) : null}
      </box>
    </box>
  );
}

function SubmitView({
  questions,
  states,
  allAnswered,
  colors,
}: {
  questions: Question[];
  states: Record<number, PerQuestionState>;
  allAnswered: boolean;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  return (
    <box flexDirection="column" marginBottom={1}>
      <text attributes={TextAttributes.BOLD}>Review your answers</text>
      {!allAnswered ? (
        <box marginTop={1}>
          <text fg={colors.autoMode}>
            ⚠ You have not answered all questions
          </text>
        </box>
      ) : null}
      <box flexDirection="column" gap={0} marginTop={1}>
        {questions.map((q, i) => {
          const state = states[i];
          const a = answerFromState(q, state);
          const answered = hasAnswer(state);
          const display = Array.isArray(a) ? a.join(", ") : a;
          const isCustom =
            !!state?.custom &&
            (Array.isArray(a) ? a.includes(state.custom) : a === state.custom);
          return (
            <box key={i} flexDirection="column">
              <text>• {q.question}</text>
              <box paddingLeft={2} flexDirection="row" gap={1}>
                <text fg={answered ? colors.success : colors.dimSeparator}>
                  → {answered ? display : "(no answer yet)"}
                </text>
                {isCustom ? (
                  <text
                    fg={colors.dimSeparator}
                    attributes={TextAttributes.DIM}
                  >
                    (custom)
                  </text>
                ) : null}
              </box>
            </box>
          );
        })}
      </box>
    </box>
  );
}
