// Add skills from a GitHub repository: preview what it holds, tick the ones to add. The server fetches the repository;
// skill scripts never run.
import type { SkillDraft } from "@knightcode/bots-protocol";
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Input } from "../primitives/Input.tsx";
import { useStore } from "../state/store.ts";

/** The preview-then-add dialog. */
export function FromGitHub({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
	const store = useStore();
	const [url, setUrl] = useState("");
	const [found, setFound] = useState<SkillDraft[]>();
	const [chosen, setChosen] = useState<string[]>([]);
	const [problem, setProblem] = useState<string>();
	const preview = async () => {
		setProblem(undefined);
		try {
			const { skills } = await store.api.previewGitHubSkills({ url: url.trim() });
			setFound(skills);
			setChosen(skills.map((s) => s.name));
		} catch (cause) {
			setProblem(cause instanceof Error ? cause.message : "Could not read that repository.");
		}
	};
	const add = async () => {
		await store.api.addGitHubSkills({ url: url.trim(), names: chosen });
		onAdded();
		onClose();
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title="Add skills from GitHub"
			width={560}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					{found ? (
						<Button variant="primary" disabled={chosen.length === 0} onClick={() => void add()}>
							Add {chosen.length === 1 ? "1 skill" : `${chosen.length} skills`}
						</Button>
					) : (
						<Button
							variant="primary"
							disabled={!/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+/.test(url.trim())}
							onClick={() => void preview()}
						>
							Preview
						</Button>
					)}
				</>
			}
		>
			<div className="kb-dialog__body kb-settings">
				<Input
					aria-label="Repository URL"
					placeholder="https://github.com/owner/repo"
					value={url}
					onChange={(e) => (setUrl(e.target.value), setFound(undefined))}
				/>
				{problem && (
					<p className="kb-create__error" role="alert">
						{problem}
					</p>
				)}
				{found && found.length === 0 && <p className="kb-settings__hint">No skills found in that repository.</p>}
				{found?.map((skill) => (
					<label key={skill.name} className="kb-recipe__check">
						<input
							type="checkbox"
							checked={chosen.includes(skill.name)}
							onChange={(e) =>
								setChosen((list) => (e.target.checked ? [...list, skill.name] : list.filter((n) => n !== skill.name)))
							}
						/>
						<span>
							{skill.name}: {skill.description}
						</span>
					</label>
				))}
			</div>
		</Dialog>
	);
}
