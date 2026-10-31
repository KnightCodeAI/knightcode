import { env, SELF } from "cloudflare:test";
import { expect, it } from "vitest";
import { getKek } from "../src/env.ts";

it("answers health", async () => {
	const response = await SELF.fetch("https://bots.knightcode.dev/health");
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ ok: true });
});

it("refuses unknown API routes with a JSON 404", async () => {
	const response = await SELF.fetch("https://bots.knightcode.dev/api/nope");
	expect(response.status).toBe(404);
	expect(await response.json()).toEqual({ error: "not_found" });
});

it("imports the test key-encryption key", async () => {
	
	const key = await getKek(env);
	expect(key.algorithm.name).toBe("AES-KW");
});
