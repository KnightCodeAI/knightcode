/**
 * The "Open" split button in a file tab's toolbar: the preferred app's icon and
 * "Open", then a chevron listing every app found (host/openIn/list, in its order), then "Open in folder", "Open
 * in GitHub" when the checkout's origin is on GitHub, and "Save as…". Choosing an app remembers it for the project and
 * as the default.
 */

import { useEffect, useState } from "react";
import type { OpenInTargetInfo } from "../../shared/host-protocol.ts";
import { client } from "../client.ts";
import { githubLink } from "../github.ts";
import { errorText, getState, selectPreferences, setPreference, toast, useStore } from "../store.ts";
import { AppWindow, ChevronDown } from "./icons.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./menu.tsx";
import { Tooltip } from "./tooltip.tsx";

let cached: { at: number; targets: Promise<OpenInTargetInfo[]> } | undefined;

/** The apps to open in; main detects them at most once a minute, and so does this. */
function loadTargets(): Promise<OpenInTargetInfo[]> {
	if (!cached || Date.now() - cached.at >= 60_000) {
		const targets = client.host("host/openIn/list", {}).then((r) => r.targets);
		targets.catch(() => (cached = undefined));
		cached = { at: Date.now(), targets };
	}
	return cached.targets;
}

export function useOpenInTargets(): OpenInTargetInfo[] | undefined {
	const [targets, setTargets] = useState<OpenInTargetInfo[]>();
	useEffect(() => {
		let live = true;
		void loadTargets().then(
			(t) => live && setTargets(t),
			() => live && setTargets([]),
		);
		return () => {
			live = false;
		};
	}, []);
	return targets;
}

/** Open `path` in an app, reporting a failure as "Unable to open item". */
export function openIn(targetId: string, path: string, line?: number): void {
	void client
		.host("host/openIn/open", { targetId, path, ...(line ? { line } : {}) })
		.catch((e: unknown) => toast(`Unable to open item: ${errorText(e)}`, "error"));
}

/** The app the Open button uses for a project: its own choice, else the last one picked, else the first found. */
export function usePreferredTarget(targets: OpenInTargetInfo[] | undefined, project: string) {
	const chosen = useStore((s) => {
		const openIn = selectPreferences(s).openIn;
		return openIn?.perPath?.[project] ?? openIn?.global;
	});
	const apps = targets?.filter((t) => t.kind !== "fileManager");
	return apps?.find((t) => t.id === chosen) ?? apps?.find((t) => t.kind === "editor") ?? apps?.[0];
}

function rememberTarget(project: string, targetId: string): void {
	const openIn = selectPreferences(getState()).openIn;
	setPreference("openIn", { global: targetId, perPath: { ...openIn?.perPath, [project]: targetId } });
}

/** An app's own icon at 18px, or a plain window when it has none (the default app). */
export function TargetIcon({ target }: { target: OpenInTargetInfo }) {
	if (target.icon) return <img alt="" src={target.icon} className="size-[18px] shrink-0" />;
	return <AppWindow size={18} className="shrink-0 text-secondary" />;
}

/** "Save as…": a copy where the user picks, with a message when it fails. */
function saveCopy(path: string): void {
	void client.host("host/file/saveCopy", { path }).catch(() => toast("Could not download artifact", "error"));
}

export function OpenInButton({
	path,
	line,
	project,
	threadId,
}: {
	path: string;
	line?: number;
	project: string;
	threadId?: string;
}) {
	const targets = useOpenInTargets();
	const preferred = usePreferredTarget(targets, project);
	const folder = targets?.find((t) => t.kind === "fileManager");
	const [github, setGithub] = useState<string>();
	// Asked each time the menu opens: a push or a branch switch shows at once.
	const onOpenChange = (open: boolean) => {
		if (!open || !threadId) return;
		void client.request("git/origin", { threadId }).then(
			(origin) => setGithub(githubLink(origin, path, line)),
			() => setGithub(undefined),
		);
	};
	return (
		<div className="kc-capsule inline-flex h-8 shrink-0 items-center rounded-full p-0.5">
			<Tooltip content={preferred ? `Open in ${preferred.name}` : "Open"}>
				<button
					type="button"
					aria-label={preferred ? `Open in ${preferred.name}` : "Open"}
					disabled={!preferred}
					onClick={() => preferred && openIn(preferred.id, path, line)}
					className="flex h-7 items-center gap-1.5 rounded-s-full ps-2 pe-1 text-[13px] leading-[18px] text-ink hover:bg-ghost-hover disabled:opacity-50"
				>
					{preferred ? <TargetIcon target={preferred} /> : null}
					<span className="whitespace-nowrap">Open</span>
				</button>
			</Tooltip>
			<Menu onOpenChange={onOpenChange}>
				<MenuTrigger>
					<button
						type="button"
						aria-label="Open options"
						className="flex h-7 items-center rounded-e-full ps-0.5 pe-1.5 text-ink hover:bg-ghost-hover data-[state=open]:bg-ghost-hover"
					>
						<ChevronDown size={14} />
					</button>
				</MenuTrigger>
				<MenuContent align="end" minWidth={0}>
					{targets === undefined ? (
						<div className="px-2 py-1.5 text-[13px] text-tertiary">Loading available apps…</div>
					) : (
						targets
							.filter((t) => t.kind !== "fileManager")
							.map((target) => (
								<MenuItem
									key={target.id}
									icon={<TargetIcon target={target} />}
									onSelect={() => {
										if (target.kind === "editor" || target.kind === "terminal") rememberTarget(project, target.id);
										openIn(target.id, path, line);
									}}
								>
									{target.name}
								</MenuItem>
							))
					)}
					{folder ? (
						<>
							<MenuSeparator />
							<MenuItem onSelect={() => openIn(folder.id, path)}>Open in folder</MenuItem>
						</>
					) : null}
					{github ? (
						<MenuItem onSelect={() => void client.host("host/shell/openExternal", { url: github })}>Open in GitHub</MenuItem>
					) : null}
					<MenuItem onSelect={() => saveCopy(path)}>Save as…</MenuItem>
				</MenuContent>
			</Menu>
		</div>
	);
}
