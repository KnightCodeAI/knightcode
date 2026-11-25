/** Host-owned setup and trust prompts, independent of the replaceable home presenter. */

import { type ReactNode, useEffect, useState } from "react";
import { client } from "../client.ts";

import { addProject, errorText, navigate, selectProjects, showNew, toast, useStore } from "../store.ts";
import { Button } from "../components/button.tsx";

import { FolderPlus, LogIn, ShieldAlert } from "../components/icons.tsx";

function SetupCard({
	icon,
	title,
	detail,
	action,
	onAction,
	onLater,
	busy,
}: {
	icon: ReactNode;
	title: string;
	detail: string;
	action: string;
	onAction: () => void;
	onLater?: () => void;
	busy?: boolean;
}) {
	return (
		<div className="flex w-full flex-wrap items-center gap-3 rounded-2xl bg-soft-alt px-4 py-3 shadow-[0_0_0_0.5px_var(--kc-border)]">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-secondary">
				{icon}
			</span>
			<div className="min-w-40 flex-1">
				<div className="text-base text-ink">{title}</div>
				<div className="text-sm text-tertiary">{detail}</div>
			</div>
			<div className="ml-auto flex shrink-0 gap-2">
				{onLater ? (
					<Button size="lg" squircle className="px-4" disabled={busy} onClick={onLater}>
						Not now
					</Button>
				) : null}
				<Button variant="solid" size="lg" squircle className="px-4" disabled={busy} onClick={onAction}>
					{action}
				</Button>
			</div>
		</div>
	);
}

const later = new Set<string>();

function TrustCard({ cwd }: { cwd: string }) {
	const [asking, setAsking] = useState<string | null>(null);

	const [saving, setSaving] = useState(false);
	useEffect(() => {
		let current = true;

		void client
			.request("project/trust/read", { cwd })
			.then((r) => current && setAsking(r.needsTrust && r.trusted === null && !later.has(r.project) ? r.project : null))
			.catch((e: unknown) => current && toast(errorText(e), "error"));
		return () => {
			current = false;
		};
	}, [cwd]);
	return asking !== null ? (
		<SetupCard
			icon={<ShieldAlert size={16} />}
			title="This project has its own extensions, skills and settings. Trust it?"
			detail="Once trusted, its extensions can run code on this computer."
			action="Trust"
			busy={saving}
			onAction={() => {
				setSaving(true);
				void client
					.request("project/trust/set", { cwd, trusted: true })
					.then(() => setAsking(null))
					.catch((e: unknown) => toast(errorText(e), "error"))
					.finally(() => setSaving(false));
			}}
			onLater={() => {
				later.add(asking);
				setAsking(null);
			}}
		/>
	) : null;
}

/** Host-owned setup and trust prompts are not replaceable home sections. */
export function HomeSetup({ cwd }: { cwd?: string }) {
	const accounts = useStore((s) => s.accounts);
	const models = useStore((s) => s.models);
	const projects = useStore(selectProjects);
	const signedOut = accounts !== undefined && accounts.accounts.length === 0 && models.length === 0;
	return (
		<>
			{signedOut ? (
				<SetupCard
					icon={<LogIn size={16} />}
					title="Sign in to a model provider to start"
					detail="Sign-ins are shared with the KnightCode terminal."
					action="Sign in"
					onAction={() => navigate({ kind: "settings", page: "models" })}
				/>
			) : null}
			{projects.length === 0 && !cwd ? (
				<SetupCard
					icon={<FolderPlus size={16} />}
					title="Add a project folder"
					detail="KnightCode works in the folder you choose."
					action="Add folder"
					onAction={() => void addProject().then((path) => path && showNew(path))}
				/>
			) : null}
			{cwd ? <TrustCard key={cwd} cwd={cwd} /> : null}
		</>
	);
}
