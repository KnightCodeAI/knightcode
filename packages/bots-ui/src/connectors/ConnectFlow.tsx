// Connecting an app: its skills on one checkbox (ticked by default), a usage note, an API key when the app needs one,
// and the one-line notice naming a third party that processes its data, when one does. OAuth opens in a new window.
import type { CatalogEntry } from "@knightcode/bots-protocol";
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { useStore } from "../state/store.ts";
import { USAGE_NOTE_MAX, UsageNote } from "./UsageNote.tsx";

/** The connect step for one app. */
export function ConnectFlow({
	entry,
	onConnected,
	onCancel,
}: {
	entry: CatalogEntry;
	onConnected: () => void;
	onCancel: () => void;
}) {
	const store = useStore();
	const [skills, setSkills] = useState(true);
	const [note, setNote] = useState(entry.usageNote ?? "");
	const [apiKey, setApiKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [problem, setProblem] = useState<string>();
	const needsKey = entry.auth === "api_key";
	const connect = async () => {
		setBusy(true);
		setProblem(undefined);
		try {
			const result = await store.api.connectApp({ appId: entry.id, skills, apiKey: needsKey ? apiKey : undefined });
			if (result.authorizeUrl) window.open(result.authorizeUrl, "_blank", "popup,noopener,noreferrer");
			if (note !== (entry.usageNote ?? "")) await store.api.updateConnection({ appId: entry.id, usageNote: note });
			onConnected();
		} catch (cause) {
			setProblem(cause instanceof Error ? cause.message : "Could not connect. Try again.");
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="kb-connect-flow">
			{entry.skills.length > 0 && (
				<label className="kb-recipe__check">
					<input type="checkbox" checked={skills} onChange={(event) => setSkills(event.target.checked)} />
					<span>
						Add {entry.name}'s skills
						<span className="kb-connect-flow__skills">{entry.skills.map((s) => s.description).join(" · ")}</span>
					</span>
				</label>
			)}
			{needsKey && (
				<Input
					type="password"
					autoComplete="off"
					aria-label={`${entry.name} API key`}
					placeholder="API key"
					value={apiKey}
					onChange={(e) => setApiKey(e.target.value)}
				/>
			)}
			<div className="kb-settings__field">
				<div className="kb-settings__label">Usage note</div>
				<p className="kb-settings__hint">The bot always follows this when it uses {entry.name}.</p>
				<UsageNote value={note} onChange={setNote} />
			</div>
			{entry.notice && (
				<p className="kb-connect-flow__notice" data-testid="processor-notice">
					{entry.notice}
				</p>
			)}
			{problem && (
				<p className="kb-create__error" role="alert">
					{problem}
				</p>
			)}
			<div className="kb-settings__row">
				<Button variant="secondary" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					variant="primary"
					disabled={busy || note.length > USAGE_NOTE_MAX || (needsKey && !apiKey)}
					onClick={() => void connect()}
				>
					Connect {entry.name}
				</Button>
			</div>
		</div>
	);
}
