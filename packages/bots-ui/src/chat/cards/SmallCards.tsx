// The smaller cards: a drafted skill, a settings change with Undo, a request for a secret, and "Run setup".
import type { Card, SkillDraft } from "@knightcode/bots-protocol";
import { KeyRound, Settings2, Sparkles, Wand2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../primitives/Button.tsx";
import { Input, Textarea } from "../../primitives/Input.tsx";

/** A skill the bot drafted from what it just did: edit it, save it, or discard it. */
export function SkillDraftCard({
	card,
	onSave,
	onDiscard,
}: {
	card: Extract<Card, { type: "skill-draft" }>;
	onSave: (draft: SkillDraft) => void;
	onDiscard: () => void;
}) {
	const [draft, setDraft] = useState(card.draft);
	const [editing, setEditing] = useState(false);
	const open = card.state === "draft";
	return (
		<div className="kb-msg-card" role="group" aria-label={`Skill draft: ${draft.name}`}>
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className="kb-tool-icon kb-tool-icon--soft" aria-hidden>
						<Sparkles size={20} strokeWidth={1.75} />
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">{draft.name}</p>
						<div className="kb-connect-card__description">
							{open ? draft.description : card.state === "saved" ? "Saved as a skill" : "Discarded"}
						</div>
					</div>
				</div>
				{open && editing && (
					<div className="kb-card-body kb-card-form">
						<Input
							aria-label="Skill name"
							value={draft.name}
							onChange={(e) => setDraft({ ...draft, name: e.target.value })}
						/>
						<Input
							aria-label="When to use it"
							value={draft.description}
							onChange={(e) => setDraft({ ...draft, description: e.target.value })}
						/>
						<Textarea
							aria-label="Steps"
							value={draft.content}
							onChange={(e) => setDraft({ ...draft, content: e.target.value })}
						/>
					</div>
				)}
				{open && (
					<div className="kb-card-actions">
						<Button variant="secondary" onClick={onDiscard}>
							Discard
						</Button>
						<Button variant="secondary" onClick={() => setEditing(!editing)}>
							{editing ? "Done editing" : "Edit"}
						</Button>
						<Button variant="primary" onClick={() => onSave(draft)}>
							Save skill
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}

/** A change the bot made to its own settings from chat, with Undo. */
export function SettingsChangeCard({
	card,
	onUndo,
}: {
	card: Extract<Card, { type: "settings-change" }>;
	onUndo: () => void;
}) {
	return (
		<div className="kb-msg-card" role="group" aria-label={`Changed ${card.field}`}>
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className="kb-tool-icon kb-tool-icon--soft" aria-hidden>
						<Settings2 size={20} strokeWidth={1.75} />
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">
							{card.undone ? "Undone: " : "Changed "}
							{card.field}
						</p>
						<div className="kb-connect-card__description">
							{card.before} → {card.after}
						</div>
					</div>
					{!card.undone && (
						<Button variant="secondary" onClick={onUndo}>
							Undo
						</Button>
					)}
				</div>
			</section>
		</div>
	);
}

/** The bot asks for a secret; it is typed here, shown its origin first, and never appears in the chat. */
export function SecretRequestCard({
	card,
	onAnswer,
}: {
	card: Extract<Card, { type: "secret-request" }>;
	onAnswer: (value: string | undefined) => void;
}) {
	const [value, setValue] = useState("");
	const open = card.state === "open";
	return (
		<div className="kb-msg-card" role="group" aria-label={`Secret request: ${card.name}`}>
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className="kb-tool-icon kb-tool-icon--soft" aria-hidden>
						<KeyRound size={20} strokeWidth={1.75} />
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">{card.name}</p>
						<div className="kb-connect-card__description">
							{open ? `For ${card.origin}` : card.state === "saved" ? "Saved to your vault" : "Dismissed"}
						</div>
					</div>
				</div>
				{open && (
					<form
						className="kb-card-actions"
						onSubmit={(event) => {
							event.preventDefault();
							if (value) onAnswer(value);
						}}
					>
						<Input
							type="password"
							autoComplete="off"
							aria-label={`${card.name} value`}
							placeholder="Paste the value"
							value={value}
							onChange={(e) => setValue(e.target.value)}
						/>
						<Button variant="secondary" onClick={() => onAnswer(undefined)}>
							Dismiss
						</Button>
						<Button variant="primary" type="submit" disabled={!value}>
							Save
						</Button>
					</form>
				)}
			</section>
		</div>
	);
}

/** An imported bot's setup skill, run only when the user presses the button. */
export function RunSetupCard({ card, onRun }: { card: Extract<Card, { type: "run-setup" }>; onRun: () => void }) {
	return (
		<div className="kb-msg-card" role="group" aria-label="Run setup">
			<section className="kb-msg-card__surface">
				<div className="kb-connect-card">
					<span className="kb-tool-icon kb-tool-icon--soft" aria-hidden>
						<Wand2 size={20} strokeWidth={1.75} />
					</span>
					<div className="kb-connect-card__text">
						<p className="kb-connect-card__name">Set this bot up</p>
						<div className="kb-connect-card__description">Runs the "{card.skill}" skill that came with it</div>
					</div>
					<Button variant="primary" onClick={onRun}>
						Run setup
					</Button>
				</div>
			</section>
		</div>
	);
}
