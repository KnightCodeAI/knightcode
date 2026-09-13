import type { SessionState } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The session mark: a small circle inset in a tile. Dashed and dim when nobody is attached,
 * dashed with a green dot on the tile's corner when a terminal is connected and idle, and a
 * spinning arc while a turn is running.
 */
export function SessionRing({ state, className }: { state: SessionState; className?: string }): React.JSX.Element {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"session-mark",
				state === "working" && "session-mark-working",
				state === "live" && "session-mark-live",
				state === "offline" && "session-mark-offline",
				className,
			)}
		/>
	);
}
