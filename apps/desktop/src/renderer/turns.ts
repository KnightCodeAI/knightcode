/** Pure transcript reducers (desktop-shell.md section 7.1), kept apart from the store so tests need no DOM. */

import type { Item, Turn } from "@knightcode/app-server-protocol";

/** A rendered item: its protocol value plus its top-level position (absent for nested calls). */
export type ViewItem = Item & { index?: number };
export interface ViewTurn extends Omit<Turn, "items"> {
	items: ViewItem[];
}

/** Read-back items arrive in index order; nested calls carry no index (architecture.md section 4.2). */
export function toView(turn: Turn): ViewTurn {
	let index = 0;
	return {
		...turn,
		items: turn.items.map((item) =>
			item.type === "toolCall" && item.parentItemId ? item : { ...item, index: index++ },
		),
	};
}

/**
 * Insert or replace an item, then order top-level items by their latest index (the server's last word
 * on position; provisional indexes of streaming items are corrected at message end). Nested calls keep
 * arrival order after them; they render under their parent.
 */
export function placeItem(items: readonly ViewItem[], item: ViewItem): ViewItem[] {
	const next = items.some((i) => i.id === item.id) ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item];
	const top = next.filter((i) => i.index !== undefined).sort((a, b) => a.index! - b.index!);
	return [...top, ...next.filter((i) => i.index === undefined)];
}
