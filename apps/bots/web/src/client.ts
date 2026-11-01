// Builds the API client and socket the UI talks to: the in-memory fake when VITE_FAKE is set.
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

/** The fake backend, seeded with the reference seed when the URL asks for `?seed=reference`. */
export async function createClient(): Promise<Client> {
	if (import.meta.env.VITE_FAKE !== "1")
		throw new Error("the real backend client arrives with the Worker; run with VITE_FAKE=1");
	const seed = await chooseSeed();
	// The fake serves the template gallery the real backend will serve.
	if (seed.templates.length === 0) seed.templates = TEMPLATES;
	const fake = createFakeBackend(seed, { clock: realtimeClock() });
	return { api: createApiClient(fake.fetch, location.origin), connect: () => fake.connect() };
}

async function chooseSeed(): Promise<FakeSeed> {
	if (new URLSearchParams(location.search).get("seed") !== "reference") return defaultSeed();
	const response = await fetch("/__seed/reference.json");
	if (!response.ok) throw new Error("the reference seed is not available");
	return seedFrom((await response.json()) as Partial<FakeSeed>);
}
