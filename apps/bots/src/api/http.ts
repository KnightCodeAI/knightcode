// The API's handler shape and its errors: a handler throws HttpError for a status and code the client acts on.
import type { RouteName, RouteRequest, RouteResponse } from "@knightcode/bots-protocol";
import type { Principal } from "../auth/session.ts";
import type { Env } from "../env.ts";

export type Handler<N extends RouteName> = (env: Env, principal: Principal, request: RouteRequest<N>) => Promise<RouteResponse<N>>;
export type Handlers = { [N in RouteName]?: Handler<N> };

export class HttpError extends Error {
	readonly status: number;
	readonly code: string;

	constructor(status: number, code: string, message?: string) {
		super(message ?? code);
		this.status = status;
		this.code = code;
	}
}

export const notFound = (what: string) => new HttpError(404, "not_found", `no ${what}`);

/** The request's fields without the undefined ones, so a spread never clears a field by accident. */
export function defined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>;
}

/** The signed-in account's user object. */
export const userOf = (env: Env, principal: Principal) => env.USER.get(env.USER.idFromName(principal.accountId));
export const botOf = (env: Env, botId: string) => env.BOT.get(env.BOT.idFromName(botId));

/** A bot id the account owns, or 404 (another account's bot is indistinguishable from none). */
export async function ownedBot(env: Env, principal: Principal, botId: string): Promise<string> {
	const row = await env.DB.prepare("SELECT id FROM bots WHERE id = ? AND account_id = ?").bind(botId, principal.accountId).first<{ id: string }>();
	if (!row) throw notFound(`bot ${botId}`);
	return row.id;
}
