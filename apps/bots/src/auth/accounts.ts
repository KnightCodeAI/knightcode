// Accounts and the identities that sign into them. One workspace per account in the MVP (spec section 15: data is
// keyed by account and workspace so teams can come later without moving it).

export interface AccountRef {
	accountId: string;
	workspaceId: string;
}

/** A new account with its workspace. */
export async function createAccount(db: D1Database, profile: { email?: string; name?: string }): Promise<AccountRef> {
	const accountId = `acc_${crypto.randomUUID()}`;
	const workspaceId = `ws_${crypto.randomUUID()}`;
	await db
		.prepare("INSERT INTO accounts (id, created_at, email, name, workspace_id) VALUES (?, ?, ?, ?, ?)")
		.bind(accountId, Date.now(), profile.email ?? null, profile.name ?? null, workspaceId)
		.run();
	return { accountId, workspaceId };
}

export async function accountById(db: D1Database, accountId: string): Promise<AccountRef | undefined> {
	const row = await db
		.prepare("SELECT id, workspace_id FROM accounts WHERE id = ?")
		.bind(accountId)
		.first<{ id: string; workspace_id: string }>();
	return row ? { accountId: row.id, workspaceId: row.workspace_id } : undefined;
}

/**
 * The account an identity signs into, creating one on first sign-in. A verified email the provider vouches for joins
 * an existing account with that email; an unverified one never does, so no one can claim another person's account by
 * registering their address somewhere that does not check it.
 */
export async function accountForIdentity(
	db: D1Database,
	identity: { provider: string; subject: string; email?: string; emailVerified: boolean; name?: string },
): Promise<AccountRef & { created: boolean }> {
	const known = await db
		.prepare("SELECT account_id FROM identities WHERE provider = ? AND subject = ?")
		.bind(identity.provider, identity.subject)
		.first<{ account_id: string }>();
	const existing = known ? await accountById(db, known.account_id) : undefined;
	if (existing) return { ...existing, created: false };
	const email = identity.email?.toLowerCase();
	const byEmail =
		email && identity.emailVerified
			? await db.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first<{ id: string }>()
			: null;
	const account = byEmail
		? ((await accountById(db, byEmail.id)) ?? (await createAccount(db, { email, name: identity.name })))
		: await createAccount(db, { email: identity.emailVerified ? email : undefined, name: identity.name });
	await db
		.prepare("INSERT INTO identities (provider, subject, account_id, email, created_at) VALUES (?, ?, ?, ?, ?)")
		.bind(identity.provider, identity.subject, account.accountId, email ?? null, Date.now())
		.run();
	return { ...account, created: !byEmail };
}

/** The account's handle, if it has chosen one. */
export async function handleOf(db: D1Database, accountId: string): Promise<string | undefined> {
	const row = await db.prepare("SELECT handle FROM handles WHERE account_id = ?").bind(accountId).first<{ handle: string }>();
	return row?.handle;
}
