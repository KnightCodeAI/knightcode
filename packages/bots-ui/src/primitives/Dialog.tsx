// Modal dialogs on a scrim: a header with the title and a close button, a body, and an optional footer.
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "./cx.ts";
import { IconButton } from "./IconButton.tsx";

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
}: DialogProps) {
	const style: CSSProperties = { width, height };
	return (
		<DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="kb-dialog-scrim" />
				<DialogPrimitive.Content
					className={cx("kb-dialog", className)}
					style={style}
					data-ref={dataRef}
					aria-describedby={undefined}
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
							size={32}
							tooltip={false}
							data-ref="dialog-close"
						/>
					</DialogPrimitive.Close>
					{children}
					{footer && <footer className="kb-dialog__footer">{footer}</footer>}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
