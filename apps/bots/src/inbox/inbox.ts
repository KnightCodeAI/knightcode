// The inbox (spec section 20): one list across all of the user's bots of everything waiting on them (approvals,
// questions, takeover requests, results marked for review, failed runs, suggestions) plus tasks. Items link to their
// place in the chat and can be pinned, marked done or marked read. Answering a card in chat clears its item.
import type { InboxItem, InboxKind, Task } from "@knightcode/bots-protocol";

type ItemRow = {
	id: string;
	kind: InboxKind;
	bot_id: string;
	title: string;
	detail: string | null;
	entry_id: string | null;
	approval_id: string | null;
	created_at: number;
	pinned: number;
	done: number;
	read: number;
};

const toItem = (row: ItemRow): InboxItem => ({
	id: row.id,
	kind: row.kind,
	botId: row.bot_id,
	title: row.title,
	...(row.detail ? { detail: row.detail } : {}),
	...(row.entry_id ? { entryId: row.entry_id } : {}),
	...(row.approval_id ? { approvalId: row.approval_id } : {}),
	createdAt: row.created_at,
	pinned: row.pinned === 1,
	done: row.done === 1,
	read: row.read === 1,
});

export class Inbox {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
		sql.exec(`CREATE TABLE IF NOT EXISTS inbox (
			id TEXT PRIMARY KEY,
			kind TEXT NOT NULL,
			bot_id TEXT NOT NULL,
			title TEXT NOT NULL,
			detail TEXT,
			entry_id TEXT,
			approval_id TEXT UNIQUE,
			created_at INTEGER NOT NULL,
			pinned INTEGER NOT NULL DEFAULT 0,
			done INTEGER NOT NULL DEFAULT 0,
			read INTEGER NOT NULL DEFAULT 0
		)`);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_bot TEXT, status TEXT NOT NULL, due INTEGER, source TEXT NOT NULL, created_at INTEGER NOT NULL)",
		);
	}

	/** Adds an item; an approval's item is added once however often its card is announced. */
	add(item: { kind: InboxKind; botId: string; title: string; detail?: string; entryId?: string; approvalId?: string }): InboxItem {
		const id = `inbox_${crypto.randomUUID()}`;
		this.#sql.exec(
			"INSERT OR IGNORE INTO inbox (id, kind, bot_id, title, detail, entry_id, approval_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			id,
			item.kind,
			item.botId,
			item.title.slice(0, 200),
			item.detail?.slice(0, 2_000) ?? null,
			item.entryId ?? null,
			item.approvalId ?? null,
			Date.now(),
		);
		const row = item.approvalId
			? this.#sql.exec<ItemRow>("SELECT * FROM inbox WHERE approval_id = ?", item.approvalId).one()
			: this.#sql.exec<ItemRow>("SELECT * FROM inbox WHERE id = ?", id).one();
		return toItem(row);
	}

	/** Open items, pinned first, newest first; done items only when asked for. */
	list(options: { includeDone?: boolean } = {}): InboxItem[] {
		return this.#sql
			.exec<ItemRow>(`SELECT * FROM inbox ${options.includeDone ? "" : "WHERE done = 0"} ORDER BY pinned DESC, created_at DESC`)
			.toArray()
			.map(toItem);
	}

	/** Answering a card anywhere (chat, inbox, phone) clears its item. */
	resolveApproval(approvalId: string): void {
		this.#sql.exec("UPDATE inbox SET done = 1, read = 1 WHERE approval_id = ?", approvalId);
	}

	mark(id: string, patch: { pinned?: boolean; done?: boolean; read?: boolean }): void {
		const current = this.#sql.exec<ItemRow>("SELECT * FROM inbox WHERE id = ?", id).toArray()[0];
		if (!current) return;
		this.#sql.exec(
			"UPDATE inbox SET pinned = ?, done = ?, read = ? WHERE id = ?",
			patch.pinned === undefined ? current.pinned : patch.pinned ? 1 : 0,
			patch.done === undefined ? current.done : patch.done ? 1 : 0,
			patch.read === undefined ? current.read : patch.read ? 1 : 0,
			id,
		);
	}

	/** Items created since `since` (the catch-up reads them). */
	since(since: number): InboxItem[] {
		return this.#sql.exec<ItemRow>("SELECT * FROM inbox WHERE created_at > ? ORDER BY created_at", since).toArray().map(toItem);
	}

	// ─── Tasks ────────────────────────────────────────────────────────────────

	addTask(task: { title: string; ownerBotId?: string; due?: number; source: Task["source"] }): Task {
		const row = { id: `task_${crypto.randomUUID()}`, created_at: Date.now() };
		this.#sql.exec(
			"INSERT INTO tasks (id, title, owner_bot, status, due, source, created_at) VALUES (?, ?, ?, 'open', ?, ?, ?)",
			row.id,
			task.title.slice(0, 300),
			task.ownerBotId ?? null,
			task.due ?? null,
			task.source,
			row.created_at,
		);
		return this.tasks().find((t) => t.id === row.id)!;
	}

	tasks(): Task[] {
		return this.#sql
			.exec<{ id: string; title: string; owner_bot: string | null; status: Task["status"]; due: number | null; source: Task["source"]; created_at: number }>(
				"SELECT * FROM tasks ORDER BY status, COALESCE(due, created_at)",
			)
			.toArray()
			.map((row) => ({
				id: row.id,
				title: row.title,
				...(row.owner_bot ? { ownerBotId: row.owner_bot } : {}),
				status: row.status,
				...(row.due ? { due: row.due } : {}),
				source: row.source,
				createdAt: row.created_at,
			}));
	}

	setTask(id: string, status: Task["status"]): void {
		this.#sql.exec("UPDATE tasks SET status = ? WHERE id = ?", status, id);
	}
}
