// A routine's standing grant: which actions, on which targets, within which limits. A run started by outside text (a
// webhook, an email, a GitHub event) may act only within it; outside text never widens it.
import type { Grant } from "@knightcode/bots-protocol";
import { Input } from "../primitives/Input.tsx";

const ACTIONS: [string, string][] = [
	["comment", "Comment on issues and pull requests"],
	["post", "Post messages"],
	["email.send", "Send email"],
	["email.draft", "Draft email"],
	["issue.create", "Create issues"],
	["files.write", "Change files"],
	["connector.write", "Write to connected apps"],
];

/** The grant fields. */
export function GrantEditor({ value, onChange }: { value: Grant; onChange: (grant: Grant) => void }) {
	const toggle = (action: string, on: boolean) =>
		onChange({ ...value, actions: on ? [...value.actions, action] : value.actions.filter((a) => a !== action) });
	const number = (text: string) => (text.trim() ? Math.max(0, Math.floor(Number(text))) || 0 : undefined);
	return (
		<fieldset className="kb-grant">
			<legend className="kb-settings__label">Allowed actions</legend>
			<p className="kb-settings__hint">
				When outside text starts a run (a webhook, an email, a GitHub event), the bot may only do these.
			</p>
			<div className="kb-trigger__checks">
				{ACTIONS.map(([action, text]) => (
					<label key={action} className="kb-recipe__check">
						<input
							type="checkbox"
							checked={value.actions.includes(action)}
							onChange={(e) => toggle(action, e.target.checked)}
						/>
						<span>{text}</span>
					</label>
				))}
			</div>
			<Input
				aria-label="On these targets"
				placeholder="On these targets, for example owner/repo, #channel (comma separated)"
				value={value.targets.join(", ")}
				onChange={(e) =>
					onChange({
						...value,
						targets: e.target.value
							.split(",")
							.map((s) => s.trim())
							.filter(Boolean),
					})
				}
			/>
			<div className="kb-grant__limits">
				<Input
					aria-label="At most per day"
					placeholder="At most per day"
					inputMode="numeric"
					value={value.limits.perDay ?? ""}
					onChange={(e) => onChange({ ...value, limits: { ...value.limits, perDay: number(e.target.value) } })}
				/>
				<Input
					aria-label="At most per run"
					placeholder="At most per run"
					inputMode="numeric"
					value={value.limits.perRun ?? ""}
					onChange={(e) => onChange({ ...value, limits: { ...value.limits, perRun: number(e.target.value) } })}
				/>
			</div>
		</fieldset>
	);
}
