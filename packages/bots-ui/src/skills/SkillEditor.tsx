// Write or edit a skill: a name, a one-line "when to use it", and the steps. A skill a bot saved can be shared with
// all bots; catalog skills are read-only until added.
import type { Skill } from "@knightcode/bots-protocol";
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Input, Textarea } from "../primitives/Input.tsx";
import { useStore } from "../state/store.ts";

/** New when `skill` is undefined. */
export function SkillEditor({ skill, onClose, onSaved }: { skill?: Skill; onClose: () => void; onSaved: () => void }) {
	const store = useStore();
	const [name, setName] = useState(skill?.name ?? "");
	const [description, setDescription] = useState(skill?.description ?? "");
	const [content, setContent] = useState(skill?.content ?? "");
	const readOnly = skill?.scope === "catalog" || skill?.scope === "app";
	const done = () => {
		onSaved();
		onClose();
	};
	const save = async () => {
		const fields = { name: name.trim(), description: description.trim(), content };
		if (skill) await store.api.updateSkill({ id: skill.id, ...fields });
		else await store.api.createSkill(fields);
		done();
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title={skill ? skill.name : "New skill"}
			width={560}
			footer={
				<>
					{skill && !readOnly && (
						<Button variant="secondary" onClick={() => void store.api.deleteSkill({ id: skill.id }).then(done)}>
							Delete
						</Button>
					)}
					{skill?.scope === "bot" && (
						<Button variant="secondary" onClick={() => void store.api.shareSkill({ id: skill.id }).then(done)}>
							Share with all bots
						</Button>
					)}
					<span className="kb-create__spacer" />
					<Button variant="secondary" onClick={onClose}>
						{readOnly ? "Close" : "Cancel"}
					</Button>
					{!readOnly && (
						<Button variant="primary" disabled={!name.trim()} onClick={() => void save()}>
							Save
						</Button>
					)}
				</>
			}
		>
			<div className="kb-dialog__body kb-settings">
				<Input
					aria-label="Skill name"
					placeholder="Name"
					value={name}
					readOnly={readOnly}
					onChange={(e) => setName(e.target.value)}
				/>
				<Input
					aria-label="When to use it"
					placeholder="When to use it, in one line"
					value={description}
					readOnly={readOnly}
					onChange={(e) => setDescription(e.target.value)}
				/>
				<Textarea
					aria-label="Steps"
					placeholder="The steps"
					rows={10}
					value={content}
					readOnly={readOnly}
					onChange={(e) => setContent(e.target.value)}
				/>
			</div>
		</Dialog>
	);
}
