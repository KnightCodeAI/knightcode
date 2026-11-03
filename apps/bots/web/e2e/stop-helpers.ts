// Helpers for the stop-condition suite: the API as the signed-in test account, the fake model's script, waiting, and
// signing webhooks the way each service does.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { type ApiClient, createApiClient } from "@knightcode/bots-protocol";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import type { Reply } from "../../test/fake-model-server.ts";

export const WEB = "http://localhost:5190";

/** The contract's client, as the test's signed-in account (its session cookie rides on `request`). */
export function apiOf(request: APIRequestContext): ApiClient {
	return createApiClient(async (input, init) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const response = await request.fetch(url, {
			method: init?.method ?? "GET",
			// As the browser sends it: state changes carry the web app's own origin.
			headers: { ...Object.fromEntries(new Headers(init?.headers)), origin: WEB },
			...(init?.body ? { data: init.body as string } : {}),
		});
		const status = response.status();
		return new Response(status === 204 ? null : new Uint8Array(await response.body()), { status, headers: response.headers() });
	}, WEB);
}

const modelServer = () => process.env.BOTS_FAKE_MODEL_URL!.replace(/\/v1$/, "");

/** What a bot answers next, in order (text, or { tool, args } for a tool call). */
export async function script(request: APIRequestContext, forBot: Record<string, Reply[]>): Promise<void> {
	await request.post(`${modelServer()}/__script`, { data: { forBot } });
}

/** What the fake model was asked, per bot. */
export type ModelRequest = { bot?: string; user: string; tool?: string; tools: string[]; start: number; end?: number };
export async function modelRequests(request: APIRequestContext): Promise<ModelRequest[]> {
	return ((await (await request.get(`${modelServer()}/__requests`)).json()) as { requests: ModelRequest[] }).requests;
}

export async function until<T>(check: () => Promise<T | undefined | false>, what: string, timeoutMs = 30_000): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await check().catch(() => undefined);
		if (value) return value;
		if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}

/** The texts of a bot's thread. */
export async function threadTexts(api: ApiClient, botId: string): Promise<string[]> {
	const view = await api.getHistory({ botId, limit: 500 });
	return view.entries.flatMap((entry) => (entry.kind === "message" ? [entry.text] : []));
}

export const hmacHex = (secret: string, text: string) => createHmac("sha256", secret).update(text).digest("hex");

/** A GitHub webhook delivery, signed as GitHub signs it. */
export function postGitHub(request: APIRequestContext, event: string, payload: unknown) {
	const body = JSON.stringify(payload);
	return request.post(`${WEB}/hooks/github`, {
		headers: { "x-github-event": event, "x-hub-signature-256": `sha256=${hmacHex(process.env.E2E_GITHUB_WEBHOOK_SECRET!, body)}`, "content-type": "application/json" },
		data: body,
	});
}

/** A Slack Events API delivery, signed as Slack signs it. */
export function postSlack(request: APIRequestContext, payload: unknown) {
	const body = JSON.stringify(payload);
	const timestamp = String(Math.floor(Date.now() / 1000));
	return request.post(`${WEB}/hooks/slack`, {
		headers: { "x-slack-request-timestamp": timestamp, "x-slack-signature": `v0=${hmacHex(process.env.E2E_SLACK_SIGNING_SECRET!, `v0:${timestamp}:${body}`)}`, "content-type": "application/json" },
		data: body,
	});
}

/** The account id of the test's session. */
export async function accountId(context: BrowserContext): Promise<string> {
	return ((await (await context.request.get(`${WEB}/api/account`)).json()) as { id: string }).id;
}

/** Mail to a bot, through the Worker's email handler (wrangler's local trigger). */
export function sendMailToBot(request: APIRequestContext, mail: { from: string; to: string; subject: string; messageId: string; text: string }) {
	const raw = [`From: ${mail.from}`, `To: ${mail.to}`, `Subject: ${mail.subject}`, `Message-ID: ${mail.messageId}`, "Content-Type: text/plain; charset=utf-8", "", mail.text, ""].join("\r\n");
	const url = `${process.env.E2E_WORKER_URL}/cdn-cgi/local/email?from=${encodeURIComponent(mail.from)}&to=${encodeURIComponent(mail.to)}`;
	return request.post(url, { headers: { "content-type": "message/rfc822" }, data: raw });
}

export type SentMail = { from: string; to: string; subject: string; text: string };

/** Mail the Worker has sent (the local send_email binding logs each one; its text is kept in a file). */
export function sentMail(): SentMail[] {
	const log = readFileSync(process.env.E2E_DEV_LOG!, "utf8").replace(/\x1b\[[0-9;]*m/g, "");
	const mails: SentMail[] = [];
	for (const block of log.split("send_email binding called with MessageBuilder:").slice(1)) {
		const field = (name: string) => block.match(new RegExp(`^${name}: (.*)$`, "m"))?.[1]?.trim() ?? "";
		const textFile = field("Text");
		mails.push({ from: field("From"), to: field("To"), subject: field("Subject"), text: textFile ? readFileSync(textFile, "utf8") : "" });
	}
	return mails;
}

/** "Add to Slack" from Settings, through the Slack consent page. */
export async function installSlack(page: Page): Promise<void> {
	await page.goto("/settings/channels");
	const popup = page.waitForEvent("popup");
	await page.getByRole("button", { name: /Add to Slack|Reinstall/ }).click();
	const consent = await popup;
	await consent.getByRole("button").filter({ hasText: /ada|allow|authorize|continue/i }).first().click();
	await consent.waitForURL(/\/settings\/channels\?slack=installed/);
	await consent.close();
}

/** A Telegram update to the Worker's webhook, with the secret Telegram sends. */
export function postTelegram(request: APIRequestContext, chatId: number, text: string) {
	const id = Math.floor(Math.random() * 1e9);
	return request.post(`${WEB}/hooks/telegram`, {
		headers: { "x-telegram-bot-api-secret-token": process.env.E2E_TELEGRAM_SECRET!, "content-type": "application/json" },
		data: JSON.stringify({ update_id: id, message: { message_id: id, chat: { id: chatId, type: "private" }, from: { id: chatId }, text } }),
	});
}

/** What the Worker sent to a Telegram chat. */
export async function telegramSent(request: APIRequestContext, chatId: number): Promise<string[]> {
	const base = process.env.E2E_TELEGRAM_URL!.replace(/\/bot[^/]*$/, "");
	const all = (await (await request.get(`${base}/test/sent`)).json()) as { chat_id: string | number; text: string }[];
	return all.filter((message) => String(message.chat_id) === String(chatId)).map((message) => message.text);
}
