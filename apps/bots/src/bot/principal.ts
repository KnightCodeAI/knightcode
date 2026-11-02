// The ownership check every bot RPC and socket frame goes through (spec section 15): a principal may act on a bot only
// when the bot is this object's and its account owns it. Contracts and keys are not authorization.
import type { Principal } from "../auth/session.ts";

export class Unauthorized extends Error {
	constructor() {
		super("unauthorized");
		this.name = "Unauthorized";
	}
}

/** Throws `Unauthorized` unless `principal` owns `bot` and `botId` names it. */
export function assertOwns(bot: { id: string; owner: string | undefined }, principal: Principal | undefined, botId: string): void {
	if (!principal || !bot.owner || principal.accountId !== bot.owner || botId !== bot.id) throw new Unauthorized();
}
