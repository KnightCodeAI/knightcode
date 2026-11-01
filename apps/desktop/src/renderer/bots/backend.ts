// KnightCode Bots' backend in the desktop app: for now the in-memory fake the web app develops against, seeded with
// the template gallery (Task 4.1 swaps in the real API and socket). Light enough to load with the coding app, so the
// switcher's badge can count what needs the user in either product.
import { createApiClient, createFakeBackend, defaultSeed, realtimeClock } from "@knightcode/bots-protocol";
import { TEMPLATES } from "@knightcode/bots-ui/templates";
import { useEffect, useState } from "react";

const seed = defaultSeed();
if (seed.templates.length === 0) seed.templates = TEMPLATES;
const fake = createFakeBackend(seed, { clock: realtimeClock() });

/** The API client and socket factory BotsApp takes. The fake answers in memory; nothing goes to the network. */
export const botsBackend = {
	api: createApiClient(fake.fetch, "https://bots.knightcode.dev"),
	connect: () => fake.connect(),
};

// ponytail: polls; the real backend's socket pushes needs-you changes once Task 4.1 lands.
const POLL_MS = 15_000;

/** How many bots and groups need the user now. */
export function useNeedsYou(): number {
	const [count, setCount] = useState(0);
	useEffect(() => {
		let live = true;
		const load = () =>
			void botsBackend.api
				.listBots({})
				.then(({ bots, groups }) => {
					if (live)
						setCount(
							[...bots, ...groups].filter((item) => item.needsYou && !("archived" in item && item.archived)).length,
						);
				})
				.catch(() => {});
		load();
		const timer = setInterval(load, POLL_MS);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, []);
	return count;
}
