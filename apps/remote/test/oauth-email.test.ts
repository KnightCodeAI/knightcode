import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeLogin, startLogin } from "../src/oauth.ts";

/**
 * The stored address is what the bug report allowlist matches, so which address is picked out
 * of GitHub's list is a security decision, not a formatting one. Anyone can add someone
 * else's address to their own GitHub account; only the account that proved ownership gets
 * `verified: true`.
 */
type Address = { email: string; primary: boolean; verified: boolean };

function githubReturning(addresses: Address[] | { status: number }): void {
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
		const url = String(input instanceof Request ? input.url : input);
		if (url.includes("/login/oauth/access_token")) {
			return Response.json({ access_token: "gho_test" });
		}
		if (url.endsWith("/user/emails")) {
			if (!Array.isArray(addresses)) return new Response("no", { status: addresses.status });
			return Response.json(addresses);
		}
		if (url.endsWith("/user")) {
			return Response.json({ id: 4242, login: "someone", avatar_url: null });
		}
		throw new Error(`unexpected fetch: ${url}`);
	});
}

async function signIn(): Promise<string | null> {
	const start = startLogin(env, new URL("https://remote.knightcode.dev/login?next=/"));
	const nonce = /kc_oauth_state=([^;]*)/.exec(start.headers.get("set-cookie") ?? "")?.[1] ?? "";
	const state = new URL(start.headers.get("location") ?? "").searchParams.get("state") ?? "";
	const response = await completeLogin(
		env,
		new Request(
			`https://remote.knightcode.dev/auth/callback?code=c&state=${encodeURIComponent(state)}`,
			{ headers: { cookie: `kc_oauth_state=${nonce}` } },
		),
	);
	expect(response.status).toBe(302);
	const row = await env.DB.prepare("SELECT email FROM accounts WHERE provider_user_id = '4242'").first<{
		email: string | null;
	}>();
	return row?.email ?? null;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await env.DB.exec("DELETE FROM accounts");
});

describe("the address stored at sign-in", () => {
	it("asks GitHub for the address list, which needs the user:email scope", () => {
		const start = startLogin(env, new URL("https://remote.knightcode.dev/login"));
		const scope = new URL(start.headers.get("location") ?? "").searchParams.get("scope");
		expect(scope).toBe("read:user user:email");
	});

	it("stores the verified primary address", async () => {
		githubReturning([
			{ email: "alt@example.com", primary: false, verified: true },
			{ email: "Primary@Example.com", primary: true, verified: true },
		]);
		// Lower-cased on the way in so the allowlist comparison cannot miss on case alone.
		expect(await signIn()).toBe("primary@example.com");
	});

	// The one that matters: an unverified address proves nothing about who owns it.
	it("stores nothing when the primary address is unverified", async () => {
		githubReturning([{ email: "claimed@example.com", primary: true, verified: false }]);
		expect(await signIn()).toBeNull();
	});

	it("stores nothing when a verified address is not the primary one", async () => {
		githubReturning([{ email: "secondary@example.com", primary: false, verified: true }]);
		expect(await signIn()).toBeNull();
	});

	// Sign-in still has to work; the account simply gets no admin access.
	it("signs in with no address when GitHub refuses the list", async () => {
		githubReturning({ status: 403 });
		expect(await signIn()).toBeNull();
	});
});
