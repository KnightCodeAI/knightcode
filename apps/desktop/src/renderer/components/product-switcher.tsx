// The sidebar's product name, "KnightCode ▾": it switches the window between the coding app and KnightCode Bots. In
// the coding app it carries a badge while a bot needs the user; in Bots the sidebar's rows show that themselves.
import type { Product } from "../../shared/host-protocol.ts";
import { ChevronDown } from "./icons.tsx";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./menu.tsx";

const NAMES: Record<Product, string> = { coding: "KnightCode", bots: "KnightCode Bots" };

export function ProductSwitcher({
	product,
	onChange,
	needsYou,
	compact,
}: {
	product: Product;
	onChange: (product: Product) => void;
	/** Bots and groups that need the user, badged when not 0. */
	needsYou?: number;
	/** 16px rather than 18px: the bots sidebar's header also holds its Search and New Bot buttons. */
	compact?: boolean;
}) {
	return (
		<Menu>
			<MenuTrigger>
				<button
					type="button"
					className="no-drag -ms-1.5 flex h-8 min-w-0 items-center gap-1 rounded-lg px-1.5 text-nav outline-none hover:bg-ghost-hover focus-visible:bg-ghost-hover data-[state=open]:bg-ghost-hover"
				>
					<span className={`truncate leading-6 font-semibold ${compact ? "text-[16px]" : "text-[18px]"}`}>
						{NAMES[product]}
					</span>
					<ChevronDown size={14} className="shrink-0 text-tertiary" aria-hidden />
					{needsYou ? (
						<span
							role="img"
							aria-label={`${needsYou} ${needsYou === 1 ? "needs" : "need"} you`}
							className="ms-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[11px] leading-4 font-semibold text-on-accent"
						>
							{needsYou}
						</span>
					) : null}
				</button>
			</MenuTrigger>
			<MenuContent minWidth={200}>
				<MenuRadioGroup value={product} onValueChange={(value) => onChange(value as Product)}>
					{(Object.keys(NAMES) as Product[]).map((id) => (
						<MenuRadioItem key={id} value={id}>
							{NAMES[id]}
						</MenuRadioItem>
					))}
				</MenuRadioGroup>
			</MenuContent>
		</Menu>
	);
}
