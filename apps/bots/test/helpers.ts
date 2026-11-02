// Test helpers: driving an emulator's sign-in page, and a signed-in session without one.
import { env, SELF } from "cloudflare:test";
import { createAccount } from "../src/auth/accounts.ts";
import { issueSession, type Principal, SESSION_COOKIE } from "../src/auth/session.ts";
import { sha256 } from "../src/auth/util.ts";

/** The `name=value` pairs a response sets, joined as a request's Cookie header. */
export function cookiesOf(response: Response): string {
	return response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0]!)
		.join("; ");
}

/**
 * Follows our redirect to an emulator's sign-in page, chooses its first seeded user, and returns our callback's
 * response. The start response's cookies go along, as a browser would send them.
 */
export async function followEmulatorConsent(start: Response): Promise<Response> {
	const page = await fetch(start.headers.get("location")!);
	const html = await page.text();
	const form = /<form[^>]*action="([^"]+)"[^>]*>([\s\S]*?)<\/form>/.exec(html);
	if (!form) throw new Error(`no consent form on the emulator page (status ${page.status})`);
	const fields = new URLSearchParams();
	for (const input of form[2]!.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g))
		fields.set(input[1]!, decodeHtml(input[2]!));
	const consent = await fetch(new URL(form[1]!, page.url), { method: "POST", body: fields, redirect: "manual" });
	const back = consent.headers.get("location");
	if (!back) throw new Error(`the emulator did not redirect back (status ${consent.status})`);
	return SELF.fetch(back, { redirect: "manual", headers: { cookie: cookiesOf(start) } });
}

const decodeHtml = (value: string) =>
	value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/** A Cookie header for a fresh account's session, from the web client. */
export async function sessionCookie(): Promise<string> {
	const account = await createAccount(env.DB, { email: `${crypto.randomUUID()}@example.com`, name: "Test" });
	const token = await issueSession(env, account.accountId);
	return `${SESSION_COOKIE}=${token}`;
}

/** A fresh account signed in on the web: its principal, with the live session tickets are tied to. */
export async function signedInPrincipal(): Promise<Principal> {
	const account = await createAccount(env.DB, { email: `${crypto.randomUUID()}@example.com`, name: "Test" });
	const token = await issueSession(env, account.accountId);
	return { accountId: account.accountId, workspaceId: account.workspaceId, client: "web", sessionId: await sha256(token) };
}
