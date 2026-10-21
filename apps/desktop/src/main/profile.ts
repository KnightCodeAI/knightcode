/**
 * The profile in the left rail: the GitHub account of the KnightCode Remote sign-in, which the CLI made
 * (`/remote login`) and keeps in ~/.knightcode/remote-auth.json. The desktop reads the same token.
 */

import { shell } from "electron";
import { login, logout, readToken, relayOrigin, writeToken } from "@knightcode/remote/auth";
import type { Profile } from "../shared/host-protocol.ts";

/** The photo is loaded by the page, whose CSP allows GitHub's avatar host and nothing else. */
const AVATAR_ORIGIN = "https://avatars.githubusercontent.com";

/**
 * A signed-in profile without a login or photo when the relay cannot say whose token it is (offline, or a
 * relay from before it answered /api/me for a token): the sign-in is still there to sign out of.
 */
export async function readProfile(fetchImpl: typeof fetch = fetch): Promise<Profile> {
	const token = await readToken();
	if (!token) return { signedIn: false };
	try {
		const response = await fetchImpl(`${relayOrigin()}/api/me`, {
			headers: { authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) return { signedIn: true };
		const me = (await response.json()) as { login?: unknown; avatarUrl?: unknown };
		return {
			signedIn: true,
			...(typeof me.login === "string" && me.login ? { login: me.login } : {}),
			...(typeof me.avatarUrl === "string" && me.avatarUrl.startsWith(`${AVATAR_ORIGIN}/`)
				? { avatarUrl: me.avatarUrl }
				: {}),
		};
	} catch {
		return { signedIn: true };
	}
}

let pending: AbortController | undefined;

/** The CLI's device flow: GitHub opens in the browser with the code filled in, and this waits for approval. */
export async function signIn(): Promise<Profile> {
	pending?.abort();
	const controller = new AbortController();
	pending = controller;
	try {
		const origin = relayOrigin();
		const token = await login(origin, (_code, uri) => void shell.openExternal(uri), controller.signal);
		await writeToken(token);
		return await readProfile();
	} finally {
		if (pending === controller) pending = undefined;
	}
}

export async function signOut(): Promise<void> {
	pending?.abort();
	await logout(relayOrigin());
}
