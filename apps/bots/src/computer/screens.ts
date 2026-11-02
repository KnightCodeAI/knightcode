// Screen capabilities (spec section 7): a bot's screen is reached through a short-lived, revocable URL the Worker
// issues. View and control are separate capabilities; a view connection's input never reaches the computer.
import { base64url, fromBase64url, hmac, hmacVerify, randomToken } from "../auth/util.ts";

export type ScreenMode = "view" | "control";

export interface ScreenGrant {
	accountId: string;
	botId: string;
	mode: ScreenMode;
	expiresAt: number;
	nonce: string;
}

/** Screen URLs last five minutes; an open connection stays open until revoked or closed. */
export const SCREEN_TTL_MS = 5 * 60_000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function issueScreenToken(
	secret: string,
	grant: Omit<ScreenGrant, "expiresAt" | "nonce">,
	now = Date.now(),
): Promise<{ token: string; grant: ScreenGrant }> {
	const full: ScreenGrant = { ...grant, expiresAt: now + SCREEN_TTL_MS, nonce: randomToken(12) };
	const payload = base64url(encoder.encode(JSON.stringify(full)));
	return { token: `${payload}.${await hmac(secret, `screen:${payload}`)}`, grant: full };
}

/** The grant a token carries, if genuine and unexpired. Revocation is the computer object's check. */
export async function verifyScreenToken(secret: string, token: string, now = Date.now()): Promise<ScreenGrant | undefined> {
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra !== undefined) return undefined;
	if (!(await hmacVerify(secret, `screen:${payload}`, signature))) return undefined;
	try {
		const grant = JSON.parse(decoder.decode(fromBase64url(payload))) as ScreenGrant;
		return grant.expiresAt > now ? grant : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Filters a viewer's messages to the VNC server. The RFB handshake (version, security type, ClientInit) passes; after
 * it, only messages that ask for pixels pass (SetPixelFormat 0, SetEncodings 2, FramebufferUpdateRequest 3). Key,
 * pointer and clipboard messages (4, 5, 6) and anything unknown are dropped, so a view connection cannot control.
 */
export class ViewOnlyFilter {
	#handshake = 3;

	allow(message: Uint8Array): boolean {
		if (this.#handshake > 0) {
			this.#handshake--;
			return true;
		}
		const type = message[0];
		return type === 0 || type === 2 || type === 3;
	}
}
