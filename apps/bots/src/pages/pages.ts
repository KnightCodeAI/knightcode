// Pages (spec section 19): documents and live dashboards bots build, stored as structured blocks (JSON), never as
// bot-written HTML or script, and rendered by the UI's own components. A bot edits only pages it created; the user edits
// any page. Every change is a new version. Buttons run a routine or a connector action as a user-started run.
import { type Page, type PageBlock, PageBlockSchema, type PageSummary, parse, ProtocolError } from "@knightcode/bots-protocol";
import { Type } from "typebox";

export class PageRefused extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "PageRefused";
	}
}

/** Markup or script anywhere in a block's text: refused, though the UI would render it as plain text anyway. */
const MARKUP = /<\s*\/?\s*(script|iframe|object|embed|style|link|meta|img|svg|a|div|span|form|input|button|html|body|base)\b|\bon[a-z]+\s*=|javascript:|data:text\/html/i;

function scan(value: unknown, path: string): void {
	if (typeof value === "string") {
		if (MARKUP.test(value)) throw new PageRefused(`${path} carries HTML or script; pages hold Markdown text and structured blocks only`);
		return;
	}
	if (Array.isArray(value)) value.forEach((item, index) => scan(item, `${path}/${index}`));
	else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) scan(item, `${path}/${key}`);
}

const BlocksSchema = Type.Array(PageBlockSchema, { maxItems: 500 });

/** The blocks, checked against the block schema (no other block types or fields) and free of markup. */
export function validateBlocks(blocks: unknown): PageBlock[] {
	let parsed: PageBlock[];
	try {
		parsed = parse(BlocksSchema, blocks) as PageBlock[];
	} catch (error) {
		throw new PageRefused(error instanceof ProtocolError ? `${error.path || "blocks"}: ${error.message}` : "not page blocks");
	}
	scan(parsed, "blocks");
	return parsed;
}

/** Who is editing: the user (any page) or a bot (its own pages only). */
export type Editor = { kind: "user" } | { kind: "bot"; botId: string };

type Row = { id: string; title: string; owner_bot: string; pinned: number; version: number; blocks: string; updated_at: number };

const toPage = (row: Row): Page => ({
	id: row.id,
	title: row.title,
	ownerBotId: row.owner_bot,
	pinned: row.pinned === 1,
	version: row.version,
	blocks: JSON.parse(row.blocks) as PageBlock[],
	updatedAt: row.updated_at,
});

