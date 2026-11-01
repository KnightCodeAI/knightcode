// Every saved version of a bot's instructions, newest first, with who changed it; any version can be restored.
import type { Bot } from "@knightcode/bots-protocol";
import { Button } from "../primitives/Button.tsx";
import { BOTS, type BotList, useBots, useResource, useStore } from "../state/store.ts";
import { formatDay, formatTime } from "../chat/layout.ts";

/** The version list. Restoring saves a new version with the old text. */
export function InstructionsHistory({ bot }: { bot: Bot }) {
	const store = useStore();
	const { data: bots } = useBots();
	const key = `instructions:${bot.id}:${bot.instructionsVersion}`;
	const { data } = useResource(key, (api) => api.listInstructionVersions({ botId: bot.id }));
	const versions = [...(data?.versions ?? [])].sort((a, b) => b.version - a.version);
	if (versions.length === 0) return <p className="kb-settings__hint">No earlier versions yet.</p>;
	const restore = async (version: number) => {
		const next = await store.api.restoreInstructions({ botId: bot.id, version });
		store.set<BotList>(BOTS, (list) => list && { ...list, bots: list.bots.map((b) => (b.id === next.id ? next : b)) });
	};
	return (
		<ol className="kb-history" aria-label="Instruction versions">
			{versions.map((v) => {
				const by = v.author;
				const author =
					by.kind === "user" ? "You" : `Updated by ${bots?.bots.find((b) => b.id === by.botId)?.name ?? "a bot"}`;
				const current = v.version === bot.instructionsVersion;
				return (
					<li key={v.version} className="kb-history__item">
						<div className="kb-history__meta">
							<span>Version {v.version}</span>
							<span>
								{author} · {formatDay(v.createdAt)} {formatTime(v.createdAt)}
							</span>
						</div>
						<p className="kb-history__text">{v.text || "(empty)"}</p>
						{!current && (
							<Button variant="subtle" size="sm" onClick={() => void restore(v.version)}>
								Restore
							</Button>
						)}
					</li>
				);
			})}
		</ol>
	);
}
