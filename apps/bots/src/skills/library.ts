// The skills library (spec section 18), in the user object: skills the user writes or adds are every bot's; a skill a
// bot saves is that bot's alone until the user shares it with all bots. App skills arrive with connectors.
import type { Skill, SkillScope } from "@knightcode/bots-protocol";

export interface SkillInput {
	name: string;
	description: string;
	content: string;
	scope: SkillScope;
	botId?: string;
	appId?: string;
}

type Row = {
	id: string;
	name: string;
	description: string;
	content: string;
	scope: SkillScope;
	bot_id: string | null;
	app_id: string | null;
	updated_at: number;
};

const toSkill = (row: Row): Skill => ({
	id: row.id,
	name: row.name,
	description: row.description,
	content: row.content,
	scope: row.scope,
	...(row.bot_id ? { botId: row.bot_id } : {}),
	...(row.app_id ? { appId: row.app_id } : {}),
	updatedAt: row.updated_at,
});

export function createSkillsTable(sql: SqlStorage): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS skills (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		description TEXT NOT NULL,
		content TEXT NOT NULL,
		scope TEXT NOT NULL,
		bot_id TEXT,
		app_id TEXT,
		updated_at INTEGER NOT NULL
	)`);
}

/** One line, so a description cannot add lines to a prompt. */
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 300);

export function addSkill(sql: SqlStorage, input: SkillInput): Skill {
	if (input.scope === "bot" && !input.botId) throw new Error("a bot skill needs its bot");
	const name = input.name.trim();
	if (!name) throw new Error("a skill needs a name");
	const id = `skill_${crypto.randomUUID()}`;
	sql.exec(
		"INSERT INTO skills (id, name, description, content, scope, bot_id, app_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		id,
		name.slice(0, 80),
		oneLine(input.description),
		input.content.slice(0, 50_000),
		input.scope,
		input.scope === "bot" ? input.botId! : null,
		input.appId ?? null,
		Date.now(),
	);
	return getSkill(sql, id)!;
}

export function getSkill(sql: SqlStorage, id: string): Skill | undefined {
	const row = sql.exec<Row>("SELECT * FROM skills WHERE id = ?", id).toArray()[0];
	return row ? toSkill(row) : undefined;
}

/**
 * Skills by scope. With `botId`, what that bot may use: every skill not scoped to a bot, plus its own bot skills;
 * another bot's skills never appear.
 */
export function listSkills(sql: SqlStorage, filter: { scope?: SkillScope; botId?: string; q?: string } = {}): Skill[] {
	const rows = sql.exec<Row>("SELECT * FROM skills ORDER BY name").toArray().map(toSkill);
	const q = filter.q?.toLowerCase();
	return rows.filter(
		(skill) =>
			(!filter.scope || skill.scope === filter.scope) &&
			(skill.scope !== "bot" || !filter.botId || skill.botId === filter.botId) &&
			(!q || skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q)),
	);
}

export function updateSkill(sql: SqlStorage, id: string, patch: Partial<Pick<SkillInput, "name" | "description" | "content">>): Skill {
	const current = getSkill(sql, id);
	if (!current) throw new Error("no such skill");
	sql.exec(
		"UPDATE skills SET name = ?, description = ?, content = ?, updated_at = ? WHERE id = ?",
		(patch.name ?? current.name).trim().slice(0, 80),
		oneLine(patch.description ?? current.description),
		(patch.content ?? current.content).slice(0, 50_000),
		Date.now(),
		id,
	);
	return getSkill(sql, id)!;
}

/** Shares a bot's skill with all the user's bots. */
export function shareSkill(sql: SqlStorage, id: string): Skill {
	if (!getSkill(sql, id)) throw new Error("no such skill");
	sql.exec("UPDATE skills SET scope = 'user', bot_id = NULL, updated_at = ? WHERE id = ? AND scope = 'bot'", Date.now(), id);
	return getSkill(sql, id)!;
}

export function deleteSkill(sql: SqlStorage, id: string): void {
	sql.exec("DELETE FROM skills WHERE id = ?", id);
}
