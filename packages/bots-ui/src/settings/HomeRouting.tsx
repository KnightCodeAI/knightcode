// Home connection routing (off by default): the computer's web traffic leaves through your own connection, through the
// desktop app or a Tailscale exit node. Private addresses stay refused unless you allow a specific host.
import type { HomeRouting as Routing } from "@knightcode/bots-protocol";
import { X } from "lucide-react";
import { useState } from "react";
import { Input } from "../primitives/Input.tsx";
import { Select } from "../primitives/Select.tsx";
import { Toggle } from "../primitives/Toggle.tsx";
import { useResource, useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

export function HomeRouting() {
	const store = useStore();
	const { data } = useResource("home-routing", (api) => api.getHomeRouting({}));
	const [host, setHost] = useState("");
	if (!data) return null;
	const save = (patch: Partial<Routing>) =>
		void store.api.updateHomeRouting(patch).then(() => store.reload("home-routing"));
	return (
		<SettingsSection
			title="Home connection"
			hint="Sites see your home address instead of the cloud's. Speed is limited by your upload."
		>
			<SettingsCard>
				<SettingsRow
					first
					title="Route through my connection"
					control={
						<Toggle
							label="Route through my connection"
							checked={data.enabled}
							onCheckedChange={(enabled) => save({ enabled })}
						/>
					}
				/>
				{data.enabled && (
					<>
						<SettingsRow
							title="Route"
							control={
								<Select
									label="Route"
									value={data.route}
									onValueChange={(route) => save({ route: route as Routing["route"] })}
									options={[
										{ value: "desktop", label: "The desktop app" },
										{ value: "tailscale", label: "Tailscale" },
									]}
								/>
							}
						/>
						<SettingsRow
							title="If the route drops"
							control={
								<Select
									label="If the route drops"
									value={data.failClosed ? "stop" : "cloud"}
									onValueChange={(v) => save({ failClosed: v === "stop" })}
									options={[
										{ value: "stop", label: "Stop traffic" },
										{ value: "cloud", label: "Use the cloud" },
									]}
								/>
							}
						/>
						<div className="kb-set-pad">
							<span className="kb-set-row__hint">Private hosts bots may reach (none by default)</span>
							{data.allowedPrivateHosts.map((h) => (
								<span key={h} className="kb-chip">
									<span className="kb-chip__label">{h}</span>
									<button
										type="button"
										className="kb-chip__remove"
										aria-label={`Remove ${h}`}
										onClick={() => save({ allowedPrivateHosts: data.allowedPrivateHosts.filter((x) => x !== h) })}
									>
										<X size={12} />
									</button>
								</span>
							))}
							<form
								onSubmit={(event) => {
									event.preventDefault();
									if (host.trim()) save({ allowedPrivateHosts: [...data.allowedPrivateHosts, host.trim()] });
									setHost("");
								}}
							>
								<Input
									aria-label="Allow a private host"
									placeholder="nas.local:8080"
									value={host}
									onChange={(e) => setHost(e.target.value)}
								/>
							</form>
						</div>
					</>
				)}
			</SettingsCard>
		</SettingsSection>
	);
}
