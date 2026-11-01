// "While you were away": after four hours or more with no activity, the first screen says what finished, what is
// waiting and what failed across bots, each linking to its place. Shown only when something happened.
import type { CatchUp as CatchUpData, InboxItem } from "@knightcode/bots-protocol";
import { Button } from "../primitives/Button.tsx";
import { navigate } from "../shell/routes.ts";
import { useBots } from "../state/store.ts";
import { KIND_LABELS } from "./Inbox.tsx";

const AWAY_MS = 4 * 3_600_000;
const LAST_ACTIVE = "kb.lastActive";

/** How long the user was away: `?away=5h` (for previews), else since the last activity this browser saw. */
export function awayFor(param: string | null, now = Date.now(), last = readLastActive()): number {
	const match = param ? /^(\d+(?:\.\d+)?)(m|h|d)$/.exec(param) : null;
	if (match) return Number(match[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "m" | "h" | "d"];
	return last === undefined ? 0 : now - last;
}

/** True when the gap is long enough for a catch-up. */
export const isAway = (ms: number) => ms >= AWAY_MS;

function readLastActive(): number | undefined {
	try {
		const value = Number(localStorage.getItem(LAST_ACTIVE));
		return Number.isFinite(value) && value > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

/** Records activity; called on interaction, at most once a minute. */
export function markActive(now = Date.now()): void {
	try {
		const last = readLastActive();
		if (!last || now - last > 60_000) localStorage.setItem(LAST_ACTIVE, String(now));
	} catch {
		// Storage may be unavailable (private windows); the catch-up then waits for ?away.
	}
}

/** The catch-up screen. */
export function CatchUp({ catchUp, onDone }: { catchUp: CatchUpData; onDone: () => void }) {
	const { data } = useBots();
	const name = (item: InboxItem) => data?.bots.find((b) => b.id === item.botId)?.name ?? "A bot";
	const go = (item: InboxItem) => {
		onDone();
		navigate(
			item.entryId
				? `/bots/${encodeURIComponent(item.botId)}?entry=${encodeURIComponent(item.entryId)}`
				: { name: "bot", botId: item.botId, pane: "details" },
		);
	};
	const group = (title: string, items: InboxItem[]) =>
		items.length > 0 && (
			<section className="kb-inbox__group" aria-label={title}>
				<h2 className="kb-inbox__group-title">{title}</h2>
				<ul className="kb-list">
					{items.map((item) => (
						<li key={item.id}>
							<button type="button" className="kb-list__row" onClick={() => go(item)}>
								<span className="kb-list__main">
									<span className="kb-list__title">{item.title}</span>
									<span className="kb-list__meta">
										{name(item)} · {KIND_LABELS[item.kind]}
										{item.detail ? ` · ${item.detail}` : ""}
									</span>
								</span>
							</button>
						</li>
					))}
				</ul>
			</section>
		);
	return (
		<div className="kb-view">
			<div className="kb-view__inner">
				<h1 className="kb-view__title">While you were away</h1>
				<p className="kb-catchup__summary">{catchUp.summary}</p>
				{group("Waiting on you", catchUp.waiting)}
				{group("Finished", catchUp.finished)}
				{group("Failed", catchUp.failed)}
				<div>
					<Button variant="primary" onClick={onDone}>
						Continue
					</Button>
				</div>
			</div>
		</div>
	);
}
