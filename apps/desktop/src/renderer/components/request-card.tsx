/**
 * What the server waits on besides approvals (approval.tsx), in the composer's place. ask_user's questions
 * (`item/toolCall/requestUserInput`) and a select (`ui/dialog`, such as plan review) are Codex's question panel
 * (measured 2026-10-20 on a request_user_input): the question in 14px medium, "1 of 2" between ‹ and › and Dismiss
 * on the right, numbered 13px options 4px apart whose label carries a Recommended badge and whose description sits
 * under it, and for ask_user a text row whose button reads Skip, Next or Submit. Choosing an option moves to the next
 * question, or sends every answer on the last; the arrows move freely and earlier answers stay chosen. A confirm,
 * such as the classifier gate's, is Codex's approval card with No and Yes. An input or editor asks for text.
 */

import { useEffect, useRef, useState } from "react";
import { dialogOption, dialogTitle } from "../activity.ts";
import { isEditable, matches, useBinding } from "../keys.ts";
import { answerDialog, answerQuestions, type Dialog, type UserInput } from "../store.ts";
import { Button, IconButton, Kbd } from "./button.tsx";
import { ArrowRight, ChevronLeft, ChevronRight, Pencil, ShieldAlert, X } from "./icons.tsx";
import { Markdown } from "./markdown.tsx";

/** Takes the focus from the composer it hides, or from nothing; leaves it in any other field. */
function useTakeFocus(ref: React.RefObject<HTMLDivElement | null>) {
	useEffect(() => {
		const active = document.activeElement;
		if (!isEditable(active) || active?.closest("[data-composer]")) ref.current?.focus();
	}, [ref]);
}

const CARD = "flex flex-col overflow-hidden rounded-3xl border border-line bg-panel";

type Option = { label: string; description?: string; recommended: boolean };

