// Boots the web app: the primitives gallery at /__gallery in development, otherwise KnightCode Bots. Against the real
// Worker it first checks the session: signed out shows sign-in, a new account chooses its handle.
import "@knightcode/bots-ui/styles.css";
import { type Account, ApiError } from "@knightcode/bots-protocol";
import { BotsApp } from "@knightcode/bots-ui";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "./client.ts";
import { Gallery } from "./gallery.tsx";
import { ChooseHandle, SignIn, suggestHandle } from "./signin.tsx";

const root = createRoot(document.getElementById("root") as HTMLElement);
const show = (node: ReactNode) => root.render(<StrictMode>{node}</StrictMode>);

if (import.meta.env.DEV && location.pathname === "/__gallery") {
	show(<Gallery />);
} else {
	// Web Push needs a service worker; it caches nothing, so a failed registration changes nothing else.
	navigator.serviceWorker?.register("/sw.js").catch(() => undefined);
	const client = await createClient();
	const account: Account | unknown = import.meta.env.VITE_FAKE === "1" ? undefined : await client.api.getAccount({}).catch((error: unknown) => error);
	const signedIn = account && !(account instanceof Error) ? (account as Account) : undefined;
	if (location.pathname === "/signin" || (account instanceof ApiError && account.status === 401)) show(<SignIn />);
	else if (signedIn && !signedIn.handle) show(<ChooseHandle api={client.api} suggestion={suggestHandle(signedIn.name)} />);
	else show(<BotsApp api={client.api} connect={client.connect} platform="web" />);
}
