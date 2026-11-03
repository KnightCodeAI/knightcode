// The bots this bot manages (a Chief of Staff): it may edit their profiles, instructions and models, always through an
// approval card showing the full change. It manages only bots it created or that the user assigns here.
import type { Bot } from "@knightcode/bots-protocol";
import { BotAvatar } from "../avatar/BotAvatar.tsx";
import { useBots, useResource, useStore } from "../state/store.ts";

/** Checkboxes for the user's other bots. */
export function ManagedBots({ bot }: { bot: Bot }) {
	const store = useStore();
	const key = `managed:${bot.id}`;
	const { data } = useResource(key, (api) => api.listManagedBots({ botId: bot.id }));
	const { data: all } = useBots();
	const managed = new Set((data?.bots ?? []).map((b) => b.id));
	const others = (all?.bots ?? []).filter((b) => b.id !== bot.id && !b.archived);
	const set = (id: string, on: boolean) => {
		const next = on ? [...managed, id] : [...managed].filter((m) => m !== id);
		void store.api.setManagedBots({ botId: bot.id, botIds: next }).then(() => store.reload(key));
	};
	return (
		<div className="kb-settings__field" role="group" aria-label="Manages">
			<p className="kb-settings__hint">
				Changes it makes to these bots' instructions or models always wait for your approval, showing the full change.
			</p>
			{others.map((other) => (
				<label key={other.id} className="kb-recipe__check kb-member">
					<input type="checkbox" checked={managed.has(other.id)} onChange={(e) => set(other.id, e.target.checked)} />
					<span className="kb-member__avatar" data-avatar-box="">
						<BotAvatar bot={other} size={20} pointerArea=".kb-member" />
					</span>
					<span>{other.name}</span>
				</label>
			))}
		</div>
	);
}
