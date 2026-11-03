// KnightCode Bots' backend in the desktop app: the real API and socket at bots.knightcode.dev once the app is signed in.
// The main process keeps the session; the renderer only ever holds short-lived tickets, one for API calls and one for
// each socket's first frame. The in-memory fake stays for development (KNIGHTCODE_BOTS_FAKE=1 in the main process).
import {
	type ApiClient,
	createApiClient,
	createFakeBackend,
	defaultSeed,
	realtimeClock,
	type WebSocketLike,
} from "@knightcode/bots-protocol";
import { TEMPLATES } from "@knightcode/bots-ui/templates";
import { useEffect, useState } from "react";
import { client } from "../client.ts";

export interface BotsBackend {
	api: ApiClient;
	connect: () => WebSocketLike;
}

export type BotsState = { kind: "loading" } | { kind: "signed-out" } | { kind: "ready"; backend: BotsBackend };

function fakeBackend(): BotsBackend {
	const seed = defaultSeed();
	if (seed.templates.length === 0) seed.templates = TEMPLATES;
	const fake = createFakeBackend(seed, { clock: realtimeClock() });
	return { api: createApiClient(fake.fetch, "https://bots.knightcode.dev"), connect: () => fake.connect() };
}

/** The real backend at `origin` for `accountId`: every API call carries a fresh-enough "api" ticket. */
function realBackend(origin: string, accountId: string): BotsBackend {
	let ticket: { ticket: string; expiresAt: number } | undefined;
	const apiTicket = async () => {
		if (!ticket || ticket.expiresAt - Date.now() < 10_000)
			ticket = await client.host("host/bots/ticket", { scope: "api" });
		return ticket.ticket;
	};
	const send: typeof fetch = async (input, init) => {
		const headers = new Headers(init?.headers);
		headers.set("authorization", `Ticket ${await apiTicket()}`);
		return fetch(input, { ...init, headers });
	};
	const sockets = origin.replace(/^http/, "ws");
	return {
		api: createApiClient(send, origin),
		// The socket's first frame carries a socket ticket, which the UI asks the API for.
		connect: () =>
			new WebSocket(`${sockets}/api/socket?account=${encodeURIComponent(accountId)}`) as unknown as WebSocketLike,
	};
}

let current: Promise<BotsState> | undefined;
const listeners = new Set<(state: BotsState) => void>();

async function load(): Promise<BotsState> {
	const status = await client.host("host/bots/status", {});
	if (status.origin === "fake") return { kind: "ready", backend: fakeBackend() };
	if (!status.signedIn || !status.accountId) return { kind: "signed-out" };
	return { kind: "ready", backend: realBackend(status.origin, status.accountId) };
}

/** Loads (once) the backend's state; `reload` reads it again, after signing in or out. */
export function botsState(reload = false): Promise<BotsState> {
	if (reload || !current) {
		current = load().catch((): BotsState => ({ kind: "signed-out" }));
		void current.then((state) => {
			for (const listener of listeners) listener(state);
		});
	}
	return current;
}

export function useBotsState(): BotsState {
	const [state, setState] = useState<BotsState>({ kind: "loading" });
	useEffect(() => {
		let live = true;
		void botsState().then((loaded) => live && setState(loaded));
		const listener = (next: BotsState) => live && setState(next);
		listeners.add(listener);
		return () => {
			live = false;
			listeners.delete(listener);
		};
	}, []);
	return state;
}

export async function signInToBots(): Promise<void> {
	await client.host("host/bots/signIn", {});
	await botsState(true);
}

// ponytail: polls; the account socket's bot events could push needs-you changes instead.
const POLL_MS = 15_000;

/** How many bots and groups need the user now (none while signed out). */
export function useNeedsYou(): number {
	const state = useBotsState();
	const [count, setCount] = useState(0);
	useEffect(() => {
		if (state.kind !== "ready") return setCount(0);
		let live = true;
		const refresh = () =>
			void state.backend.api
				.listBots({})
				.then(({ bots, groups }) => {
					if (live)
						setCount(
							[...bots, ...groups].filter((item) => item.needsYou && !("archived" in item && item.archived)).length,
						);
				})
				.catch(() => {});
		refresh();
		const timer = setInterval(refresh, POLL_MS);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [state]);
	return count;
}
