// One app's page inside Connect Apps: what it is, and either the connect step or, once connected, its usage note,
// permissions, skills (removable without disconnecting) and Disconnect.
import type { CatalogEntry } from "@knightcode/bots-protocol";
import { ChevronLeft, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { navigate, useQueryParam } from "../shell/routes.ts";
import { useResource, useStore } from "../state/store.ts";
import { AppTile } from "./Catalog.tsx";
import { ConnectFlow } from "./ConnectFlow.tsx";
import { ConnectorPermissions } from "./ConnectorPermissions.tsx";
import { USAGE_NOTE_MAX, UsageNote } from "./UsageNote.tsx";

/** The page for `appId`. ?connect=1 opens the connect step directly. */
export function ConnectorPage({ appId }: { appId: string }) {
	const store = useStore();
	const key = `catalog:${appId}`;
	const { data: entry } = useResource(key, (api) => api.getCatalogEntry({ appId }));
	const [connecting, setConnecting] = useState(useQueryParam("connect") !== null);
	const refresh = () => {
		store.reload(key);
		store.reload("catalog");
		store.reload("skills:all");
	};
	if (!entry) return <div className="kb-browser__scroll" />;
	const connected = entry.connection?.status === "connected";
	return (
		<div className="kb-browser__scroll kb-connector">
			<button type="button" className="kb-browser__back" onClick={() => navigate("/connectors")}>
				<ChevronLeft size={14} /> All apps
			</button>
			<div className="kb-connector__head">
				<AppTile entry={entry} size={56} />
				<div className="kb-connector__title">
					<h3 className="kb-connector__name">{entry.name}</h3>
					<p className="kb-connector__maker">{entry.maker}</p>
				</div>
				{!connected && !connecting && (
					<Button variant="primary" onClick={() => setConnecting(true)}>
						{entry.connection?.status === "reconnect" ? "Reconnect" : "Connect"}
					</Button>
				)}
				{connected && (
					<Button variant="secondary" onClick={() => void store.api.disconnectApp({ appId }).then(refresh)}>
						Disconnect
					</Button>
				)}
			</div>
			<p className="kb-connector__description">{entry.description}</p>
			{connecting && !connected && (
				<ConnectFlow
					entry={entry}
					onCancel={() => setConnecting(false)}
					onConnected={() => {
						setConnecting(false);
						refresh();
					}}
				/>
			)}
			{connected && <Connected entry={entry} onChange={refresh} />}
		</div>
	);
}

function Connected({ entry, onChange }: { entry: CatalogEntry; onChange: () => void }) {
	const store = useStore();
	const [note, setNote] = useState(entry.usageNote ?? "");
	useEffect(() => setNote(entry.usageNote ?? ""), [entry.usageNote]);
	const { data } = useResource("skills:all", (api) => api.listSkills({}));
	const skills = (data?.skills ?? []).filter((s) => s.appId === entry.id);
	return (
		<>
			<section className="kb-settings__field">
				<div className="kb-settings__label">Usage note</div>
				<UsageNote
					value={note}
					onChange={setNote}
					onBlur={() => {
						if (note !== (entry.usageNote ?? "") && note.length <= USAGE_NOTE_MAX)
							void store.api.updateConnection({ appId: entry.id, usageNote: note }).then(onChange);
					}}
				/>
			</section>
			<section className="kb-settings__field">
				<div className="kb-settings__label">Permissions</div>
				<ConnectorPermissions
					value={entry.permissions}
					onChange={(permissions) => void store.api.updateConnection({ appId: entry.id, permissions }).then(onChange)}
				/>
			</section>
			{skills.length > 0 && (
				<section className="kb-settings__field">
					<div className="kb-settings__label">Skills</div>
					<ul className="kb-knowledge__list">
						{skills.map((skill) => (
							<li key={skill.id} className="kb-knowledge__item">
								<span className="kb-knowledge__name">
									{skill.name}: {skill.description}
								</span>
								<button
									type="button"
									className="kb-chip__remove"
									aria-label={`Remove ${skill.name}`}
									onClick={() => void store.api.deleteSkill({ id: skill.id }).then(onChange)}
								>
									<X size={12} />
								</button>
							</li>
						))}
					</ul>
				</section>
			)}
		</>
	);
}
