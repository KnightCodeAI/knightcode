// Billing, below usage: the plan and trial, credits and top-ups ($5 minimum, $5 / $15 / $25 or any amount), automatic
// top-up, and receipts showing the payment fee taken before credits are converted.
import { useState } from "react";
import { formatDay } from "../chat/layout.ts";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { Toggle } from "../primitives/Toggle.tsx";
import { useResource, useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

export const MIN_TOP_UP = 5;
const PRESETS = [5, 15, 25];

const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/** True when `amount` can be charged as a top-up. */
export const validTopUp = (amount: number) => Number.isFinite(amount) && amount >= MIN_TOP_UP;

/** The billing part of the Usage & billing page. */
export function Billing() {
	const store = useStore();
	const { data: billing } = useResource("billing", (api) => api.getBilling({}));
	const [amount, setAmount] = useState("15");
	const [threshold, setThreshold] = useState("5");
	const [refill, setRefill] = useState("15");
	const value = Number(amount);
	const pay = async (dollars: number) => {
		const { url } = await store.api.topUp({ amount: dollars });
		window.open(url, "_blank", "noopener");
	};
	const plan = billing?.plan ?? "none";
	return (
		<div className="kb-billing" id="kb-billing">
			<SettingsSection title="Plan">
				<SettingsCard>
					<SettingsRow
						title={
							plan === "active"
								? "KnightCode Bots · $10 a month"
								: plan === "trial"
									? "Free trial"
									: plan === "lapsed"
										? "Plan lapsed"
										: "No plan"
						}
						hint={
							plan === "trial" && billing?.trialEndsAt
								? `Your 3-day trial ends on ${formatDay(billing.trialEndsAt)} and then becomes the paid plan unless you cancel.`
								: plan === "active" && billing?.renewsAt
									? `Renews on ${formatDay(billing.renewsAt)}. Includes ${billing.computerHours.included} computer hours a month and 10 GB of storage.`
									: plan === "lapsed"
										? "Routines and the computer are paused. Your bots' history is still here."
										: "Subscribe for the computer, storage and every connector."
						}
						control={
							plan === "active" || plan === "trial" ? (
								<Button
									variant="subtle"
									size="sm"
									onClick={() => void store.api.cancelSubscription({}).then(() => store.reload("billing"))}
								>
									Cancel plan
								</Button>
							) : (
								<Button
									variant="primary"
									size="sm"
									onClick={() => void store.api.subscribe({}).then((r) => window.open(r.url, "_blank", "noopener"))}
								>
									Subscribe
								</Button>
							)
						}
					/>
				</SettingsCard>
			</SettingsSection>
			<SettingsSection
				title="Credits"
				hint={`Balance ${money(billing?.credits ?? 0)}. Credits pay for computer time past your plan and pass-through services.`}
			>
				<SettingsCard>
					<div className="kb-topup">
						<div className="kb-topup__presets" role="group" aria-label="Top-up amounts">
							{PRESETS.map((preset) => (
								<Button key={preset} variant="secondary" size="sm" onClick={() => void pay(preset)}>
									{money(preset).replace(".00", "")}
								</Button>
							))}
						</div>
						<form
							className="kb-topup__custom"
							onSubmit={(event) => {
								event.preventDefault();
								if (validTopUp(value)) void pay(value);
							}}
						>
							<label className="kb-topup__field">
								<span>$</span>
								<Input
									type="number"
									inputMode="decimal"
									min={MIN_TOP_UP}
									step="1"
									aria-label="Amount"
									value={amount}
									onChange={(e) => setAmount(e.target.value)}
									aria-invalid={!validTopUp(value) || undefined}
								/>
							</label>
							<Button variant="primary" size="sm" type="submit" disabled={!validTopUp(value)}>
								Add credits
							</Button>
						</form>
						{!validTopUp(value) && <p className="kb-set-row__hint">The smallest top-up is {money(MIN_TOP_UP)}.</p>}
						<p className="kb-set-row__hint">
							The payment fee comes off before credits are added; each receipt shows it.
						</p>
					</div>
					<SettingsRow
						title="Automatic top-up"
						hint={
							billing?.autoTopUp.enabled
								? `Adds ${money(billing.autoTopUp.amount ?? 0)} when the balance falls below ${money(billing.autoTopUp.threshold ?? 0)}.`
								: "Off."
						}
						control={
							<Toggle
								label="Automatic top-up"
								checked={billing?.autoTopUp.enabled ?? false}
								onCheckedChange={(enabled) =>
									void store.api
										.setAutoTopUp({
											enabled,
											threshold: enabled ? Math.max(1, Number(threshold)) : undefined,
											amount: enabled ? Math.max(MIN_TOP_UP, Number(refill)) : undefined,
										})
										.then(() => store.reload("billing"))
								}
							/>
						}
					/>
					{!billing?.autoTopUp.enabled && (
						<div className="kb-topup__auto">
							<Input
								aria-label="Top up when below"
								inputMode="decimal"
								value={threshold}
								onChange={(e) => setThreshold(e.target.value)}
							/>
							<Input
								aria-label="Top up by"
								inputMode="decimal"
								value={refill}
								onChange={(e) => setRefill(e.target.value)}
							/>
						</div>
					)}
				</SettingsCard>
			</SettingsSection>
			<SettingsSection title="Receipts">
				{(billing?.receipts ?? []).length === 0 ? (
					<p className="kb-set-section__hint">No payments yet.</p>
				) : (
					<table className="kb-usage-table">
						<thead>
							<tr>
								<th scope="col">Date</th>
								<th scope="col">Paid</th>
								<th scope="col">Payment fee</th>
								<th scope="col">Credited</th>
							</tr>
						</thead>
						<tbody>
							{billing!.receipts.map((receipt) => (
								<tr key={receipt.id}>
									<td>{formatDay(receipt.at)}</td>
									<td>{money(receipt.amount)}</td>
									<td>{money(receipt.fee)}</td>
									<td>{money(receipt.credited)}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</SettingsSection>
		</div>
	);
}
