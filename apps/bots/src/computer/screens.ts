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

/** A demonstrated step, as the teaching session records it (skills/teach.ts). */
type RecordedEvent = { kind: "click"; x: number; y: number } | { kind: "type"; text: string } | { kind: "key"; keys: string[] };

const KEY_NAMES: Record<number, string> = { 0xff0d: "Enter", 0xff09: "Tab", 0xff1b: "Escape" };

/**
 * The owner's input on a control screen, read from the viewer's RFB stream as teaching steps (spec section 18): a
 * click when a button goes down, typed text gathered until the next click or named key, and Enter, Tab and Escape.
 * Passwords never pass here: they go through Protected input.
 */
export class InputRecorder {
	#buffer = new Uint8Array(0);
	#stage: "version" | "security" | "auth" | "init" | "messages" | "lost" = "version";
	#buttons = 0;
	#text = "";

	feed(bytes: Uint8Array): RecordedEvent[] {
		const events: RecordedEvent[] = [];
		if (this.#stage === "lost") return events;
		const joined = new Uint8Array(this.#buffer.length + bytes.length);
		joined.set(this.#buffer, 0);
		joined.set(bytes, this.#buffer.length);
		let offset = 0;
		const have = (length: number) => joined.length - offset >= length;
		for (;;) {
			if (this.#stage === "version") {
				if (!have(12)) break;
				offset += 12;
				this.#stage = "security";
			} else if (this.#stage === "security") {
				if (!have(1)) break;
				this.#stage = joined[offset] === 2 ? "auth" : "init";
				offset += 1;
			} else if (this.#stage === "auth") {
				if (!have(16)) break;
				offset += 16;
				this.#stage = "init";
			} else if (this.#stage === "init") {
				if (!have(1)) break;
				offset += 1;
				this.#stage = "messages";
			} else {
				if (!have(1)) break;
				const type = joined[offset]!;
				let length: number;
				if (type === 0) length = 20;
				else if (type === 3) length = 10;
				else if (type === 4) length = 8;
				else if (type === 5) length = 6;
				else if (type === 2 || type === 6) {
					if (!have(8)) break;
					length = type === 2 ? 4 + 4 * ((joined[offset + 2]! << 8) | joined[offset + 3]!) : 8 + new DataView(joined.buffer, joined.byteOffset + offset + 4, 4).getUint32(0);
				} else {
					// A message this reader does not know: it cannot tell where the next one starts, so it stops reading.
					this.#stage = "lost";
					break;
				}
				if (!have(length)) break;
				const message = joined.subarray(offset, offset + length);
				offset += length;
				if (type === 5) {
					const buttons = message[1]!;
					if (this.#buttons === 0 && buttons !== 0) events.push(...this.flush(), { kind: "click", x: (message[2]! << 8) | message[3]!, y: (message[4]! << 8) | message[5]! });
					this.#buttons = buttons;
				} else if (type === 4 && message[1] === 1) {
					const keysym = new DataView(message.buffer, message.byteOffset + 4, 4).getUint32(0);
					if (keysym >= 0x20 && keysym <= 0x7e) this.#text += String.fromCharCode(keysym);
					else if (keysym === 0xff08) this.#text = this.#text.slice(0, -1);
					else if (KEY_NAMES[keysym]) events.push(...this.flush(), { kind: "key", keys: [KEY_NAMES[keysym]!] });
				}
			}
		}
		this.#buffer = joined.slice(offset);
		if (this.#buffer.length > 65_536) this.#stage = "lost";
		return events;
	}

	/** Text typed since the last step. */
	flush(): RecordedEvent[] {
		if (!this.#text) return [];
		const text = this.#text;
		this.#text = "";
		return [{ kind: "type", text }];
	}
}
