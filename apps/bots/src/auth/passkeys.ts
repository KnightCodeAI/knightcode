// Passkeys (spec section 21): registering one to a signed-in account, and signing in with one. Each ceremony's
// challenge is stored for five minutes and spent once.
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { Env } from "../env.ts";
import { accountById } from "./accounts.ts";
import { appOrigin } from "./oauth.ts";
import { base64url, fromBase64url } from "./util.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RP_NAME = "KnightCode Bots";

type RegistrationJSON = Parameters<typeof verifyRegistrationResponse>[0]["response"];
type AuthenticationJSON = Parameters<typeof verifyAuthenticationResponse>[0]["response"];

const rpId = (env: Env) => new URL(appOrigin(env)).hostname;

/**
 * Options for the browser's WebAuthn call: registration when `accountId` is given (a signed-in account adding a
 * passkey), sign-in otherwise (any passkey for this site).
 */
export async function beginPasskey(env: Env, accountId?: string): Promise<unknown> {
	if (accountId) {
		const account = await accountById(env.DB, accountId);
		if (!account) throw new Error("no such account");
		const existing = await env.DB.prepare("SELECT id, transports FROM passkeys WHERE account_id = ?")
			.bind(accountId)
			.all<{ id: string; transports: string | null }>();
		const options = await generateRegistrationOptions({
			rpName: RP_NAME,
			rpID: rpId(env),
			userName: accountId,
			userID: new Uint8Array(new TextEncoder().encode(accountId)),
			attestationType: "none",
			excludeCredentials: existing.results.map((row) => ({ id: row.id, transports: parseTransports(row.transports) })),
			authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
		});
		await storeChallenge(env, options.challenge, accountId);
		return options;
	}
	const options = await generateAuthenticationOptions({ rpID: rpId(env), userVerification: "preferred" });
	await storeChallenge(env, options.challenge, null);
	return options;
}

/** Finishes a ceremony: the account the passkey belongs to (now registered, or signing in), or undefined. */
export async function finishPasskey(env: Env, response: unknown): Promise<string | undefined> {
	const body = response as { id?: string; response?: { clientDataJSON?: string; attestationObject?: string } };
	const challenge = challengeOf(body.response?.clientDataJSON);
	if (!body.id || !challenge) return undefined;
	const stored = await env.DB.prepare(
		"DELETE FROM passkey_challenges WHERE challenge = ? AND expires_at > ? RETURNING account_id",
	)
		.bind(challenge, Date.now())
		.first<{ account_id: string | null }>();
	if (!stored) return undefined;
	const expected = { expectedChallenge: challenge, expectedOrigin: appOrigin(env), expectedRPID: rpId(env) };

	if (body.response?.attestationObject) {
		// Registration needs the signed-in account the challenge was issued to.
		if (!stored.account_id) return undefined;
		const result = await verifyRegistrationResponse({ response: response as RegistrationJSON, ...expected }).catch(
			() => undefined,
		);
		if (!result?.verified) return undefined;
		const { credential } = result.registrationInfo;
		await env.DB.prepare(
			"INSERT INTO passkeys (id, account_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		)
			.bind(
				credential.id,
				stored.account_id,
				credential.publicKey,
				credential.counter,
				JSON.stringify(credential.transports ?? []),
				"Passkey",
				Date.now(),
			)
			.run();
		return stored.account_id;
	}

	const key = await env.DB.prepare("SELECT account_id, public_key, counter, transports FROM passkeys WHERE id = ?")
		.bind(body.id)
		.first<{ account_id: string; public_key: ArrayBuffer; counter: number; transports: string | null }>();
	if (!key) return undefined;
	const result = await verifyAuthenticationResponse({
		response: response as AuthenticationJSON,
		...expected,
		credential: {
			id: body.id,
			publicKey: new Uint8Array(key.public_key),
			counter: key.counter,
			transports: parseTransports(key.transports),
		},
	}).catch(() => undefined);
	if (!result?.verified) return undefined;
	await env.DB.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").bind(result.authenticationInfo.newCounter, body.id).run();
	return key.account_id;
}

async function storeChallenge(env: Env, challenge: string, accountId: string | null): Promise<void> {
	await env.DB.prepare("INSERT INTO passkey_challenges (challenge, account_id, expires_at) VALUES (?, ?, ?)")
		.bind(challenge, accountId, Date.now() + CHALLENGE_TTL_MS)
		.run();
}

/** The challenge inside a base64url clientDataJSON, as the browser echoed it. */
function challengeOf(clientDataJSON: string | undefined): string | undefined {
	if (!clientDataJSON) return undefined;
	try {
		const data = JSON.parse(new TextDecoder().decode(fromBase64url(clientDataJSON))) as { challenge?: string };
		return typeof data.challenge === "string" ? base64url(fromBase64url(data.challenge)) : undefined;
	} catch {
		return undefined;
	}
}

function parseTransports(text: string | null): AuthenticatorTransportFuture[] | undefined {
	if (!text) return undefined;
	try {
		return JSON.parse(text) as AuthenticatorTransportFuture[];
	} catch {
		return undefined;
	}
}

type AuthenticatorTransportFuture = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";
