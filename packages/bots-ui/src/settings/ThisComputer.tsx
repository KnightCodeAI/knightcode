// "Let bots use this computer" (spec section 14), in the desktop app only: off by default, turned on after the app's
// native warning, off again at once. Bots ask on this computer before their first command in a session.
import { useEffect, useState } from "react";
import { useDesktopHost } from "../platform.ts";
import { Toggle } from "../primitives/Toggle.tsx";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

export function ThisComputer() {
	const desktop = useDesktopHost();
	const [enabled, setEnabled] = useState<boolean>();
	useEffect(() => {
		void desktop?.computerAccess.enabled().then(setEnabled);
	}, [desktop]);
	if (!desktop || enabled === undefined) return null;
	return (
		<SettingsSection title="This computer" hint="Bots ask here before their first command in a session.">
			<SettingsCard>
				<SettingsRow
					first
					title="Let bots use this computer"
					hint="Commands run with your full access. There is no sandbox."
					control={
						<Toggle
							label="Let bots use this computer"
							checked={enabled}
							onCheckedChange={(next) => void desktop.computerAccess.set(next).then(setEnabled)}
						/>
					}
				/>
			</SettingsCard>
		</SettingsSection>
	);
}
