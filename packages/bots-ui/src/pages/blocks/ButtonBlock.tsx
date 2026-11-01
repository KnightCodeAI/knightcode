// A button that runs a routine or a connector action. A press is a user-started run and follows the approval rules.
import type { PageBlock } from "@knightcode/bots-protocol";
import { Play } from "lucide-react";
import { useState } from "react";
import { Button } from "../../primitives/Button.tsx";
import { useToast } from "../../primitives/Toast.tsx";
import { useStore } from "../../state/store.ts";

export function ButtonBlock({ block, pageId }: { block: Extract<PageBlock, { type: "button" }>; pageId: string }) {
	const store = useStore();
	const toast = useToast();
	const [busy, setBusy] = useState(false);
	const press = async () => {
		setBusy(true);
		try {
			const result = await store.api.pressPageButton({ id: pageId, blockId: block.id });
			toast({ text: result.approval ? "That needs your approval first. It is in the bot's chat." : "Started." });
		} finally {
			setBusy(false);
		}
	};
	return (
		<Button variant="secondary" disabled={busy} onClick={() => void press()}>
			<Play size={12} fill="currentColor" /> {block.label}
		</Button>
	);
}
