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
 * Parses a viewer's byte stream to the VNC server, whatever the WebSocket framing (messages split across frames, or
 * several in one). The RFB handshake passes: the 12-byte version, the security type (None, or VNC auth with its 16-byte
 * response) and the 1-byte ClientInit. After it only whole pixel requests pass: SetPixelFormat (0, 20 bytes),
 * SetEncodings (2, 4 + 4 per encoding) and FramebufferUpdateRequest (3, 10 bytes). Any other message (keys, pointer,
 * clipboard, unknown) is a violation: the connection is closed, so a view connection cannot control.
 */
export class ViewOnlyFilter {
	#buffer = new Uint8Array(0);
	#stage: "version" | "security" | "auth" | "init" | "messages" = "version";

	/** The complete messages to forward from these bytes, or undefined when the viewer sent something it may not. */
	feed(bytes: Uint8Array): Uint8Array | undefined {
		const joined = new Uint8Array(this.#buffer.length + bytes.length);
		joined.set(this.#buffer, 0);
		joined.set(bytes, this.#buffer.length);
		let offset = 0;
		const passed: Uint8Array[] = [];
		const take = (length: number): boolean => {
			if (joined.length - offset < length) return false;
			passed.push(joined.subarray(offset, offset + length));
			offset += length;
			return true;
		};
		for (;;) {
			if (this.#stage === "version") {
				if (!take(12)) break;
				this.#stage = "security";
			} else if (this.#stage === "security") {
				if (joined.length - offset < 1) break;
				const type = joined[offset];
				if (type !== 1 && type !== 2) return undefined;
				take(1);
				this.#stage = type === 2 ? "auth" : "init";
			} else if (this.#stage === "auth") {
				if (!take(16)) break;
				this.#stage = "init";
			} else if (this.#stage === "init") {
				if (!take(1)) break;
				this.#stage = "messages";
			} else {
				if (joined.length - offset < 1) break;
				const type = joined[offset];
				let length: number;
				if (type === 0) length = 20;
				else if (type === 3) length = 10;
				else if (type === 2) {
					if (joined.length - offset < 4) break;
					length = 4 + 4 * ((joined[offset + 2]! << 8) | joined[offset + 3]!);
				} else return undefined;
				if (!take(length)) break;
			}
		}
		this.#buffer = joined.slice(offset);
		if (this.#buffer.length > 65_536) return undefined;
		const out = new Uint8Array(passed.reduce((total, part) => total + part.length, 0));
		let at = 0;
		for (const part of passed) {
			out.set(part, at);
			at += part.length;
		}
		return out;
	}
}
