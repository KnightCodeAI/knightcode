// Tailscale: the computer joins your tailnet with an ephemeral, tagged auth key you create, so bots reach private
// services. The key lives in the vault; the node leaves when the computer stops.
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { useResource, useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

export function Tailscale() {
	const store = useStore();
	const { data } = useResource("tailscale", (api) => api.getTailscale({}));
	const [key, setKey] = useState("");
	const [exitNode, setExitNode] = useState("");
	const refresh = () => store.reload("tailscale");
	if (!data) return null;
	return (
		<SettingsSection title="Tailscale" hint="Use an ephemeral, tagged auth key.">
			<SettingsCard>
				{data.joined ? (
					<SettingsRow
						title="Joined your tailnet"
						hint={data.exitNode ? `Exit node: ${data.exitNode}` : undefined}
						control={
							<Button variant="subtle" size="sm" onClick={() => void store.api.leaveTailscale({}).then(refresh)}>
								Leave
							</Button>
						}
					/>
				) : (
					<form
						className="kb-set-pad"
						onSubmit={(event) => {
							event.preventDefault();
							if (!key) return;
							void store.api.joinTailscale({ authKey: key, exitNode: exitNode.trim() || undefined }).then(() => {
								setKey("");
								refresh();
							});
						}}
					>
						<Input
							type="password"
							autoComplete="off"
							aria-label="Tailscale auth key"
							placeholder="tskey-auth-…"
							value={key}
							onChange={(e) => setKey(e.target.value)}
						/>
						<Input
							aria-label="Exit node"
							placeholder="Exit node (optional)"
							value={exitNode}
							onChange={(e) => setExitNode(e.target.value)}
						/>
						<Button variant="primary" size="sm" type="submit" disabled={!key}>
							Join
						</Button>
					</form>
				)}
			</SettingsCard>
		</SettingsSection>
	);
}
