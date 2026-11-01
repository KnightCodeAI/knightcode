// KnightCode Bots in the desktop window: the shared UI (packages/bots-ui) on the bots backend, with the product
// switcher at the start of its sidebar. Loaded the first time the user switches, so the coding app starts as before.
import "@knightcode/bots-ui/components.css";
import { BotsApp } from "@knightcode/bots-ui";
import type { ReactNode } from "react";
import { botsBackend } from "./backend.ts";

export default function BotsMount({ switcher }: { switcher: ReactNode }) {
	// Fills the card beside the rail, as the coding app's sidebar and content do.
	return (
		<div className="min-w-0 flex-1">
			<BotsApp api={botsBackend.api} connect={botsBackend.connect} platform="desktop" sidebarHeader={switcher} />
		</div>
	);
}
