// Account deletion (spec section 15), following the inventory of every data class: a tombstone first, so recovery jobs
// cannot recreate the account; then the connections, revoked (Composio, Plaid, Stripe; 1Password has none until its
// route is built); then every bot's, the user's and the computer's Durable Object storage and alarms; then R2 objects
// (files and workspace archives; the computer's snapshots go with its destroy); then every D1 row. KnightCode Bots
// keeps no per-account analytics records.
import type { Principal } from "../auth/session.ts";
import { StripeBilling } from "../billing/stripe.ts";
import { ComposioClient } from "../connectors/composio.ts";
import type { Env } from "../env.ts";

/** Tables with an `account_id` column, cleared row by row. */
const ACCOUNT_TABLES = [
	"billing_journal",
	"bot_addresses",
	"bots",
	"channel_links",
	"composio_accounts",
	"email_correspondents",
	"email_health",
	"email_sends",
	"github_installations",
	"groups",
	"handles",
	"identities",
	"link_codes",
	"passkey_challenges",
	"passkeys",
	"routine_triggers",
	"sessions",
	"slack_teams",
] as const;

/** R2 prefixes an account's objects live under. */
export const accountPrefixes = (accountId: string) => [`files/${accountId}/`, `computers/${accountId}/`];

export async function isDeleted(db: D1Database, accountId: string): Promise<boolean> {
	return (await db.prepare("SELECT 1 AS hit FROM deleted_accounts WHERE account_id = ?").bind(accountId).first()) !== null;
}

export interface DeletionReport {
	bots: number;
	r2Objects: number;
	revoked: { composio: number; plaid: number; stripe: number };
}

export async function deleteAccount(env: Env, principal: Principal): Promise<DeletionReport> {
	const accountId = principal.accountId;
	await env.DB.prepare("INSERT OR IGNORE INTO deleted_accounts (account_id, deleted_at) VALUES (?, ?)").bind(accountId, Date.now()).run();

	const registered = async () => (await env.DB.prepare("SELECT id FROM bots WHERE account_id = ?").bind(accountId).all<{ id: string }>()).results.map((row) => row.id);
	const botIds = await registered();
	const groupIds = (await env.DB.prepare("SELECT id FROM groups WHERE account_id = ?").bind(accountId).all<{ id: string }>()).results.map((row) => row.id);
	const emails = (await env.DB.prepare("SELECT email FROM identities WHERE account_id = ? AND email IS NOT NULL").bind(accountId).all<{ email: string }>()).results.map(
		(row) => row.email,
	);

	// First every connection is revoked and the computer destroyed, while their credentials still exist. A failure stops
	// here, before anything is deleted: the tombstone keeps the account frozen and running the deletion again finishes it.
	const revoked = { composio: 0, plaid: 0, stripe: 0 };
	const connections = (await env.DB.prepare("SELECT connected_account_id AS id FROM composio_accounts WHERE account_id = ?").bind(accountId).all<{ id: string }>())
		.results;
	if (connections.length > 0) {
		if (!env.COMPOSIO_API_KEY) throw new Error("Composio connections cannot be revoked without its key; deletion stopped");
		const composio = new ComposioClient({ apiKey: env.COMPOSIO_API_KEY, baseUrl: env.COMPOSIO_BASE_URL });
		for (const connection of connections) {
			if (!(await composio.deleteConnection(connection.id))) throw new Error(`Composio did not revoke ${connection.id}; deletion stopped`);
			await env.DB.prepare("DELETE FROM composio_accounts WHERE connected_account_id = ?").bind(connection.id).run();
			revoked.composio++;
		}
	}
	const user = env.USER.get(env.USER.idFromName(accountId));
	revoked.plaid = await user.revokeBanks();
	const stripeCustomers = [await user.stripeCustomer()];
	for (const botId of botIds) stripeCustomers.push(await env.BOT.get(env.BOT.idFromName(botId)).walletCustomer(principal));
	const customers = [...new Set(stripeCustomers.filter((customer): customer is string => !!customer))];
	if (customers.length > 0) {
		if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe customers cannot be removed without its key; deletion stopped");
		const stripe = new StripeBilling({ secretKey: env.STRIPE_SECRET_KEY, apiUrl: env.STRIPE_API_URL });
		for (const customer of customers) {
			if (!(await stripe.deleteCustomer(customer))) throw new Error(`Stripe did not remove ${customer}; deletion stopped`);
			revoked.stripe++;
		}
	}
	const computer = env.COMPUTER.get(env.COMPUTER.idFromName(accountId));
	await computer.destroyForDeletion();

	// Then every object's storage and alarm. A bot registered meanwhile (an in-flight create) is purged too; new ones
	// cannot be claimed once the tombstone is written.
	const purged = new Set<string>();
	for (let ids = botIds; ids.length > 0; ids = (await registered()).filter((id) => !purged.has(id)))
		for (const botId of ids) {
			await env.BOT.get(env.BOT.idFromName(botId)).purge(principal);
			purged.add(botId);
		}
	await user.purge();
	await computer.purge();

	let r2Objects = 0;
	for (const prefix of accountPrefixes(accountId)) {
		let cursor: string | undefined;
		do {
			const page = await env.FILES.list({ prefix, ...(cursor ? { cursor } : {}) });
			if (page.objects.length > 0) await env.FILES.delete(page.objects.map((object) => object.key));
			r2Objects += page.objects.length;
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
	}

	const statements = [
		...groupIds.flatMap((id) => [
			env.DB.prepare("DELETE FROM group_messages WHERE group_id = ?").bind(id),
			env.DB.prepare("DELETE FROM group_turns WHERE group_id = ?").bind(id),
		]),
		...ACCOUNT_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE account_id = ?`).bind(accountId)),
		...emails.map((email) => env.DB.prepare("DELETE FROM email_codes WHERE email = ?").bind(email)),
		env.DB.prepare("DELETE FROM accounts WHERE id = ?").bind(accountId),
	];
	await env.DB.batch(statements);
	return { bots: purged.size, r2Objects, revoked };
}
