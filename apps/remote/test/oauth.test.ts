import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { startLogin } from "../src/oauth.ts";

describe("github login", () => {
	it("redirects to GitHub with a signed state carrying the return path", () => {
		const response = startLogin(env, new URL("https://remote.knightcode.dev/login?next=/r/ABC"));
		expect(response.status).toBe(302);
		const location = new URL(response.headers.get("location") ?? "");
		expect(location.origin).toBe("https://github.com");
		expect(location.pathname).toBe("/login/oauth/authorize");
		expect(location.searchParams.get("client_id")).toBe(env.GITHUB_CLIENT_ID);
		expect(location.searchParams.get("state")).toBeTruthy();
	});

	it("refuses an off-site return path", () => {
		const response = startLogin(env, new URL("https://remote.knightcode.dev/login?next=https://evil.test/"));
		const state = new URL(response.headers.get("location") ?? "").searchParams.get("state") ?? "";
		expect(state.startsWith("/r/")).toBe(false);
		expect(state.startsWith("/")).toBe(true);
	});

	it("refuses a protocol-relative return path that would leave the origin", () => {
		const response = startLogin(env, new URL("https://remote.knightcode.dev/login?next=//evil.test/steal"));
		expect(new URL(response.headers.get("location") ?? "").searchParams.get("state")).toBe("/");
	});
});
