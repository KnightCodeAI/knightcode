/**
 * Native context menus (host/menu/popup), as Codex shows for its sidebar rows: the renderer lists the items with their
 * actions, main pops up the system menu at the pointer, and the chosen item's action runs here.
 */

import type React from "react";
import type { NativeMenuItem } from "../../shared/host-protocol.ts";
import type { KeybindingId } from "../../shared/keybindings.ts";
import { client } from "../client.ts";
import { bindingAccelerator } from "../keys.ts";

type Action = { label: string; run: () => void; binding?: KeybindingId; disabled?: boolean };
type Leaf = Action | "-";
export type ContextMenuItem = Leaf | { label: string; items: Leaf[] };

export async function showContextMenu(items: ContextMenuItem[]): Promise<void> {
	const actions = new Map<string, () => void>();
	const leaf = (item: Leaf): Exclude<NativeMenuItem, { submenu: unknown }> => {
		if (item === "-") return { separator: true };
		const id = String(actions.size);
		actions.set(id, item.run);
		const accelerator = item.binding && bindingAccelerator(item.binding);
		return {
			id,
			label: item.label,
			...(accelerator ? { accelerator } : {}),
			...(item.disabled ? { enabled: false } : {}),
		};
	};
	const native = items.map((item) =>
		item !== "-" && "items" in item ? { label: item.label, submenu: item.items.map(leaf) } : leaf(item),
	);
	const { id } = await client.host("host/menu/popup", { items: native });
	if (id) actions.get(id)?.();
}

/** An `onContextMenu` handler that shows the menu `items` builds when it fires. */
export const contextMenu = (items: () => ContextMenuItem[]) => (event: React.MouseEvent) => {
	event.preventDefault();
	event.stopPropagation();
	void showContextMenu(items());
};
