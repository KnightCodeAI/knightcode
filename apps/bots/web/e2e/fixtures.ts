// The browser tests' `test`: against the fake backend it is Playwright's own. Against the real one (BOTS_BACKEND=real)
// every test gets a fresh account, signed in and loaded with the same seed world the fake starts from, deleted after
// the test (bot ids are global object names, so the next test can load the same world).
import { defaultSeed, type FakeSeed, seedFrom } from "@knightcode/bots-protocol";
import { TEMPLATES } from "@knightcode/bots-ui/templates";
import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test as base, expect } from "@playwright/test";

export const REAL = process.env.BOTS_BACKEND === "real";

/**
 * Accounts a test could not delete (the dev server went away mid-test), deleted before the next test seeds. Kept in a
 * file: a retried test runs in a new worker process.
 */
const LEFTOVERS = fileURLToPath(new URL("../../.wrangler/e2e/leftover-accounts", import.meta.url));
const leftovers = () => (existsSync(LEFTOVERS) ? readFileSync(LEFTOVERS, "utf8").split("\n").filter(Boolean) : []);

export const test = base.extend<{ seedName: string | undefined; extendSeed: ((seed: FakeSeed) => void) | undefined; account: string | undefined }>({
	/** A named seed from the reference folder (as `?seed=<name>` loads into the fake); the default world otherwise. */
	seedName: [undefined, { option: true }],
	/** Changes to the seed before it loads (a test's own bots, notes or long history). */
	extendSeed: [undefined, { option: true }],
	account: [
		async ({ context, seedName, extendSeed }, use) => {
			if (!REAL) return use(undefined);
			// The dev server may be coming back after an exit (see global-setup.ts): a few tries over half a minute.
			let session = await context.request.post("/__dev/session", { data: { name: "Raghav" } }).catch(() => undefined);
			for (let attempt = 0; attempt < 30 && !session?.ok(); attempt++) {
				await new Promise((resolve) => setTimeout(resolve, 1_000));
				session = await context.request.post("/__dev/session", { data: { name: "Raghav" } }).catch(() => undefined);
			}
			if (!session) throw new Error("the dev server did not answer");
			expect(session.ok(), await session.text()).toBe(true);
			for (const leftover of leftovers()) {
				const cleared = await context.request.post("/__dev/delete", { data: { accountId: leftover } });
				expect(cleared.ok(), await cleared.text()).toBe(true);
			}
			rmSync(LEFTOVERS, { force: true });
			const seed = seedName
				? seedFrom((await (await context.request.get(`/__seed/${seedName}.json`)).json()) as Partial<FakeSeed>)
				: defaultSeed();
			if (seed.templates.length === 0) seed.templates = TEMPLATES;
			extendSeed?.(seed);
			// Each seeded bot answers with the reply the fake would stream.
			const byBot = Object.fromEntries(seed.bots.flatMap((bot) => (seed.replies[bot.id] ? [[bot.name, seed.replies[bot.id]!]] : [])));
			// As the fake does: with @everyone, every second member of a group has nothing to add.
			const passInGroups = seed.groups.flatMap((group) => group.memberIds.filter((_, index) => index % 2 === 1).map((id) => seed.bots.find((bot) => bot.id === id)?.name ?? id));
			await context.request.post(`${process.env.BOTS_FAKE_MODEL_URL!.replace(/\/v1$/, "")}/__script`, { data: { byBot, passInGroups } });
			// The account is deleted whatever happens (by id: the test may sign out), so the next test can load the same bot ids.
			const { accountId } = (await session.json()) as { accountId: string };
			try {
				const seeded = await context.request.post("/__dev/seed", { data: seed });
				expect(seeded.ok(), await seeded.text()).toBe(true);
				await use(accountId);
			} finally {
				const deleted = await context.request.post("/__dev/delete", { data: { accountId } }).catch(() => undefined);
				if (!deleted?.ok()) {
					appendFileSync(LEFTOVERS, `${accountId}\n`);
					throw new Error(`the test account was not deleted: ${await deleted?.text()}`);
				}
			}
		},
		{ auto: true },
	],
});

export { expect };
