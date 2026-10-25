import type { ReactNode } from "react";
import { IconButton } from "./button.tsx";
import { X } from "./icons.tsx";

/**
 * A tab in a strip (the side panel's, the terminals'): a slot of up to 240px, 32px
 * tall; the chosen one on a ghost fill with a hairline ring and a 1px shadow, the others at half strength; a 16px icon
 * 4px from the 13px title, which a preview tab sets in italics; the close button 20px, shown on the chosen tab and on
 * hover.
 */
export function StripTab({
	icon,
	title,
	tooltip,
	italic = false,
	dirty = false,
	active,
	onSelect,
	onKeep,
	onClose,
}: {
	icon: ReactNode;
	title: string;
	tooltip?: string;
	italic?: boolean;
	/** Unsaved edits: a dot where the close button is, the button again on hover. */
	dirty?: boolean;
	active: boolean;
	onSelect: () => void;
	onKeep?: () => void;
	onClose: () => void;
}) {
	return (
		<div role="presentation" className="group/tab relative flex h-8 min-w-0 flex-1 items-center">
			<div
				className={`pointer-events-none absolute inset-0 rounded-[10px] border ${active ? "border-line-strong bg-ghost-hover shadow-[0_1px_2px_-1px_rgb(0_0_0/0.25)]" : "border-transparent group-hover/tab:bg-ghost-hover"}`}
			/>
			<button
				type="button"
				role="tab"
				aria-selected={active}
				title={tooltip}
				onClick={onSelect}
				onDoubleClick={onKeep}
				className={`relative z-10 flex h-full min-w-0 flex-1 items-center gap-1 rounded-[10px] ps-2.5 pe-[27px] text-[13px] leading-[18.5px] ${active ? "text-ink" : "text-tertiary"}`}
			>
				{icon}
				<span className={`min-w-0 flex-1 truncate text-start ${italic ? "italic" : ""}`}>{title}</span>
			</button>
			<IconButton
				label={`Close ${title} tab`}
				size="3xs"
				className={`absolute end-[7px] z-10 rounded-[10px] ${active || dirty ? "" : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100"}`}
				onClick={onClose}
			>
				{dirty ? <span aria-hidden className="size-2 rounded-full bg-current group-hover/tab:hidden" /> : null}
				<X size={14} className={dirty ? "hidden group-hover/tab:block" : undefined} />
			</IconButton>
		</div>
	);
}

/** A strip's slot for one tab: 240px each while they fit, sharing the strip when they do not, scrolling past 120px. */
export function StripSlot({ children, divider }: { children: ReactNode; divider: boolean }) {
	return (
		<div className="flex w-[240px] min-w-[120px] shrink items-center pe-0.5">
			{children}
			{/* A divider between two tabs at rest. */}
			<div className={`ms-0.5 h-3 w-px shrink-0 bg-line ${divider ? "" : "invisible"}`} />
		</div>
	);
}