/** Codex's question panel; `step` adds "1 of 2" and its arrows, `own` the text row. */
function QuestionPanel({
	question,
	body,
	step,
	options,
	chosen,
	onChoose,
	own,
	onDismiss,
}: {
	question: string;
	body?: string;
	step?: { index: number; count: number; onMove: (index: number) => void };
	options: Option[];
	/** The option already chosen for this question, shown as chosen. */
	chosen?: number;
	onChoose: (index: number) => void;
	own?: { text: string; onText: (text: string) => void; action: "Skip" | "Next" | "Submit"; onAction: () => void };
	onDismiss: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	useTakeFocus(ref);
	const [highlight, setHighlight] = useState(chosen ?? 0);
	const keys = (event: KeyboardEvent) => !isEditable(event.target) && options.length > 0;
	useBinding("desktop.picker.next", (e) => (keys(e) ? setHighlight((h) => (h + 1) % options.length) : false));
	useBinding("desktop.picker.previous", (e) =>
		keys(e) ? setHighlight((h) => (h - 1 + options.length) % options.length) : false,
	);
	useBinding("desktop.approval.accept", (e) => (keys(e) ? onChoose(highlight) : false));
	useBinding("desktop.approval.decline", (e) => (isEditable(e.target) ? false : onDismiss()));
	return (
		<div ref={ref} tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 pb-4 outline-none">
			<div className={CARD}>
				<div className="flex items-start justify-between gap-2 ps-4 pe-3 pt-4 pb-2">
					<div className="min-w-0 pt-0.5 text-base leading-5 font-medium [overflow-wrap:anywhere] text-ink">
						{question}
					</div>
					<div className="flex shrink-0 items-center gap-1 text-xs text-tertiary">
						{step && step.count > 1 ? (
							<div className="flex items-center gap-1">
								<IconButton
									label="Previous question"
									size="xs"
									disabled={step.index === 0}
									onClick={() => step.onMove(step.index - 1)}
								>
									<ChevronLeft size={14} />
								</IconButton>
								<span className="tabular-nums">
									{step.index + 1} of {step.count}
								</span>
								<IconButton
									label="Next question"
									size="xs"
									disabled={step.index === step.count - 1}
									onClick={() => step.onMove(step.index + 1)}
								>
									<ChevronRight size={14} />
								</IconButton>
							</div>
						) : null}
						<IconButton label="Dismiss" size="sm" onClick={onDismiss}>
							<X size={16} />
						</IconButton>
					</div>
				</div>
				{body ? (
					<div className="selectable max-h-72 overflow-y-auto px-4 pb-2">
						<Markdown text={body} />
					</div>
				) : null}
				<div className="flex flex-col gap-1 px-2 pt-1 pb-2" role="radiogroup" aria-label={question}>
					{options.map((option, i) => (
						<button
							key={`${i}:${option.label}`}
							type="button"
							role="radio"
							aria-checked={i === chosen}
							onPointerEnter={() => setHighlight(i)}
							onClick={() => onChoose(i)}
							className={`group flex min-h-8 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-start text-sm focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${i === highlight ? "bg-ink/5" : ""}`}
						>
							<span
								className={`flex size-5 shrink-0 items-center justify-center self-start rounded-xs border text-xs leading-none font-medium ${i === chosen ? "border-ink bg-ink text-panel" : "border-line bg-ink/5 text-tertiary"}`}
							>
								{i + 1}
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="inline-flex min-w-0 items-center gap-1.5">
									<span className="min-w-0 font-medium [overflow-wrap:anywhere] text-ink">{option.label}</span>
									{option.recommended ? (
										<span className="inline-flex shrink-0 items-center rounded-sm bg-soft-alt px-1.5 py-0.5 text-xs leading-none text-secondary">
											Recommended
										</span>
									) : null}
								</span>
								{option.description ? (
									<span className="min-w-0 [overflow-wrap:anywhere] text-tertiary">{option.description}</span>
								) : null}
							</span>
							<ArrowRight
								size={16}
								className={`ms-auto shrink-0 text-tertiary ${i === highlight ? "opacity-100" : "opacity-0"}`}
							/>
						</button>
					))}
					{own ? (
						<div className="flex min-h-8 items-center gap-2 rounded-xl px-2 py-1.5 text-sm focus-within:ring-1 focus-within:ring-line-strong">
							<span className="flex size-5 shrink-0 items-center justify-center text-tertiary">
								<Pencil size={16} />
							</span>
							<input
								value={own.text}
								aria-label="Your own answer"
								placeholder="Type your own answer"
								onChange={(e) => own.onText(e.target.value)}
								onKeyDown={(e) => {
									if (matches(e, "desktop.composer.send") && own.text.trim()) {
										e.preventDefault();
										own.onAction();
									} else if (matches(e, "desktop.picker.dismiss")) {
										e.preventDefault();
										e.stopPropagation();
										if (own.text) own.onText("");
										else ref.current?.focus();
									}
								}}
								className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-tertiary"
							/>
							<Button
								variant={own.action === "Skip" ? "outline" : "solid"}
								pill
								className="px-2"
								onClick={own.onAction}
							>
								{own.action}
							</Button>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

type Answer = { label?: string; text: string };

/**
 * ask_user's questions, one at a time with Codex's arrows. Each keeps its answer while the user moves about: a chosen
 * option, text of their own, or both (the text then rides along as a note). Answering the last sends them all.
 */
export function QuestionsCard({ threadId, request }: { threadId: string; request: UserInput }) {
	const { questions } = request.params;
	const [index, setIndex] = useState(0);
	const [answers, setAnswers] = useState<Answer[]>(() => questions.map(() => ({ text: "" })));
	// Codex shows a chosen option for a moment before it moves on.
	const advance = useRef<ReturnType<typeof setTimeout>>(undefined);
	useEffect(() => () => clearTimeout(advance.current), []);
	const question = questions[index]!;
	const answer = answers[index]!;
	const last = index === questions.length - 1;
	const update = (next: Answer) => answers.map((a, i) => (i === index ? next : a));
	const send = (all: Answer[]) => {
		const sent: Record<string, { label?: string; note?: string; other?: string }> = {};
		questions.forEach((q, i) => {
			const { label, text } = all[i]!;
			const typed = text.trim();
			if (label !== undefined) sent[q.id] = typed ? { label, note: typed } : { label };
			else if (typed) sent[q.id] = { other: typed };
		});
		answerQuestions(threadId, request, { answers: sent });
	};
	const done = (all: Answer[]) => {
		setAnswers(all);
		if (last) send(all);
		else setIndex(index + 1);
	};
	const chosen = question.options.findIndex((o) => o.label === answer.label);
	return (
		<QuestionPanel
			key={index}
			question={question.question}
			step={{
				index,
				count: questions.length,
				onMove: (to) => {
					clearTimeout(advance.current);
					setIndex(to);
				},
			}}
			options={question.options.map((o) => ({ ...dialogOption(o.label), description: o.description }))}
			chosen={chosen === -1 ? undefined : chosen}
			onChoose={(i) => {
				const next = update({ ...answer, label: question.options[i]!.label });
				setAnswers(next);
				clearTimeout(advance.current);
				advance.current = setTimeout(() => done(next), 180);
			}}
			own={{
				text: answer.text,
				onText: (text) => setAnswers(update({ ...answer, text })),
				action: answer.text.trim() ? (last ? "Submit" : "Next") : "Skip",
				// Skip leaves the question unanswered.
				onAction: () => done(answer.text.trim() ? answers : update({ text: "" })),
			}}
			onDismiss={() => answerQuestions(threadId, request, {})}
		/>
	);
}

/** A select (plan review, a command's choice): the question panel without steps or a text row. */
function SelectCard({ threadId, dialog }: { threadId: string; dialog: Dialog }) {
	const { question, body } = dialogTitle(dialog.params.title);
	const options = dialog.params.options ?? [];
	return (
		<QuestionPanel
			question={question}
			body={body}
			options={options.map(dialogOption)}
			onChoose={(i) => answerDialog(threadId, dialog, { value: options[i]! })}
			onDismiss={() => answerDialog(threadId, dialog, {})}
		/>
	);
}

function ConfirmCard({ threadId, dialog }: { threadId: string; dialog: Dialog }) {
	const ref = useRef<HTMLDivElement>(null);
	useTakeFocus(ref);
	const answer = (confirmed: boolean) => answerDialog(threadId, dialog, { confirmed });
	useBinding("desktop.approval.accept", (e) => (isEditable(e.target) ? false : answer(true)));
	useBinding("desktop.approval.decline", (e) => (isEditable(e.target) ? false : answer(false)));
	return (
		<div ref={ref} tabIndex={-1} className="mx-auto w-full max-w-3xl px-4 pb-4 outline-none">
			<div className={CARD}>
				<div className="flex flex-col gap-2 px-4 pt-4 pb-3">
					<div className="flex items-center gap-2 text-sm leading-5 text-secondary">
						<ShieldAlert size={16} />
						{dialog.params.title}
					</div>
					{dialog.params.message ? (
						<div className="selectable text-base leading-5 font-medium [overflow-wrap:anywhere] whitespace-pre-wrap text-ink">
							{dialog.params.message}
						</div>
					) : null}
				</div>
				<div className="flex items-center justify-end gap-2 px-4 pt-3 pb-4">
					<Button variant="outline" pill className="gap-1.5 px-2" onClick={() => answer(false)}>
						No <Kbd>Esc</Kbd>
					</Button>
					<Button variant="solid" pill className="gap-1.5 px-2" onClick={() => answer(true)}>
						Yes <Kbd>⏎</Kbd>
					</Button>
				</div>
			</div>
		</div>
	);
}

function TextCard({ threadId, dialog }: { threadId: string; dialog: Dialog }) {
	const editor = dialog.params.kind === "editor";
	const [value, setValue] = useState(dialog.params.prefill ?? "");
	const answer = (text?: string) => answerDialog(threadId, dialog, text === undefined ? {} : { value: text });
	const keys = (e: React.KeyboardEvent) => {
		if (!editor && matches(e, "desktop.composer.send")) {
			e.preventDefault();
			answer(value);
		} else if (matches(e, "desktop.picker.dismiss")) {
			e.preventDefault();
			answer();
		}
	};
	return (
		<div className="mx-auto w-full max-w-3xl px-4 pb-4">
			<div className={CARD}>
				<div className="px-4 pt-4 pb-2 text-base leading-5 font-medium [overflow-wrap:anywhere] text-ink">
					{dialog.params.title}
				</div>
				<div className="px-4">
					{editor ? (
						<textarea
							autoFocus
							value={value}
							aria-label={dialog.params.title}
							onChange={(e) => setValue(e.target.value)}
							onKeyDown={keys}
							rows={8}
							className="kc-input w-full resize-y rounded-lg px-3 py-2 font-code text-code"
						/>
					) : (
						<input
							autoFocus
							value={value}
							aria-label={dialog.params.title}
							placeholder={dialog.params.placeholder}
							onChange={(e) => setValue(e.target.value)}
							onKeyDown={keys}
							className="kc-input h-8 w-full rounded-full px-3"
						/>
					)}
				</div>
				<div className="flex items-center justify-end gap-2 px-4 pt-3 pb-4">
					<Button variant="outline" pill className="gap-1.5 px-2" onClick={() => answer()}>
						Cancel <Kbd>Esc</Kbd>
					</Button>
					<Button variant="solid" pill className="gap-1.5 px-2" onClick={() => answer(value)}>
						Submit {editor ? null : <Kbd>⏎</Kbd>}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function DialogCard({ threadId, dialog }: { threadId: string; dialog: Dialog }) {
	switch (dialog.params.kind) {
		case "select":
			return <SelectCard threadId={threadId} dialog={dialog} />;
		case "confirm":
			return <ConfirmCard threadId={threadId} dialog={dialog} />;
		default:
			return <TextCard threadId={threadId} dialog={dialog} />;
	}
}
