// Phones get one column: a menu button opens the sidebar as a drawer over the chat, and the details pane opens as a
// full-screen sheet. Picking anything in the drawer closes it.
import { Menu } from "lucide-react";
import { useSyncExternalStore } from "react";
import { IconButton } from "../primitives/IconButton.tsx";

/** The phone breakpoint, as measured. */
export const PHONE_QUERY = "(width <= 639px)";

const subscribe = (onChange: () => void) => {
	const query = matchMedia(PHONE_QUERY);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
};

/** True on a phone-width screen. */
export function useIsPhone(): boolean {
	return useSyncExternalStore(
		subscribe,
		() => matchMedia(PHONE_QUERY).matches,
		() => false,
	);
}

/** The menu button and, while the drawer is open, the scrim that closes it. */
export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	return (
		<>
			<IconButton
				className="kb-mobile-menu"
				label="Menu"
				icon={<Menu size={18} strokeWidth={1.75} />}
				aria-expanded={open}
				onClick={() => onOpenChange(!open)}
			/>
			{open && (
				<button type="button" className="kb-mobile-scrim" aria-label="Close menu" onClick={() => onOpenChange(false)} />
			)}
		</>
	);
}
