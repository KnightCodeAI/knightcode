// Open work (spec section 6): a short list of things the bot started and has not finished. The bot and the user can
// add, complete or remove items; the open ones are shown to the bot with its memory.
import type { OpenWorkItem } from "@knightcode/bots-protocol";
import { type HostWrite, immediateWrite } from "../bot/host-sql.ts";

export class OpenWork {
	readonly #sql: SqlStorage;
	readonly #write: HostWrite;

	constructor(sql: SqlStorage, write: HostWrite = immediateWrite(sql)) {
		this.#sql = sql;
		this.#write = write;
		sql.exec(
			"CREATE TABLE IF NOT EXISTS open_work (id TEXT PRIMARY KEY, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
		);
	}

	list(): OpenWorkItem[] {
		return this.#sql
			.exec<{ id: string; text: string; done: number; created_at: number }>("SELECT * FROM open_work ORDER BY created_at")
			.toArray()
			.map((row) => ({ id: row.id, text: row.text, done: row.done === 1, createdAt: row.created_at }));
	}

	async add(text: string): Promise<OpenWorkItem> {
		const item = { id: `work_${crypto.randomUUID()}`, text: text.trim(), done: false, createdAt: Date.now() };
		await this.#write((sql) => sql.exec("INSERT INTO open_work (id, text, created_at) VALUES (?, ?, ?)", item.id, item.text, item.createdAt));
		return item;
	}

	complete(id: string): Promise<void> {
		return this.#write((sql) => void sql.exec("UPDATE open_work SET done = 1 WHERE id = ?", id));
	}

	remove(id: string): Promise<void> {
		return this.#write((sql) => void sql.exec("DELETE FROM open_work WHERE id = ?", id));
	}
}
