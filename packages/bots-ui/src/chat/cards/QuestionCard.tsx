// A question from the bot with lettered choices; once answered it shows the answer and dims the question.
import type { Card } from "@knightcode/bots-protocol";

type QuestionCardData = Extract<Card, { type: "question" }>;

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Choices are keyed A, B, C...; the chosen one keeps its letter after answering. */
export function QuestionCard({ card, onAnswer }: { card: QuestionCardData; onAnswer: (value: string) => void }) {
	const answered = card.answer !== undefined;
	const shown = answered ? card.choices.filter((choice) => choice === card.answer) : card.choices;
	const answerShown = answered && shown.length === 0 ? [card.answer!] : shown;
	return (
		<div className="kb-msg-card" role="group" aria-label={card.question} data-ref="card">
			<section className="kb-msg-card__surface">
				<div className="kb-msg-card__head">
					<p
						className={`kb-msg-card__question${answered ? " kb-msg-card__question--answered" : ""}`}
						data-ref="card-question"
					>
						{card.question}
					</p>
				</div>
				<div className="kb-answers" role="group" aria-label="Your answer" data-ref="card-answer">
					{answerShown.map((choice) => {
						const letter = LETTERS[Math.max(0, card.choices.indexOf(choice))] ?? "•";
						return (
							<button
								key={choice}
								type="button"
								className="kb-answer"
								aria-pressed={answered}
								disabled={answered}
								onClick={() => onAnswer(choice)}
							>
								<span className="kb-keycap" data-ref="card-key">
									{letter}
								</span>
								<span className="kb-answer__text" data-ref="card-choice">
									{choice}
								</span>
							</button>
						);
					})}
				</div>
			</section>
		</div>
	);
}
