import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { readProfile } from "../../src/main/profile.ts";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "kc-profile-"));
	process.env.KNIGHTCODE_REMOTE_CONFIG_DIR = dir;
	process.env.KNIGHTCODE_REMOTE_RELAY = "https://relay.test";
});
afterEach(() => {
	delete process.env.KNIGHTCODE_REMOTE_CONFIG_DIR;
	delete process.env.KNIGHTCODE_REMOTE_RELAY;
	rmSync(dir, { recursive: true, force: true });
});

const signIn = () => writeFileSync(join(dir, "remote-auth.json"), JSON.stringify({ token: "tok" }));

test("without a Remote sign-in there is no profile", async () => {
	let called = false;
	const profile = await readProfile(async () => {
		called = true;
		return new Response(null);
	});
	expect(profile).toEqual({ signedIn: false });
	expect(called).toBe(false);
});

test("the relay names the account behind the CLI token", async () => {
	signIn();
	let request: { url: string; auth: string | null } | undefined;
	const profile = await readProfile(async (url, init) => {
		request = { url: String(url), auth: new Headers(init?.headers).get("authorization") };
		return Response.json({ login: "octocat", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" });
	});
	expect(request).toEqual({ url: "https://relay.test/api/me", auth: "Bearer tok" });
	expect(profile).toEqual({
		signedIn: true,
		login: "octocat",
		avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
	});
});

test("a relay that cannot say who it is still leaves the sign-in, without a photo", async () => {
	signIn();
	expect(await readProfile(async () => new Response(null, { status: 401 }))).toEqual({ signedIn: true });
	expect(
		await readProfile(async () => {
			throw new Error("offline");
		}),
	).toEqual({ signedIn: true });
});

test("an avatar from anywhere but GitHub is dropped", async () => {
	signIn();
	for (const avatarUrl of [
		"https://evil.test/a.png",
		"https://avatars.githubusercontent.com.evil.test/a.png",
		"https://evilgithubusercontent.com/a.png",
		"http://avatars.githubusercontent.com/a.png",
		"javascript:alert(1)",
	]) {
		const profile = await readProfile(async () => Response.json({ login: "octocat", avatarUrl }));
		expect(profile, avatarUrl).toEqual({ signedIn: true, login: "octocat" });
	}
});
