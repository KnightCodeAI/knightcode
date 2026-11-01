// 1Password: when a bot needs a login, you approve on your own device and 1Password fills it; neither the bot nor
// KnightCode stores the password.
import { Button } from "../primitives/Button.tsx";
import { useResource, useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

export function OnePassword() {
	const store = useStore();
	const { data } = useResource("1password", (api) => api.getOnePassword({}));
	const refresh = () => store.reload("1password");
	return (
		<SettingsSection title="1Password">
			<SettingsCard>
				<SettingsRow
					title={data?.connected ? `Connected${data.account ? ` · ${data.account}` : ""}` : "Not connected"}
					hint="You approve each login on your own device; nothing is stored here."
					control={
						data?.connected ? (
							<Button variant="subtle" size="sm" onClick={() => void store.api.disconnectOnePassword({}).then(refresh)}>
								Disconnect
							</Button>
						) : (
							<Button variant="subtle" size="sm" onClick={() => void store.api.connectOnePassword({}).then(refresh)}>
								Connect
							</Button>
						)
					}
				/>
			</SettingsCard>
		</SettingsSection>
	);
}
