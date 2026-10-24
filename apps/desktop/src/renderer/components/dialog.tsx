/**
 * Dialogs, on Radix Dialog as Codex builds them (measured 2026-10-19). Radix renders them at the top of the document,
 * traps the focus, closes on Escape and outside presses and hands the focus back to what opened them; nothing
 * animates, as in Codex.
 *
 * - "dialog" (Rename chat, Remove project, Work here, handoff): a 420px card centred in the window, 20px in, with an
 *   optional 36px icon tile 20px over a 20px semibold title, a 14px tertiary description, the body, then the actions at
 *   the end 12px apart (DialogActions), and a close button 16px in from the top right (styles.css, .kc-dialog).
 * - "card" (Codex's commit and pull request cards): a 420px panel of rows, 4px in, no title bar (styles.css, .kc-card).
 *   `placement="top"` and a width make Codex's command menu: 520px, its top a fifth of the way down the window.
 */

import { Dialog as DialogPrimitive } from "radix-ui";
import { type ReactNode, useState } from "react";
import { Button, IconButton } from "./button.tsx";
import { X } from "./icons.tsx";

/**
 * What opened a dialog, nearest first: the focused element, then the trigger of the menu or panel holding it, and so
 * on outwards (a Radix trigger names its menu or panel in aria-controls). A dialog opened from a menu item gives the
 * focus back to the first of these still on screen when it closes, as the item and its menu are gone by then.
 */
function openers(): HTMLElement[] {
	const chain: HTMLElement[] = [];
	let element = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	while (element && chain.length < 4) {
		chain.push(element);
		const holder = element.closest<HTMLElement>('[role="menu"], [role="dialog"]');
		element = holder?.id ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(holder.id)}"]`) : null;
	}
	return chain;
}

export function Dialog({
	open = true,
	onClose,
	title,
	description,
	icon,
	variant = "dialog",
	placement = "center",
	width = 420,
	children,
}: {
	open?: boolean;
	onClose: () => void;
	/** Shown in the "dialog" variant; in a card it only names the dialog for assistive tech. */
	title: ReactNode;
	description?: ReactNode;
	/** The "dialog" variant's icon tile over the title (Codex's Work here and handoff dialogs). */
	icon?: ReactNode;
	variant?: "dialog" | "card";
	placement?: "center" | "top";
	width?: number;
	children: ReactNode;
}) {
	const card = variant === "card";
	const [returnTo] = useState(openers);
	return (
		<DialogPrimitive.Root open={open} onOpenChange={(next) => next || onClose()}>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
				<DialogPrimitive.Content
					// Radix asks for a description or an explicit "none".
					{...(description ? {} : { "aria-describedby": undefined })}
					// A dialog with a field opens on it (the one marked data-autofocus, else the first), as Codex's do.
					// A menu that opened the dialog still traps the focus until it unmounts a render later, so take
					// the focus once it has let go.
					onOpenAutoFocus={(event) => {
						const content = event.currentTarget as HTMLElement;
						const field =
							content.querySelector<HTMLElement>("[data-autofocus]") ??
							content.querySelector<HTMLElement>("input, textarea");
						if (!field) return;
						event.preventDefault();
						setTimeout(() => field.focus());
					}}
					onCloseAutoFocus={(event) => {
						const target = returnTo.find((element) => element.isConnected);
						if (!target) return;
						event.preventDefault();
						target.focus();
					}}
					style={{ width }}
					className={`fixed left-1/2 z-50 max-w-[92vw] -translate-x-1/2 text-ink outline-none ${placement === "top" ? "top-[20vh]" : "top-1/2 -translate-y-1/2"} ${
						card ? "kc-card flex flex-col gap-1 rounded-2xl p-1" : "kc-dialog rounded-3xl p-5"
					}`}
				>
					{card ? (
						<DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
					) : (
						<>
							{icon ? (
								<span className="mb-5 flex size-9 items-center justify-center rounded-xl bg-surface-secondary">
									{icon}
								</span>
							) : null}
							<div className="flex flex-col gap-1 pe-6">
								<DialogPrimitive.Title className="text-[20px] leading-7 font-semibold">{title}</DialogPrimitive.Title>
								{description ? (
									<DialogPrimitive.Description className="text-base text-tertiary">
										{description}
									</DialogPrimitive.Description>
								) : null}
							</div>
							<DialogPrimitive.Close asChild>
								<IconButton label="Close dialog" size="xs" className="absolute top-4 right-4">
									<X size={16} />
								</IconButton>
							</DialogPrimitive.Close>
						</>
					)}
					{card && description ? (
						<DialogPrimitive.Description className="sr-only">{description}</DialogPrimitive.Description>
					) : null}
					{children}
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/** A dialog's buttons, at its end, 12px apart and 12px under the body (Codex's footer). */
export const DialogActions = ({ children }: { children: ReactNode }) => (
	<div className="flex items-center justify-end gap-3 pt-3">{children}</div>
);

/**
 * Codex's destructive confirmation (Remove project, Delete all archived chats): the question, what it does, then
 * Cancel and the action in the soft danger colour.
 */
export function ConfirmDialog({
	title,
	description,
	confirm,
	cancel = "Cancel",
	onConfirm,
	onClose,
}: {
	title: ReactNode;
	description: ReactNode;
	/** The action's label ("Delete", "Remove project"). */
	confirm: string;
	/** The way back's label, when Codex words it ("Continue viewing"). */
	cancel?: string;
	onConfirm: () => void;
	onClose: () => void;
}) {
	return (
		<Dialog title={title} description={description} onClose={onClose}>
			<DialogActions>
				<Button color="secondary" size="lg" squircle className="px-4" onClick={onClose}>
					{cancel}
				</Button>
				<Button
					variant="soft"
					color="danger"
					size="lg"
					squircle
					className="px-4"
					onClick={() => {
						onClose();
						onConfirm();
					}}
				>
					{confirm}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
