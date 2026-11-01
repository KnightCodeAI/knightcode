// A skill the bot drafted from what it just did (or from a taught task): Edit, Save, Test (run it once), Add to routine,
// or Discard.
import type { Card, SkillDraft } from "@knightcode/bots-protocol";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Input, Textarea } from "../primitives/Input.tsx";

export interface DraftSkillCardProps {
	card: Extract<Card, { type: "skill-draft" }>;
	onSave: (draft: SkillDraft) => void;
	onDiscard: () => void;
	onTest: (draft: SkillDraft) => void;
	onAddToRoutine: (draft: SkillDraft) => void;
}

/** The card in the chat. */
export function DraftSkillCard({ card, onSave, onDiscard, onTest, onAddToRoutine }: DraftSkillCardProps) {
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
						<Button variant="secondary" onClick={() => onTest(draft)}>
							Test
						</Button>
						<Button variant="secondary" onClick={() => onAddToRoutine(draft)}>
							Add to routine
						</Button>
						<Button variant="primary" onClick={() => onSave(draft)}>
							Save
						</Button>
					</div>
				)}
			</section>
		</div>
	);
}
