// Builds the API client and socket the UI talks to: the Worker, or the in-memory fake when VITE_FAKE is set.
import {
	type ApiClient,
	createApiClient,
	createFakeBackend,
	defaultSeed,
	type FakeSeed,
	realtimeClock,
	seedFrom,
	type WebSocketLike,
} from "@knightcode/bots-protocol";
import { TEMPLATES } from "@knightcode/bots-ui";

export interface Client {
	api: ApiClient;
	connect: () => WebSocketLike;
}

/**
 * The Worker's API on this origin (the session cookie signs requests in) and its one realtime socket, which the UI
 * authenticates with a ticket in its first frame. With VITE_FAKE=1, the in-memory fake, seeded with the reference seed
 * when the URL asks for `?seed=reference`.
 */
export async function createClient(): Promise<Client> {
	if (import.meta.env.VITE_FAKE !== "1")
		return {
			api: createApiClient((input, init) => fetch(input, { ...init, credentials: "same-origin" }), location.origin),
			connect: () => new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/socket`) as unknown as WebSocketLike,
		};
	const seed = await chooseSeed();
	// The fake serves the template gallery the real backend will serve.
	if (seed.templates.length === 0) seed.templates = TEMPLATES;
	const fake = createFakeBackend(seed, { clock: realtimeClock() });
	return { api: createApiClient(fake.fetch, location.origin), connect: () => fake.connect() };
}

async function chooseSeed(): Promise<FakeSeed> {
	const name = new URLSearchParams(location.search).get("seed");
	if (!name || !/^[a-z][a-z-]*$/.test(name)) return defaultSeed();
	const response = await fetch(`/__seed/${name}.json`);
	if (!response.ok) throw new Error("the reference seed is not available");
	return seedFrom((await response.json()) as Partial<FakeSeed>);
}
