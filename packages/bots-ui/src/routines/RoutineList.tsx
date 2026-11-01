// A bot's routines at the top of its details: each opens its editor; New routine adds one. Empty, it says to ask in
// chat (the search palette's New routine also opens the editor).
import type { Bot } from "@knightcode/bots-protocol";
import { Plus } from "lucide-react";
import { navigate } from "../shell/routes.ts";
import { useResource } from "../state/store.ts";

const routinePath = (botId: string, id = "new") =>
	`/bots/${encodeURIComponent(botId)}/routines/${encodeURIComponent(id)}`;

/** The list, or the empty note. */
export function RoutineList({ bot }: { bot: Bot }) {
	const { data } = useResource(`routines:${bot.id}`, (api) => api.listRoutines({ botId: bot.id }));
	const routines = data?.routines ?? [];
	if (routines.length === 0)
		return (
			<p className="kb-pane__empty">
				Routines are recurring tasks this Bot runs on a schedule. Ask it in chat to set one up.
			</p>
		);
	return (
		<section className="kb-group">
			<div className="kb-group__title kb-group__title--action">
				<span>Routines</span>
				<button type="button" className="kb-browser__more" onClick={() => navigate(routinePath(bot.id))}>
					<Plus size={12} /> New routine
				</button>
			</div>
			<ul className="kb-group__list">
				{routines.map((routine) => (
					<li key={routine.id}>
						<button
							type="button"
							className="kb-group__row kb-group__row--button"
							onClick={() => navigate(routinePath(bot.id, routine.id))}
						>
							<span>{routine.name}</span>
							<span className="kb-group__value">{routine.active ? "On" : "Paused"}</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}
