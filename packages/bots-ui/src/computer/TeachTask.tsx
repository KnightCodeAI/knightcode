// Teach a task: the user does it once on the bot's screen while it records, then the recording becomes a skill draft
// to edit and save, or discard.
import type { SkillDraft } from "@knightcode/bots-protocol";
import { Circle, Square } from "lucide-react";
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Input, Textarea } from "../primitives/Input.tsx";
import { useToast } from "../primitives/Toast.tsx";
import { useStore } from "../state/store.ts";

type Phase = { kind: "goal" } | { kind: "recording"; sessionId: string } | { kind: "draft"; draft: SkillDraft };

/** The panel under the screen. Recording takes control of the screen; stopping hands it back. */
export function TeachTask({
	botId,
	onTake,
	onClose,
}: {
	botId: string;
	onTake: (take: boolean) => Promise<void>;
	onClose: () => void;
}) {
	const store = useStore();
	const toast = useToast();
	const [goal, setGoal] = useState("");
	const [phase, setPhase] = useState<Phase>({ kind: "goal" });
	const start = async () => {
		const { sessionId } = await store.api.startTeaching({ botId, goal: goal.trim() || "A task" });
		await onTake(true);
		setPhase({ kind: "recording", sessionId });
	};
	const stop = async (sessionId: string) => {
		const draft = await store.api.stopTeaching({ botId, sessionId });
		await onTake(false);
		setPhase({ kind: "draft", draft });
	};
	return (
		<section className="kb-dock" aria-label="Teach a task">
			<header className="kb-dock__head">
				<span>Teach a task</span>
				<button type="button" className="kb-link-button" onClick={onClose}>
					Close
				</button>
			</header>
			{phase.kind === "goal" && (
				<div className="kb-dock__body">
					<p className="kb-settings__hint">
						Do the task once on the screen. The bot watches and writes it up as a skill.
					</p>
					<Input
						aria-label="What are you teaching?"
						placeholder="What are you teaching?"
						value={goal}
						onChange={(e) => setGoal(e.target.value)}
					/>
					<Button variant="primary" size="sm" onClick={() => void start()}>
						<Circle size={10} fill="currentColor" /> Start recording
					</Button>
				</div>
			)}
			{phase.kind === "recording" && (
				<div className="kb-dock__body">
					<p className="kb-teach__live" role="status">
						<span className="kb-control__dot" aria-hidden /> Recording. Do the task on the screen.
					</p>
					<Button variant="primary" size="sm" onClick={() => void stop(phase.sessionId)}>
						<Square size={10} fill="currentColor" /> Stop recording
					</Button>
				</div>
			)}
			{phase.kind === "draft" && (
				<DraftEditor
					draft={phase.draft}
					onDiscard={onClose}
					onSave={async (draft) => {
						await store.api.createSkill({ ...draft, botId });
						toast({ text: `Saved the skill "${draft.name}"` });
						onClose();
					}}
				/>
			)}
		</section>
	);
}

function DraftEditor({
	draft,
	onSave,
	onDiscard,
}: {
	draft: SkillDraft;
	onSave: (draft: SkillDraft) => Promise<void>;
	onDiscard: () => void;
}) {
	const [value, setValue] = useState(draft);
	return (
		<div className="kb-dock__body">
			<Input
				aria-label="Skill name"
				value={value.name}
				onChange={(e) => setValue({ ...value, name: e.target.value })}
			/>
			<Input
				aria-label="When to use it"
				value={value.description}
				onChange={(e) => setValue({ ...value, description: e.target.value })}
			/>
			<Textarea
				aria-label="Steps"
				rows={6}
				value={value.content}
				onChange={(e) => setValue({ ...value, content: e.target.value })}
			/>
			<div className="kb-settings__row">
				<Button variant="secondary" size="sm" onClick={onDiscard}>
					Discard
				</Button>
				<Button variant="primary" size="sm" disabled={!value.name.trim()} onClick={() => void onSave(value)}>
					Save skill
				</Button>
			</div>
		</div>
	);
}
