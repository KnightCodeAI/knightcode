// Boots the web app: the primitives gallery at /__gallery in development, otherwise KnightCode Bots.
import "@knightcode/bots-ui/styles.css";
import { BotsApp } from "@knightcode/bots-ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "./client.ts";
import { Gallery } from "./gallery.tsx";

const root = createRoot(document.getElementById("root") as HTMLElement);

if (import.meta.env.DEV && location.pathname === "/__gallery") {
	root.render(
		<StrictMode>
			<Gallery />
		</StrictMode>,
	);
} else {
	const client = await createClient();
	root.render(
		<StrictMode>
			<BotsApp api={client.api} connect={client.connect} platform="web" />
		</StrictMode>,
	);
}
