// Bank data: a read-only Finance connector through Plaid lists linked bank, card, loan and brokerage accounts. Linking
// opens Plaid's own window; each linked account costs a monthly fee from credits.
import { Trash2 } from "lucide-react";
import { Button } from "../primitives/Button.tsx";
import { useResource, useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

type PlaidHandler = { open: () => void };
type PlaidLink = { create: (config: { token: string; onSuccess: (publicToken: string) => void }) => PlaidHandler };

const PLAID_SCRIPT = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

/** Plaid's Link window, loaded from Plaid on first use. */
async function plaid(): Promise<PlaidLink> {
	const existing = (window as unknown as { Plaid?: PlaidLink }).Plaid;
	if (existing) return existing;
	await new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = PLAID_SCRIPT;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("Plaid could not load"));
		document.head.append(script);
	});
	return (window as unknown as { Plaid: PlaidLink }).Plaid;
}

export function Finance() {
	const store = useStore();
	const { data } = useResource("finance", (api) => api.getFinance({}));
	if (!data?.available) return null;
	const refresh = () => store.reload("finance");
	const link = async () => {
		const { linkToken } = await store.api.linkBank({});
		const Plaid = await plaid();
		Plaid.create({
			token: linkToken,
			onSuccess: (publicToken) => void store.api.completeBankLink({ publicToken }).then(refresh),
		}).open();
	};
	const money = (n: number, currency: string) =>
		new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
	return (
		<SettingsSection
			title="Bank accounts"
			hint="Read-only. Bots check balances and transactions here before opening a bank's website."
			action={
				<Button variant="secondary" size="sm" onClick={() => void link()}>
					Link an account
				</Button>
			}
		>
			{data.accounts.length > 0 && (
				<SettingsCard>
					{data.accounts.map((account) => (
						<SettingsRow
							key={account.id}
							title={`${account.name} ····${account.mask}`}
							hint={`${account.type} · ${money(account.balance, account.currency)}`}
							control={
								<button
									type="button"
									className="kb-hover-actions__button"
									aria-label={`Unlink ${account.name}`}
									onClick={() => void store.api.unlinkBank({ id: account.id }).then(refresh)}
								>
									<Trash2 size={14} />
								</button>
							}
						/>
					))}
				</SettingsCard>
			)}
		</SettingsSection>
	);
}
