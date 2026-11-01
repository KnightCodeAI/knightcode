// The handle (spec section 4): chosen once, lowercase letters, digits and hyphens, 3 to 20 characters, unique, never a
// reserved word. It appears in every bot's email address.
import { checkName } from "@knightcode/bots-protocol";

/** Claims `handle` for the account. Claiming the handle it already holds is "ok"; any other conflict is "taken". */
export async function claimHandle(
	db: D1Database,
	accountId: string,
	handle: string,
): Promise<"ok" | "taken" | "invalid" | "reserved"> {
	const shape = checkName(handle);
	if (shape !== "ok") return shape;
	const inserted = await db
		.prepare("INSERT INTO handles (handle, account_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
		.bind(handle, accountId, Date.now())
		.run();
	if (inserted.meta.changes === 1) return "ok";
	const owner = await db.prepare("SELECT account_id FROM handles WHERE handle = ?").bind(handle).first<{ account_id: string }>();
	return owner?.account_id === accountId ? "ok" : "taken";
}
