// AI providers: the models your bots use come from your own accounts. OAuth providers connect through the desktop app
// (it signs in again for the cloud, never copying local tokens); API keys are entered here and stored in the vault.
import type { ProviderConnection } from "@knightcode/bots-protocol";
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { useResource, useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

const STATUS: Record<ProviderConnection["status"], string> = {
	connected: "Connected",
	reconnect: "Reconnect needed",
	available: "Not connected",
	unavailable: "Not available yet",
};

/** The provider list. */
export function ConnectProviders() {
	const store = useStore();
	const { data } = useResource("providers", (api) => api.listProviders({}));
	const refresh = () => {
		store.reload("providers");
		store.reload("models");
	};
	return (
		<SettingsSection
			title="AI providers"
			hint="Your bots run on your own provider accounts. You pay the provider directly."
		>
			<SettingsCard>
				{(data?.providers ?? []).map((provider) => (
					<ProviderRow key={provider.provider} provider={provider} onChange={refresh} />
				))}
			</SettingsCard>
		</SettingsSection>
	);
}

function ProviderRow({ provider, onChange }: { provider: ProviderConnection; onChange: () => void }) {
	const store = useStore();
	const [key, setKey] = useState("");
	const connected = provider.status === "connected";
	const hint = [STATUS[provider.status], provider.note].filter(Boolean).join(" · ");
	let control;
	if (connected)
		control = (
			<Button
				variant="subtle"
				size="sm"
				onClick={() => void store.api.disconnectProvider({ provider: provider.provider }).then(onChange)}
			>
				Disconnect
			</Button>
		);
	else if (provider.status === "unavailable") control = undefined;
	else if (provider.kind === "api_key")
		control = (
			<form
				className="kb-set-inline"
				onSubmit={(event) => {
					event.preventDefault();
					if (!key) return;
					void store.api.connectProvider({ provider: provider.provider, apiKey: key }).then(() => {
						setKey("");
						onChange();
					});
				}}
			>
				<Input
					type="password"
					autoComplete="off"
					aria-label={`${provider.name} API key`}
					placeholder="API key"
					value={key}
					onChange={(e) => setKey(e.target.value)}
				/>
				<Button variant="subtle" size="sm" type="submit" disabled={!key}>
					Save
				</Button>
			</form>
		);
	else
		control = (
			<Button
				variant="subtle"
				size="sm"
				onClick={() => void store.api.connectProvider({ provider: provider.provider }).then(onChange)}
			>
				{provider.status === "reconnect" ? "Reconnect" : "Connect"}
			</Button>
		);
	return <SettingsRow title={provider.name} hint={hint} control={control} />;
}
