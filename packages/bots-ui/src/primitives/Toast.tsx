// Brief notices at the bottom of the window, with an optional action such as Undo.
import { Toast as ToastPrimitive } from "radix-ui";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import { Button } from "./Button.tsx";

export interface ToastMessage {
	text: string;
	action?: { label: string; onAction: () => void };
}

const ToastContext = createContext<(message: ToastMessage) => void>(() => undefined);

/** Shows `message` as a toast. Requires a `ToastProvider` above. */
export function useToast(): (message: ToastMessage) => void {
	return useContext(ToastContext);
}

/** Holds the toast queue and the viewport they appear in. */
export function ToastProvider({ children }: { children: ReactNode }) {
	const [toasts, setToasts] = useState<(ToastMessage & { id: number })[]>([]);
	const show = useCallback(
		(message: ToastMessage) => setToasts((list) => [...list, { ...message, id: Date.now() + list.length }]),
		[],
	);
	const dismiss = (id: number) => setToasts((list) => list.filter((t) => t.id !== id));
	return (
		<ToastContext.Provider value={show}>
			<ToastPrimitive.Provider duration={5000}>
				{children}
				{toasts.map((toast) => (
					<ToastPrimitive.Root key={toast.id} className="kb-toast" onOpenChange={(open) => !open && dismiss(toast.id)}>
						<ToastPrimitive.Description>{toast.text}</ToastPrimitive.Description>
						{toast.action && (
							<ToastPrimitive.Action asChild altText={toast.action.label}>
								<Button size="sm" variant="subtle" onClick={toast.action.onAction}>
									{toast.action.label}
								</Button>
							</ToastPrimitive.Action>
						)}
					</ToastPrimitive.Root>
				))}
				<ToastPrimitive.Viewport className="kb-toast-viewport" />
			</ToastPrimitive.Provider>
		</ToastContext.Provider>
	);
}
