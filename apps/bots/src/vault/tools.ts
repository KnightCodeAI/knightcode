// Vault tools for bots (spec section 21): request_secret asks the owner for a credential in a protected card;
// call_with_secret makes a request to the credential's own origin with the value injected server-side (Bearer, a named
// header, or Basic), and scrubs the value from the response in plain and common encoded forms; forget_secret removes one.
// The model never sees a value.
import type { VaultItem } from "@knightcode/bots-protocol";
import { defineTool } from "@knightcode/durable";
import { obj, opt, str, union, lit } from "@knightcode/schema";
import { guardedFetch } from "../connectors/guarded-fetch.ts";

const RESPONSE_MAX = 20_000;
export const SCRUBBED = "[secret removed]";

const utf8 = (text: string) => new TextEncoder().encode(text);
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const base64url = (bytes: Uint8Array) => base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Every form a value may come back in: plain, base64 (standard and URL-safe, with and without padding), percent-encoded, hex. */
export function encodings(value: string): string[] {
	const bytes = utf8(value);
	const forms = new Set([value, base64(bytes), base64(bytes).replace(/=+$/, ""), base64url(bytes), encodeURIComponent(value), hex(bytes), JSON.stringify(value).slice(1, -1)]);
	return [...forms].filter((form) => form.length >= 4).sort((a, b) => b.length - a.length);
}

/** `text` with every encoding of every secret replaced. */
export function scrub(text: string, secrets: string[]): string {
	let out = text;
	for (const secret of secrets) for (const form of encodings(secret)) out = out.split(form).join(SCRUBBED);
	return out;
}

export interface VaultAccess {
	/** A credentialed write, through the owner's approval; its outcome or why it waits. */
	write?(request: { name: string; method: string; url: string; body?: string }): Promise<{ ok: boolean; text: string }>;
	list(): Promise<VaultItem[]>;
	/** The value, server-side only. */
	reveal(id: string): Promise<string>;
	forget(id: string): Promise<void>;
	/** Shows the owner a protected card to enter a credential. */
	request(input: { name: string; origin: string; kind: VaultItem["kind"] }): Promise<void>;
	/** Development only: local origins reachable over plain HTTP (the browser tests' fake services). */
	localOrigins?: string[];
}

/** Development servers only (BOTS_DEV_SEED): the local origins credentialed calls may reach. */
export const devVaultOrigins = (env: { BOTS_DEV_SEED?: string; BOTS_DEV_VAULT_ORIGINS?: string }) =>
	env.BOTS_DEV_SEED === "1" ? (env.BOTS_DEV_VAULT_ORIGINS ?? "").split(",").filter(Boolean) : [];

/** The request headers carrying `value` for `item`, and every string that must be scrubbed. */
export function injection(item: VaultItem, value: string): { headers: Record<string, string>; secrets: string[] } {
	if (item.injection === "header" && item.header) return { headers: { [item.header]: value }, secrets: [value] };
	if (item.injection === "basic") {
		// A Basic credential is stored as "user:password"; its base64 form is what goes on the wire.
		return { headers: { authorization: `Basic ${base64(utf8(value))}` }, secrets: [value, ...value.split(":").filter((part) => part.length >= 4)] };
	}
	return { headers: { authorization: `Bearer ${value}` }, secrets: [value] };
}

const text = (value: string, isError = false) => ({ output: [{ type: "text" as const, text: value }], ...(isError ? { isError } : {}) });

/** Sends one credentialed request to the item's own origin and returns its scrubbed text. */
export async function callWithSecret(
	item: VaultItem,
	value: string,
	request: { method: string; url: string; body?: string },
	localOrigins: string[] = [],
): Promise<{ ok: boolean; text: string }> {
	const { headers, secrets } = injection(item, value);
	try {
		const response = await guardedFetch(
			request.url,
			{ method: request.method, headers: { ...headers, ...(request.body ? { "content-type": "application/json" } : {}) }, ...(request.body ? { body: request.body } : {}) },
			{ allowPrivate: localOrigins.includes(new URL(request.url).origin) ? [new URL(request.url).host] : [], sameOrigin: true },
		);
		const body = (await response.text()).slice(0, RESPONSE_MAX);
		const headerText = [...response.headers].map(([name, headerValue]) => `${name}: ${headerValue}`).join("\n");
		return { ok: response.ok, text: scrub(`HTTP ${response.status}\n${headerText}\n\n${body}`, secrets) };
	} catch (error) {
		return { ok: false, text: scrub(error instanceof Error ? error.message : String(error), secrets) };
	}
}

export function vaultTools(vault: VaultAccess) {
	return [
		defineTool({
			name: "call_with_secret",
			description: "Call an HTTPS API with a vault credential (by name) added for you; you never see the value.",
			deferred: true,
			parameters: obj({
				name: str(),
				url: str(),
				method: opt(union([lit("GET"), lit("POST"), lit("PUT"), lit("PATCH"), lit("DELETE")])),
				body: opt(str()),
			}),
			execute: async (args) => {
				const item = (await vault.list()).find((candidate) => candidate.name === args.name && candidate.kind === "api");
				if (!item?.origin) return text(`No API credential named ${args.name}. Ask the owner with request_secret.`, true);
				let url: URL;
				try {
					url = new URL(args.url);
				} catch {
					return text("That is not a URL.", true);
				}
				// Only to the credential's own origin, over HTTPS.
				const local = vault.localOrigins?.includes(url.origin) === true;
				if ((url.protocol !== "https:" && !local) || url.origin !== new URL(item.origin).origin)
					return text(`${args.name} is for ${item.origin}; it is never sent anywhere else.`, true);
				const method = args.method ?? "GET";
				// A write changes something at the service: it is an action, approved like any other.
				if (method !== "GET") {
					if (!vault.write) return text("Writes with a credential need the owner's approval, which is not available here.", true);
					const result = await vault.write({ name: item.name, method, url: url.href, ...(args.body ? { body: args.body } : {}) });
					return text(result.text, !result.ok);
				}
				const result = await callWithSecret(item, await vault.reveal(item.id), { method, url: url.href }, vault.localOrigins);
				return text(result.text, !result.ok);
			},
		}),
		defineTool({
			name: "request_secret",
			description: "Ask the owner to add a credential (API key, login or variable) for an origin, in a protected card.",
			deferred: true,
			parameters: obj({ name: str(), origin: str(), kind: union([lit("api"), lit("login"), lit("env")]) }),
			execute: async (args) => {
				await vault.request(args);
				return text("The owner is asked in a protected card. Continue with other work; the credential will be there when they add it.");
			},
		}),
		defineTool({
			name: "forget_secret",
			description: "Remove a vault credential by name.",
			deferred: true,
			parameters: obj({ name: str() }),
			execute: async (args) => {
				const item = (await vault.list()).find((candidate) => candidate.name === args.name);
				if (!item) return text(`No credential named ${args.name}.`, true);
				await vault.forget(item.id);
				return text(`Removed ${args.name}.`);
			},
		}),
	];
}
