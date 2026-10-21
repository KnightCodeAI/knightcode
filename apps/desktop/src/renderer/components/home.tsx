/**
 * The new-thread screen (desktop-shell.md section 9.12), as Codex's home (measured 2026-10-19): the mark, faint and
 * large, over "What should we build in ‹project›?" (28px; the project's name opens the project picker), centred in
 * the space above the composer, which sits at the bottom with its utility bar. Before the first sign-in or project, a
 * card offers it above the title. In a short window the space around the title gives way first, then the title's
 * own top, so the composer stays on screen.
 */

import { type ReactNode, useEffect, useState } from "react";
import { basename } from "../format.ts";
import { addProject, navigate, selectProjects, showNew, useStore } from "../store.ts";
import { Button } from "./button.tsx";
import { Composer } from "./composer.tsx";
import { ProjectPicker } from "./composer-pickers.tsx";
import { FolderPlus, KnightMark, LogIn } from "./icons.tsx";

/** A prompt card above the title: sign in, add a folder. */
function SetupCard({
	icon,
	title,
	detail,
	action,
	onAction,
}: {
	icon: ReactNode;
	title: string;
	detail: string;
	action: string;
	onAction: () => void;
}) {
	return (
		<div className="flex w-full items-center gap-3 rounded-2xl bg-soft-alt px-4 py-3 shadow-[0_0_0_0.5px_var(--kc-border)]">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-secondary">
				{icon}
			</span>
			<div className="min-w-0 flex-1">
				<div className="text-base text-ink">{title}</div>
				<div className="text-sm text-tertiary">{detail}</div>
			</div>
			<Button variant="solid" size="lg" squircle className="px-4" onClick={onAction}>
				{action}
			</Button>
		</div>
	);
}

export function Home({ cwd: requested }: { cwd?: string }) {
	const accounts = useStore((s) => s.accounts);
	const models = useStore((s) => s.models);
	const projects = useStore(selectProjects);
	const [cwd, setCwd] = useState<string | undefined>(requested ?? projects[0]?.path);
	useEffect(() => {
		if (requested) setCwd(requested);
	}, [requested]);
	useEffect(() => {
		if (!cwd && projects[0]) setCwd(projects[0].path);
	}, [cwd, projects]);
	const signedOut = accounts !== undefined && accounts.accounts.length === 0 && models.length === 0;
	return (
		// Codex leaves its header's 52px and a 46px band above the layout, then bottom-aligns the hero 96px over its own
		// box, which ends 124px above the composer block (measured 2026-10-19 at a 1365 by 830 window, equal inner sizes).
		// Those gaps are spacers that shrink before the hero does, and the hero clips from its top.
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<div aria-hidden className="min-h-0 flex-[1_1_122px]" />
			<div className="mx-auto flex min-h-0 w-full max-w-3xl shrink-[0.1] flex-col items-center justify-end gap-6 overflow-hidden px-5">
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
				<KnightMark size={56} className="text-ink opacity-30" />
				<h1 className="text-center text-xl leading-[33.6px] font-normal text-ink">
					What should we build
					{cwd ? (
						<>
							{" in "}
							<ProjectPicker
								cwd={cwd}
								onChange={setCwd}
								side="bottom"
								trigger={() => (
									<button
										type="button"
										className="inline-block max-w-full align-baseline break-words underline decoration-tertiary decoration-dotted decoration-1 underline-offset-4 hover:text-secondary"
									>
										{basename(cwd)}?
									</button>
								)}
							/>
						</>
					) : (
						"?"
					)}
				</h1>
			</div>
			<div aria-hidden className="min-h-0 shrink basis-[220px]" />
			<div className="shrink-0">
				<Composer project={{ cwd, onChange: setCwd }} />
			</div>
		</div>
	);
}
