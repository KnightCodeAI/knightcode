// Connection tickets (spec section 15): short-lived, signed and scoped. The desktop app's main process trades its
// session for one, and a WebSocket presents one in its first frame. Stateless: the signature and expiry are the check.
import type { Env } from "../env.ts";
import { type Principal, sessionLive } from "./session.ts";
import { base64url, fromBase64url, hmac, hmacVerify, randomToken } from "./util.ts";

export type TicketScope = "socket" | "screen";

interface TicketBody {
	principal: Principal;
	scope: TicketScope;
	expiresAt: number;
	nonce: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A ticket for `principal`, good for `ttlMs` (a minute by default) and only for `scope`. */
export async function issueTicket(env: Env, principal: Principal, scope: TicketScope, ttlMs = 60_000): Promise<string> {
	const body: TicketBody = { principal, scope, expiresAt: Date.now() + ttlMs, nonce: randomToken(12) };
	const payload = base64url(encoder.encode(JSON.stringify(body)));
	return `${payload}.${await hmac(env.SESSION_SECRET, `ticket:${payload}`)}`;
}

/** The principal a ticket stands for, if it is genuine, unexpired and (when given) for `scope`. */
export async function verifyTicket(env: Env, ticket: string, scope?: TicketScope): Promise<Principal | undefined> {
	const [payload, signature, extra] = ticket.split(".");
	if (!payload || !signature || extra !== undefined) return undefined;
	if (!(await hmacVerify(env.SESSION_SECRET, `ticket:${payload}`, signature))) return undefined;
	let body: TicketBody;
	try {
		body = JSON.parse(decoder.decode(fromBase64url(payload))) as TicketBody;
	} catch {
		return undefined;
	}
	if (!(body.expiresAt > Date.now())) return undefined;
	if (scope && body.scope !== scope) return undefined;
	// A ticket lives no longer than the session it was issued from.
	if (!body.principal.sessionId || !(await sessionLive(env, body.principal.sessionId))) return undefined;
	return body.principal;
}
