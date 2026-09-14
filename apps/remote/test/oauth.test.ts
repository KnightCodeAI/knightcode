import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { completeLogin, startLogin } from "../src/oauth.ts";

function login(next: string): { response: Response; nonce: string; state: string } {
	const response = startLogin(env, new URL(`https://remote.knightcode.dev/login?next=${next}`));
	const nonce = /kc_oauth_state=([^;]*)/.exec(response.headers.get("set-cookie") ?? "")?.[1] ?? "";
	const state = new URL(response.headers.get("location") ?? "").searchParams.get("state") ?? "";
	return { response, nonce, state };
}

describe("github login", () => {
	it("redirects to GitHub with a state bound to this browser and carrying the return path", () => {
		const { response, nonce, state } = login("/r/ABC");
		expect(response.status).toBe(302);
		const location = new URL(response.headers.get("location") ?? "");
		expect(location.origin).toBe("https://github.com");
		expect(location.pathname).toBe("/login/oauth/authorize");
		expect(location.searchParams.get("client_id")).toBe(env.GITHUB_CLIENT_ID);
		expect(nonce.length).toBeGreaterThan(20);
		expect(state).toBe(`${nonce}/r/ABC`);
	});

	it("refuses an off-site return path", () => {
		const { nonce, state } = login("https://evil.test/");
		expect(state.slice(nonce.length)).toBe("/");
	});

	it("refuses a protocol-relative return path that would leave the origin", () => {
		const { nonce, state } = login("//evil.test/steal");
		expect(state.slice(nonce.length)).toBe("/");
	});

	it("refuses a callback this browser did not start, before the code is exchanged", async () => {
		// An attacker's own login yields a genuine state and code. Handed to a victim, the
		// callback must not sign that browser into the attacker's account.
		const attacker = login("/device");
		const victim = login("/");
		const callback = `https://remote.knightcode.dev/auth/callback?code=attacker-code&state=${encodeURIComponent(attacker.state)}`;
		const cookies: Array<Record<string, string>> = [{}, { cookie: `kc_oauth_state=${victim.nonce}` }];
		for (const headers of cookies) {
			const response = await completeLogin(env, new Request(callback, { headers }));
			expect(response.status).toBe(400);
			expect(response.headers.get("set-cookie")).toBeNull();
		}
	});
});
