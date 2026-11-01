// Payments: link a Link wallet once; each purchase then needs a spending approval confirmed with your passkey, and
// per-bot limits (per purchase, per month) refuse anything above them. Available where Stripe offers it.
import type { SpendLimit } from "@knightcode/bots-protocol";
import { useEffect, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { useBots, useResource, useStore } from "../state/store.ts";
import { Finance } from "./Finance.tsx";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

export function Payments() {
	const store = useStore();
	const { data } = useResource("payments", (api) => api.getPayments({}));
	const { data: bots } = useBots();
	const [limits, setLimits] = useState<SpendLimit[]>([]);
	useEffect(() => setLimits(data?.limits ?? []), [data]);
	if (!data) return null;
	const limitFor = (botId: string) => limits.find((l) => l.botId === botId) ?? { botId, perPurchase: 0, perMonth: 0 };
	const set = (botId: string, patch: Partial<SpendLimit>) =>
		setLimits((list) => [...list.filter((l) => l.botId !== botId), { ...limitFor(botId), ...patch }]);
	return (
		<>
			{!data.available ? (
				<SettingsSection>
					<p className="kb-set-section__hint">Bot payments are not available in your country yet.</p>
				</SettingsSection>
			) : (
				<>
					<SettingsSection title="Link wallet">
						<SettingsCard>
							<SettingsRow
								title={data.linked ? "Linked" : "Not linked"}
								hint="Bots get a single-use card for one approved merchant and amount. KnightCode never stores card numbers."
								control={
									<Button
										variant="subtle"
										size="sm"
										onClick={() => void store.api.linkWallet({}).then((r) => window.open(r.url, "_blank", "noopener"))}
									>
										{data.linked ? "Relink" : "Link wallet"}
									</Button>
								}
							/>
						</SettingsCard>
					</SettingsSection>
					<SettingsSection
						title="Limits per bot"
						hint="Purchases above a limit are refused without asking. Every purchase still needs your passkey."
					>
						<SettingsCard>
							{(bots?.bots ?? [])
								.filter((b) => !b.archived)
								.map((bot) => (
									<SettingsRow
										key={bot.id}
										title={bot.name}
										control={
											<div className="kb-set-inline">
												<Input
													aria-label={`${bot.name} per purchase`}
													placeholder="Per purchase"
													inputMode="decimal"
													value={limitFor(bot.id).perPurchase || ""}
													onChange={(e) => set(bot.id, { perPurchase: Number(e.target.value) || 0 })}
												/>
												<Input
													aria-label={`${bot.name} per month`}
													placeholder="Per month"
													inputMode="decimal"
													value={limitFor(bot.id).perMonth || ""}
													onChange={(e) => set(bot.id, { perMonth: Number(e.target.value) || 0 })}
												/>
											</div>
										}
									/>
								))}
							<div className="kb-set-pad kb-set-end">
								<Button
									variant="primary"
									size="sm"
									onClick={() => void store.api.setSpendLimits({ limits }).then(() => store.reload("payments"))}
								>
									Save limits
								</Button>
							</div>
						</SettingsCard>
					</SettingsSection>
				</>
			)}
			<Finance />
		</>
	);
}
