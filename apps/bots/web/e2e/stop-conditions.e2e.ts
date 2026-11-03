// apps/bots/web/e2e/stop-conditions.e2e.ts: the spec's Stop condition, one test per item, against the real Worker
// (wrangler dev), the emulated services and the fake model server. BOTS_BACKEND=real only.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectProviders, providerRules } from "../../../desktop/src/main/bots/connect.ts";
import { expect, REAL, test } from "./fixtures.ts";
import { apiOf, postSlack, threadTexts, until, WEB } from "./stop-helpers.ts";

test.skip(!REAL, "the stop conditions run against the real backend (BOTS_BACKEND=real)");
test.describe.configure({ timeout: 120_000 });

test("A desktop user connects their providers with Connect to KnightCode Bots, and the CLI on the same machine stays signed in", async ({ context }) => {
	const api = apiOf(context.request);
	// The CLI's credential store on this machine: an OAuth sign-in and an API key.
	const home = mkdtempSync(join(tmpdir(), "kc-cli-"));
	const local = join(home, "auth.json");
	writeFileSync(local, JSON.stringify({ anthropic: { type: "oauth", access: "cli-access", refresh: "cli-refresh", expires: 4_102_444_800_000 }, openai: { type: "api_key", key: "sk-cli-key" } }));
	const before = readFileSync(local);
	try {
		const results = await connectProviders(
			[
				{ id: "anthropic", kind: "oauth" },
				{ id: "openai", kind: "api_key" },
			],
			providerRules(),
			{
				// The provider's own sign-in again, into a sink of its own (the browser step is the provider's).
				login: async (sink, providerId) => {
					const credential = { type: "oauth" as const, access: `cloud-${providerId}`, refresh: `cloud-refresh-${providerId}`, expires: Date.now() + 3_600_000 };
					await sink.modify(providerId, async () => credential);
					return credential;
				},
				enroll: async (providerId) => api.beginEnrollment({ provider: providerId }),
				upload: async (token, credential) => {
					const provider = credential.type === "api_key" ? "openai" : "anthropic";
					await api.completeEnrollment({ provider, token, credential });
				},
				localApiKey: async (providerId) => (JSON.parse(readFileSync(local, "utf8")) as Record<string, { key?: string }>)[providerId]?.key,
			},
		);
		expect(results).toEqual([
			{ provider: "anthropic", status: "connected" },
			{ provider: "openai", status: "connected" },
		]);
		const { providers } = await api.listProviders({});
		expect(providers.filter((provider) => provider.status === "connected").map((provider) => provider.provider).sort()).toEqual(["anthropic", "openai"]);
		// The CLI's own store is untouched: still signed in with its own tokens.
		expect(readFileSync(local).equals(before)).toBe(true);
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
});

test("An agent imported with the copy prompt arrives with its instructions and notes, and its routines paused", async ({ context, page }) => {
	const api = apiOf(context.request);
	const { bot } = await api.importRecipe({
		recipe: {
			profile: { name: "Porter", description: "You move the owner's files between drives and keep a log." },
			memory: [{ kind: "profile", content: "The owner's archive drive is called Attic." }],
			skills: [],
			routines: [{ name: "Nightly move", slug: "nightly-move", description: "Every night at 2", content: "Move yesterday's files to Attic." }],
			plugins: [],
		},
		origin: "self",
		memory: [0],
		sharedMemory: [],
		skills: [],
		routines: [0],
		plugins: [],
		runSetup: false,
		model: { provider: "fake", modelId: "fake-model" },
	});
	expect(bot.instructions).toBe("You move the owner's files between drives and keep a log.");
	const { notes } = await api.listNotes({ botId: bot.id });
	expect(notes.map((note) => note.body)).toContain("The owner's archive drive is called Attic.");
	const { routines } = await api.listRoutines({ botId: bot.id });
	expect(routines).toHaveLength(1);
	expect(routines[0]).toMatchObject({ name: "Nightly move", active: false, triggers: [] });
	await page.goto(`/bots/${bot.id}/routines`);
	await expect(page.getByText("Nightly move")).toBeVisible();
});

test("After four hours away, the user sees what finished and what waits; the inbox lists every pending approval across bots", async ({ context, page }) => {
	const api = apiOf(context.request);
	// A second bot asks before sending: two bots now wait on the user.
	await context.request.post(`${process.env.BOTS_FAKE_MODEL_URL!.replace(/\/v1$/, "")}/__script`, {
		data: { forBot: { Reviewer: [{ tool: "send_email", args: { to: "dana@example.com", subject: "Review", body: "PR 11 looks good." } }, "Asked."] } },
	});
	await api.updateBot({ botId: "reviewer", approvals: "ask" });
	const socket = await page.goto("/bots/reviewer");
	expect(socket?.ok()).toBe(true);
	await page.getByRole("textbox", { name: "Message" }).fill("Send Dana the review");
	await page.getByRole("textbox", { name: "Message" }).press("Enter");
	const pending = await until(async () => {
		const { approvals } = await api.listApprovals({});
		const waiting = approvals.filter((approval) => approval.state === "pending");
		return new Set(waiting.map((approval) => approval.botId)).size >= 2 && waiting;
	}, "approvals from two bots");
	await page.goto("/?away=5h");
	await expect(page.getByRole("heading", { name: "While you were away" })).toBeVisible();
	await page.goto("/inbox");
	for (const approval of pending) await expect(page.getByText(approval.action.title).first()).toBeVisible();
});

test("A Slack message containing a routine's keyword, and a webhook call, each fire that routine", async ({ context, page }) => {
	const api = apiOf(context.request);
	// Add to Slack: the app installs in the workspace through Slack's own consent page.
	await page.goto("/settings/channels");
	const popup = page.waitForEvent("popup");
	await page.getByRole("button", { name: /Add to Slack|Reinstall/ }).click();
	const consent = await popup;
	await consent.getByRole("button").filter({ hasText: /ada|allow|authorize|continue/i }).first().click();
	await consent.waitForURL(/\/settings\/channels\?slack=installed/);
	const { slackInstalled } = await api.getChannels({});
	expect(slackInstalled).toBe(true);
	const routine = await api.createRoutine({
		botId: "reviewer",
		name: "Deploy watch",
		prompt: "Summarize the deploy discussion.",
		triggers: [{ kind: "slack", match: "keyword", keyword: "deploy" }],
		grant: { actions: [], targets: [], limits: {} },
		active: true,
	});
	const teams = (await (await context.request.get(`${process.env.E2E_SLACK_URL}/api/team.info`, { headers: { authorization: "Bearer xoxb-any" } })).json().catch(() => ({}))) as { team?: { id?: string } };
	const team = teams.team?.id ?? "T000000001";
	expect((await postSlack(context.request, { type: "event_callback", team_id: team, event: { type: "message", channel: "C1", user: "U2", text: "the deploy is stuck", ts: "1.1" } })).ok()).toBe(true);
	await until(async () => (await api.listRuns({ routineId: routine.id })).runs.length >= 1, "the Slack-fired run");
	// The routine's webhook: a secret URL, minted once.
	const { url } = await api.mintWebhook({ id: routine.id });
	const hook = new URL(url);
	expect((await context.request.post(`${WEB}${hook.pathname}`, { data: { text: "deploy finished" } })).ok()).toBe(true);
	await until(async () => (await api.listRuns({ routineId: routine.id })).runs.length >= 2, "the webhook-fired run");
	expect(await threadTexts(api, "reviewer")).toEqual(expect.arrayContaining([expect.stringContaining("Deploy watch")]));
});
