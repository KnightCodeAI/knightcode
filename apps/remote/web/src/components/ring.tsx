import type { SessionState } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The session mark. Dashed and dim when nobody is attached, dashed with a green dot when a
 * terminal is connected and idle, and a spinning arc while a turn is running.
 */
export function SessionRing({ state, className }: { state: SessionState; className?: string }): React.JSX.Element {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"ring",
				state === "working" && "ring-working",
				state === "live" && "ring-live",
				state === "offline" && "ring-offline",
				className,
			)}
		/>
	);
}