export class PageStore {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
		sql.exec(
			"CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_bot TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL, blocks TEXT NOT NULL, updated_at INTEGER NOT NULL)",
		);
		sql.exec(
			"CREATE TABLE IF NOT EXISTS page_versions (page_id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, blocks TEXT NOT NULL, author TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (page_id, version))",
		);
	}

	create(ownerBotId: string, title: string, blocks: unknown, author: string): Page {
		const checked = validateBlocks(blocks);
		const id = `page_${crypto.randomUUID()}`;
		const now = Date.now();
		this.#sql.exec(
			"INSERT INTO pages (id, title, owner_bot, version, blocks, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
			id,
			title.trim().slice(0, 200) || "Untitled",
			ownerBotId,
			JSON.stringify(checked),
			now,
		);
		this.#sql.exec("INSERT INTO page_versions (page_id, version, title, blocks, author, at) VALUES (?, 1, ?, ?, ?, ?)", id, title, JSON.stringify(checked), author, now);
		return this.get(id)!;
	}

	get(id: string): Page | undefined {
		const row = this.#sql.exec<Row>("SELECT * FROM pages WHERE id = ?", id).toArray()[0];
		return row ? toPage(row) : undefined;
	}

	list(query = ""): PageSummary[] {
		const q = query.toLowerCase();
		return this.#sql
			.exec<Row>("SELECT * FROM pages ORDER BY pinned DESC, updated_at DESC")
			.toArray()
			.filter((row) => !q || row.title.toLowerCase().includes(q) || row.blocks.toLowerCase().includes(q))
			.map((row) => ({ id: row.id, title: row.title, ownerBotId: row.owner_bot, pinned: row.pinned === 1, updatedAt: row.updated_at }));
	}

	/** A new version of the page; refused for a bot editing another bot's page, and for a stale base version. */
	update(id: string, editor: Editor, change: { title?: string; blocks?: unknown; baseVersion?: number }): Page {
		const current = this.get(id);
		if (!current) throw new PageRefused("no such page");
		if (editor.kind === "bot" && editor.botId !== current.ownerBotId) throw new PageRefused("a bot edits only pages it created");
		if (change.baseVersion !== undefined && change.baseVersion !== current.version) throw new PageRefused("the page changed since it was read");
		const blocks = change.blocks === undefined ? current.blocks : validateBlocks(change.blocks);
		const title = change.title?.trim().slice(0, 200) || current.title;
		const version = current.version + 1;
		const now = Date.now();
		this.#sql.exec("UPDATE pages SET title = ?, version = ?, blocks = ?, updated_at = ? WHERE id = ?", title, version, JSON.stringify(blocks), now, id);
		this.#sql.exec(
			"INSERT INTO page_versions (page_id, version, title, blocks, author, at) VALUES (?, ?, ?, ?, ?, ?)",
			id,
			version,
			title,
			JSON.stringify(blocks),
			editor.kind === "user" ? "user" : editor.botId,
			now,
		);
		return this.get(id)!;
	}

	/** One stored version of the page, whole. */
	version(id: string, version: number): Page | undefined {
		const current = this.get(id);
		const row = this.#sql
			.exec<{ title: string; blocks: string; at: number }>("SELECT title, blocks, at FROM page_versions WHERE page_id = ? AND version = ?", id, version)
			.toArray()[0];
		if (!current || !row) return undefined;
		return { ...current, title: row.title, blocks: JSON.parse(row.blocks) as Page["blocks"], version, updatedAt: row.at };
	}

	/** Development seeding: a page with its own id, version and time. */
	import(page: Page): void {
		const blocks = JSON.stringify(validateBlocks(page.blocks));
		this.#sql.exec(
			"INSERT OR REPLACE INTO pages (id, title, owner_bot, pinned, version, blocks, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
			page.id,
			page.title,
			page.ownerBotId,
			page.pinned ? 1 : 0,
			page.version,
			blocks,
			page.updatedAt,
		);
		this.#sql.exec("INSERT OR REPLACE INTO page_versions (page_id, version, title, blocks, author, at) VALUES (?, ?, ?, ?, ?, ?)", page.id, page.version, page.title, blocks, page.ownerBotId, page.updatedAt);
	}

	versions(id: string): { version: number; author: string; at: number }[] {
		return this.#sql
			.exec<{ version: number; author: string; at: number }>("SELECT version, author, at FROM page_versions WHERE page_id = ? ORDER BY version DESC", id)
			.toArray();
	}

	pin(id: string, pinned: boolean): void {
		this.#sql.exec("UPDATE pages SET pinned = ? WHERE id = ?", pinned ? 1 : 0, id);
	}

	delete(id: string, editor: Editor): void {
		const current = this.get(id);
		if (!current) return;
		if (editor.kind === "bot" && editor.botId !== current.ownerBotId) throw new PageRefused("a bot edits only pages it created");
		this.#sql.exec("DELETE FROM pages WHERE id = ?", id);
		this.#sql.exec("DELETE FROM page_versions WHERE page_id = ?", id);
	}

	/** Markdown export: text as is, tables as Markdown tables, charts and widgets as their data. */
	markdown(id: string): string {
		const page = this.get(id);
		if (!page) throw new PageRefused("no such page");
		const lines = [`# ${page.title}`, ""];
		for (const block of page.blocks) {
			if (block.type === "text") lines.push(block.text, "");
			else if (block.type === "table")
				lines.push(`| ${block.columns.join(" | ")} |`, `| ${block.columns.map(() => "---").join(" | ")} |`, ...block.rows.map((row) => `| ${row.map((cell) => String(cell ?? "")).join(" | ")} |`), "");
			else if (block.type === "chart") lines.push(`_${block.spec.title ?? "Chart"}_: ${block.spec.series.map((s) => `${s.name} ${s.values.join(", ")}`).join("; ")}`, "");
			else if (block.type === "widget") lines.push(`**${block.title}**: ${JSON.stringify(block.data ?? null)}`, "");
			else if (block.type === "image" || block.type === "file") lines.push(`[${block.type === "image" ? block.alt : block.name}](file:${block.fileId})`, "");
		}
		return lines.join("\n");
	}
}
