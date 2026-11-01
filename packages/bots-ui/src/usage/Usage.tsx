// Usage: the plan, this week's computer hours against what the plan includes, the spending limit for credits, and what
// each bot used. Model costs are the providers' own; the user pays them directly.
import type { Bot, UsageRow } from "@knightcode/bots-protocol";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { Button } from "../primitives/Button.tsx";
import { Select } from "../primitives/Select.tsx";
import { navigate } from "../shell/routes.ts";
import { useBots, useResource, useStore } from "../state/store.ts";
import { formatDay } from "../chat/layout.ts";

const LIMITS = [
	{ value: "none", label: "None" },
	{ value: "10", label: "$10" },
	{ value: "25", label: "$25" },
	{ value: "50", label: "$50" },
	{ value: "100", label: "$100" },
];

const DAY = 86_400_000;

/** The usage page. */
export function Usage() {
	const store = useStore();
	const { data: billing } = useResource("billing", (api) => api.getBilling({}));
	const { data: usage } = useResource("usage", (api) => api.listUsage({ from: Date.now() - 30 * DAY }));
	const { data: bots } = useBots();
	const used = billing?.computerHours.used ?? 0;
	const included = billing?.computerHours.included ?? 0;
	const percent = included ? Math.min(100, Math.round((used / included) * 100)) : 0;
	const resets = billing?.renewsAt ? Math.max(0, Math.ceil((billing.renewsAt - Date.now()) / DAY) % 7 || 7) : 7;
	const plan = billing?.plan ?? "none";
	const subscribed = plan === "active" || plan === "trial";
	const limit = billing?.spendingLimit == null ? "none" : String(billing.spendingLimit);
	const limits = LIMITS.some((l) => l.value === limit) ? LIMITS : [...LIMITS, { value: limit, label: `$${limit}` }];
	const planHint =
		plan === "trial" && billing?.trialEndsAt
			? `Trial ends on ${formatDay(billing.trialEndsAt)}.`
			: billing?.renewsAt
				? `Renews on ${formatDay(billing.renewsAt)}.`
				: plan === "lapsed"
					? "Your plan has lapsed."
					: "No plan yet.";
	return (
		<>
			<section className="kb-plan-card">
				<div className="kb-plan-card__copy">
					<div className="kb-plan-card__text">
						<p className="kb-plan-card__title">
							{subscribed ? "Your bots have their own computer" : "Give your bots their own computer"}
						</p>
						<p className="kb-plan-card__description">
							{subscribed
								? "Your plan includes the computer, storage and every connector. Model costs stay with your own providers."
								: "One plan covers the computer your bots share, storage and every connector. Model costs stay with your own providers."}
						</p>
					</div>
					<Button
						variant="primary"
						size="sm"
						className="kb-plan-card__button"
						onClick={() => navigate({ name: "settings", section: "billing" })}
					>
						{subscribed ? "Manage plan" : "Get started"}
					</Button>
				</div>
				<div className="kb-plan-card__art" aria-hidden>
					{(bots?.bots ?? []).slice(0, 4).map((bot) => (
						<span key={bot.id} className="kb-plan-card__avatar" data-avatar-box="">
							<BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={32} />
						</span>
					))}
				</div>
			</section>
			<div className="kb-usage-section" data-ref="usage-section">
				<section className="kb-usage-block">
					<div className="kb-usage-meter-card">
						<div className="kb-usage-meter" data-ref="usage-meter">
							<div className="kb-usage-meter__top">
								<div className="kb-usage-meter__header" data-ref="usage-meter-header">
									<span>Computer hours this week</span>
								</div>
								<div className="kb-usage-meter__value">
									<span className="kb-usage-meter__number">{percent}%</span>
									<span className="kb-usage-meter__unit">
										used · {formatHours(used)} of {formatHours(included)}
									</span>
								</div>
							</div>
							<div className="kb-usage-meter__bottom">
								<div
									className="kb-usage-meter__track"
									role="meter"
									aria-label={`Computer hours this week: ${percent}% used`}
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={percent}
									data-ref="usage-meter-track"
								>
									<span className="kb-usage-meter__fill" style={{ width: `${percent}%` }} />
								</div>
								<span className="kb-usage-meter__caption">Resets in {resets === 1 ? "1 day" : `${resets} days`}</span>
							</div>
						</div>
					</div>
					<p className="kb-usage-note">Included with your plan. Past it, the computer runs on credits.</p>
				</section>
				<section className="kb-usage-block">
					<div className="kb-usage-card kb-usage-card--rows">
						<div className="kb-usage-row">
							<div className="kb-usage-row__copy">
								<span>Spending limit</span>
								<span className="kb-usage-row__hint">Most credits can spend in a month</span>
							</div>
							<Select
								label="Spending limit"
								value={limit}
								options={limits}
								onValueChange={(value) =>
									void store.api
										.setSpendingLimit({ limit: value === "none" ? null : Number(value) })
										.then(() => store.reload("billing"))
								}
							/>
						</div>
					</div>
				</section>
				<section className="kb-usage-block">
					<h3 className="kb-usage-block__title">Manage plan</h3>
					<div className="kb-usage-card kb-usage-card--plan">
						<div className="kb-usage-row kb-usage-row--plain">
							<div className="kb-usage-row__copy">
								<span>Current plan: {PLAN_LABELS[plan]}</span>
								<span className="kb-usage-row__hint">
									{planHint} {formatCredits(billing?.credits ?? 0)} in credits.
								</span>
							</div>
						</div>
						<div className="kb-usage-row kb-usage-row--plain">
							<span>Billing, credits and receipts</span>
							<Button variant="subtle" size="sm" onClick={() => navigate({ name: "settings", section: "billing" })}>
								Open billing
							</Button>
						</div>
					</div>
				</section>
			</div>
			<UsageByBot rows={usage?.rows ?? []} bots={bots?.bots ?? []} />
		</>
	);
}

const PLAN_LABELS = { none: "None", trial: "Trial", active: "KnightCode Bots", lapsed: "Lapsed" } as const;

/** Runs, tokens and the providers' reported cost per bot over the last 30 days. */
function UsageByBot({ rows, bots }: { rows: UsageRow[]; bots: Bot[] }) {
	const byBot = new Map<string, { runs: number; tokens: number; cost: number }>();
	for (const row of rows) {
		const total = byBot.get(row.botId) ?? { runs: 0, tokens: 0, cost: 0 };
		total.runs += row.runs;
		total.tokens += row.inputTokens + row.outputTokens;
		total.cost += row.costUsd;
		byBot.set(row.botId, total);
	}
	if (byBot.size === 0) return null;
	return (
		<section className="kb-usage-block">
			<h3 className="kb-usage-block__title">Last 30 days, by bot</h3>
			<table className="kb-usage-table">
				<thead>
					<tr>
						<th scope="col">Bot</th>
						<th scope="col">Runs</th>
						<th scope="col">Tokens</th>
						<th scope="col">Provider cost</th>
					</tr>
				</thead>
				<tbody>
					{[...byBot].map(([botId, total]) => (
						<tr key={botId}>
							<td>{bots.find((b) => b.id === botId)?.name ?? botId}</td>
							<td>{total.runs}</td>
							<td>{total.tokens.toLocaleString()}</td>
							<td>{formatCredits(total.cost)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}

function formatHours(hours: number): string {
	return `${Math.round(hours * 10) / 10} h`;
}

function formatCredits(dollars: number): string {
	return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
}
