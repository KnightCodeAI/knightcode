// Notifications on this device: Web Push for approvals, questions and replies, sent once you are away from every app.
// Shown where the web app registered its service worker; iPhones need the app on the home screen first.
import { useEffect, useState } from "react";
import { Toggle } from "../primitives/Toggle.tsx";
import { useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

type State = "unsupported" | "install" | "blocked" | "off" | "on";

/** A base64url VAPID key as the bytes pushManager.subscribe takes. */
const keyBytes = (key: string) =>
	Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** The web app's worker once it is active; it never settles where none registers (the desktop app), hiding the row. */
async function registration(): Promise<ServiceWorkerRegistration | undefined> {
	return "serviceWorker" in navigator ? navigator.serviceWorker.ready : undefined;
}

async function currentState(): Promise<State> {
	const reg = await registration();
	if (!reg) return "unsupported";
	// Safari exposes push only to apps added to the home screen.
	if (!("PushManager" in window)) return "install";
	if (Notification.permission === "denied") return "blocked";
	return (await reg.pushManager.getSubscription()) ? "on" : "off";
}

const HINTS: Record<Exclude<State, "unsupported">, string> = {
	install: "Add KnightCode Bots to your Home Screen to get notifications.",
	blocked: "Notifications are blocked for this site in your browser's settings.",
	off: "Approvals, questions and replies, once you're away from every app.",
	on: "Approvals, questions and replies, once you're away from every app.",
};

export function DevicePush() {
	const store = useStore();
	const [state, setState] = useState<State>();
	const [failed, setFailed] = useState(false);
	useEffect(() => void currentState().then(setState), []);
	if (!state || state === "unsupported") return null;
	const turn = async (on: boolean) => {
		setFailed(false);
		try {
			const reg = await registration();
			if (!reg) return;
			if (on) {
				const permission = await Notification.requestPermission();
				if (permission !== "granted") return setState(permission === "denied" ? "blocked" : "off");
				const { publicKey } = await store.api.getPushKey({});
				const subscription = await reg.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: keyBytes(publicKey),
				});
				await store.api.subscribePush({ subscription: subscription.toJSON() });
			} else {
				const subscription = await reg.pushManager.getSubscription();
				if (subscription) {
					await store.api.unsubscribePush({ endpoint: subscription.endpoint });
					await subscription.unsubscribe();
				}
			}
			setState(await currentState());
		} catch {
			setFailed(true);
		}
	};
	return (
		<SettingsSection title="Notifications">
			<SettingsCard>
				<SettingsRow
					title="Notifications on this device"
					hint={failed ? "This browser couldn't turn notifications on." : HINTS[state]}
					control={
						<Toggle
							label="Notifications on this device"
							checked={state === "on"}
							disabled={state === "install" || state === "blocked"}
							onCheckedChange={(on) => void turn(on)}
						/>
					}
				/>
			</SettingsCard>
		</SettingsSection>
	);
}
