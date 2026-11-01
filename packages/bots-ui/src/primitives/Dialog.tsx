// Modal dialogs on a scrim: a header with the title and a close button, a body, and an optional footer.
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx.ts";
import { IconButton } from "./IconButton.tsx";
import { LayerProvider, useTopLayer } from "./layer.tsx";

export interface DialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	/** Hide the title bar (the title still names the dialog for assistive tech). */
	bare?: boolean;
	footer?: ReactNode;
	children: ReactNode;
	width?: number;
	height?: number;
	className?: string;
	/** For screenshot comparisons and tests. */
	dataRef?: string;
	/** Where focus goes on open; by default the dialog itself. */
	onOpenAutoFocus?: (event: Event) => void;
	/** The close button's size; 32 by default, 28 on the large browsing dialogs. */
	closeSize?: 28 | 32;
}

/** A modal dialog. Escape and the scrim close it. */
export function Dialog({
	open,
	onOpenChange,
	title,
	bare,
	footer,
	children,
	width,
	height,
	className,
	dataRef,
	onOpenAutoFocus,
	closeSize = 32,
}: DialogProps) {
	const style: CSSProperties = { width, height };
	const layer = useTopLayer(open);
	return (
		<DialogPrimitive.Root open={open && layer !== undefined} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal container={layer}>
				<DialogPrimitive.Overlay className="kb-dialog-scrim" />
				<DialogPrimitive.Content
					className={cx("kb-dialog", className)}
					style={style}
					data-ref={dataRef}
					aria-describedby={undefined}
					onOpenAutoFocus={
						onOpenAutoFocus ??
						((event) => {
							// Focus the dialog itself rather than its first control (the close button); Tab moves on from there.
							event.preventDefault();
							(event.currentTarget as HTMLElement | null)?.focus();
						})
					}
				>
					{bare ? (
						<DialogPrimitive.Title className="kb-visually-hidden">{title}</DialogPrimitive.Title>
					) : (
						<header className="kb-dialog__header">
							<DialogPrimitive.Title className="kb-dialog__title" data-ref="dialog-title">
								{title}
							</DialogPrimitive.Title>
						</header>
					)}
					<DialogPrimitive.Close asChild>
						<IconButton
							className="kb-dialog__close"
							label="Close dialog"
							icon={<X size={14} strokeWidth={1.75} />}
							variant="ghost"
							size={closeSize}
							tooltip={false}
							data-ref="dialog-close"
						/>
					</DialogPrimitive.Close>
					<LayerProvider value={layer}>
						{children}
						{footer && <footer className="kb-dialog__footer">{footer}</footer>}
					</LayerProvider>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
