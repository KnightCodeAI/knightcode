// KnightCode Bots in the desktop window: the shared UI (packages/bots-ui) on the bots backend, with the product
// switcher at the start of its sidebar. Loaded the first time the user switches, so the coding app starts as before.
// Signed out, it offers the browser sign-in instead.
import "@knightcode/bots-ui/components.css";
import { BotsApp, Button, type DesktopHost } from "@knightcode/bots-ui";
import { type ReactNode, useState } from "react";
import { client } from "../client.ts";
import { signInToBots, useBotsState } from "./backend.ts";

/** "Let bots use this computer", kept and enforced in the main process. */
const desktop: DesktopHost = {
	computerAccess: {
		enabled: async () => (await client.host("host/bots/computer", {})).enabled,
		set: async (enabled) => (await client.host("host/bots/setComputer", { enabled })).enabled,
	},
};

export default function BotsMount({ switcher }: { switcher: ReactNode }) {
	const state = useBotsState();
	const [waiting, setWaiting] = useState(false);
	const [error, setError] = useState<string>();
	if (state.kind === "ready")
		// Fills the card beside the rail, as the coding app's sidebar and content do.
		return (
			<div className="min-w-0 flex-1">
				<BotsApp
					api={state.backend.api}
					connect={state.backend.connect}
					platform="desktop"
					sidebarHeader={switcher}
					desktop={desktop}
				/>
			</div>
		);
	const signIn = async () => {
		setWaiting(true);
		setError(undefined);
		try {
			await signInToBots();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "The sign-in did not finish.");
		} finally {
			setWaiting(false);
		}
	};
	return (
		<div className="flex min-w-0 flex-1 flex-col">
			<div className="p-2">{switcher}</div>
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
				{state.kind === "loading" ? null : (
					<>
						<h2 className="text-lg font-semibold">Sign in to KnightCode Bots</h2>
						<p className="max-w-sm text-sm opacity-70">
							Your browser opens to sign in; the app signs in once you have.
						</p>
						<Button variant="primary" disabled={waiting} onClick={() => void signIn()}>
							{waiting ? "Waiting for the browser…" : "Sign in"}
						</Button>
						{error && (
							<p className="text-sm" role="alert">
								{error}
							</p>
						)}
					</>
				)}
			</div>
		</div>
	);
}
