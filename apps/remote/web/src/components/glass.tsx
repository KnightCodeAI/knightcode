import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Round glass icon button, the only kind the bars use. 44px: the smallest comfortable thumb target. */
export function GlassButton({ className, type = "button", ...props }: ComponentProps<"button">): React.JSX.Element {
	return <button type={type} className={cn("glass-button", className)} {...props} />;
}

export function GlassLink({ className, ...props }: ComponentProps<"a">): React.JSX.Element {
	return <a className={cn("glass-button", className)} {...props} />;
}

/**
 * The top of a screen: a progressive blur that fades into the page, with the controls
 * floating on it. Content scrolls under it, which is what gives the blur something to do.
 */
export function TopBar({
	left,
	center,
	right,
	className,
}: {
	left?: ReactNode;
	center?: ReactNode;
	right?: ReactNode;
	className?: string;
}): React.JSX.Element {
	return (
		<header
			className={cn(
				"pointer-events-none absolute inset-x-0 top-0 z-20 pb-4",
				"[mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
				"bg-[linear-gradient(to_bottom,var(--ground)_40%,transparent)]",
				"[backdrop-filter:blur(20px)_saturate(1.1)] [-webkit-backdrop-filter:blur(20px)_saturate(1.1)]",
				className,
			)}
			style={{ paddingTop: "var(--safe-top)" }}
		>
			<div className="mx-auto flex h-(--topbar) max-w-3xl items-center gap-3 px-3">
				<div className="pointer-events-auto flex w-11 flex-none justify-start">{left}</div>
				<div className="pointer-events-auto min-w-0 flex-1 text-center">{center}</div>
				<div className="pointer-events-auto flex w-11 flex-none justify-end">{right}</div>
			</div>
		</header>
	);
}
