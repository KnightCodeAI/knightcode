// Export a bot as a recipe file: the shareable form of a bot, readable here or in any app that reads the format.
import type { Bot } from "@knightcode/bots-protocol";
import { Download } from "lucide-react";
import { Button } from "../primitives/Button.tsx";
import { type BotsStore, useStore } from "../state/store.ts";

/** Downloads `<name>.json`. */
export async function exportRecipe(store: BotsStore, bot: Bot): Promise<void> {
	const recipe = await store.api.exportBot({ botId: bot.id });
	const url = URL.createObjectURL(new Blob([JSON.stringify(recipe, null, 2)], { type: "application/json" }));
	const link = document.createElement("a");
	link.download = `${bot.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "bot"}.json`;
	link.href = url;
	link.click();
	URL.revokeObjectURL(url);
}

/** The button in a bot's settings. */
export function ExportBot({ bot }: { bot: Bot }) {
	const store = useStore();
	return (
		<Button variant="subtle" size="sm" onClick={() => void exportRecipe(store, bot)}>
			<Download size={14} /> Export recipe
		</Button>
	);
}
