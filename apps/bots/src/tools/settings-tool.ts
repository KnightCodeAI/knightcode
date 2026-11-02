// update_bot (spec section 5): a bot reads its own settings and changes its name, purpose, instructions, model and
// thinking level from chat. Changes that grant powers (computer access on, looser approvals, apps) are refused with a
// pointer to the bot's settings; turning a power off is allowed. While outside text is in play (section 24) nothing
// but powers going down changes. Every change is kept, so it can be undone.
import { defineTool } from "@knightcode/durable";
import { bool, lit, obj, opt, str, union } from "@knightcode/schema";
import { type HostWrite, immediateWrite } from "../bot/host-sql.ts";

export interface BotSettings {
	name: string;
	purpose: string;
	instructions: string;
	instructionsVersion: number;
	computerAccess: boolean;
	approvals: "never" | "auto" | "ask" | "default";
	/** The bot's model, when changed from what it was created with. */
	model?: { provider: string; modelId: string };
	thinking?: string;
}

const DEFAULTS: BotSettings = {
	name: "Bot",
	purpose: "",
	instructions: "",
	instructionsVersion: 1,
	computerAccess: false,
	approvals: "default",
};

/** The bot's settings in its own SQLite, with every earlier version kept for Undo. */
export class SettingsStore {
	readonly #sql: SqlStorage;
	readonly #write: HostWrite;

	constructor(sql: SqlStorage, write: HostWrite = immediateWrite(sql)) {
		this.#sql = sql;
		this.#write = write;
		sql.exec("CREATE TABLE IF NOT EXISTS bot_settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)");
		sql.exec("CREATE TABLE IF NOT EXISTS bot_settings_history (version INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL, at INTEGER NOT NULL)");
	}

	read(): BotSettings {
		const row = this.#sql.exec<{ value: string }>("SELECT value FROM bot_settings WHERE id = 1").toArray()[0];
		return { ...DEFAULTS, ...(row ? (JSON.parse(row.value) as Partial<BotSettings>) : {}) };
	}

	/** Stores `settings`, keeping the settings it replaces in the history. */
	write(settings: BotSettings): Promise<void> {
		const previous = JSON.stringify(this.read());
		return this.#write((sql) => {
			sql.exec("INSERT INTO bot_settings_history (value, at) VALUES (?, ?)", previous, Date.now());
			sql.exec(
				"INSERT INTO bot_settings (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value",
				JSON.stringify(settings),
			);
		});
	}

	/** Restores the settings before the newest change; undefined when there is nothing to undo. */
	undo(): Promise<BotSettings | undefined> {
		return this.#write((sql) => {
			const last = sql
				.exec<{ version: number; value: string }>("SELECT version, value FROM bot_settings_history ORDER BY version DESC LIMIT 1")
				.toArray()[0];
			if (!last) return undefined;
			sql.exec("DELETE FROM bot_settings_history WHERE version = ?", last.version);
			sql.exec(
				"INSERT INTO bot_settings (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value",
				last.value,
			);
			return { ...DEFAULTS, ...(JSON.parse(last.value) as Partial<BotSettings>) };
		});
	}
}

export class WidensPowers extends Error {
	constructor(field: string) {
		super(`Changing ${field} from chat could give the bot more power; the owner changes it in the bot's settings.`);
		this.name = "WidensPowers";
	}
}

export class OutsideText extends Error {
	constructor() {
		super("Text from outside (a web page, an email, another bot) is in this run, so settings are not changed now; ask the owner.");
		this.name = "OutsideText";
	}
}

export type UpdateBotInput = Partial<Pick<BotSettings, "name" | "purpose" | "instructions" | "computerAccess" | "approvals" | "thinking">> & {
	appIds?: string[];
	/** "provider/modelId", one of the user's own models. */
	model?: string;
};

export interface UpdateRules {
	/** True while outside text started or entered the current run. */
	outside?: boolean;
	/** Whether `provider/modelId` is one of the user's models, and the thinking levels it supports. */
	model?: (provider: string, modelId: string) => { thinking: string[] } | undefined;
}

/** Applies a chat-side change: reads without fields, patches the rest, narrows powers, refuses widening. */
export async function updateBot(store: SettingsStore, input: UpdateBotInput, rules: UpdateRules = {}): Promise<BotSettings> {
	const current = store.read();
	const next = { ...current };
	if (input.appIds !== undefined) throw new WidensPowers("connected apps");
	if (input.computerAccess !== undefined) {
		if (input.computerAccess && !current.computerAccess) throw new WidensPowers("computer access");
		next.computerAccess = input.computerAccess;
	}
	if (input.approvals !== undefined) {
		// Only to "ask", the strictest mode, from chat.
		if (input.approvals !== "ask" && input.approvals !== current.approvals) throw new WidensPowers("approvals");
		next.approvals = input.approvals;
	}
	const changesMore =
		input.name !== undefined ||
		input.purpose !== undefined ||
		input.instructions !== undefined ||
		input.model !== undefined ||
		input.thinking !== undefined;
	if (changesMore && rules.outside) throw new OutsideText();
	if (input.name !== undefined) {
		const name = input.name.trim();
		if (!name) throw new Error("A bot needs a name.");
		next.name = name.slice(0, 60);
	}
	if (input.purpose !== undefined) next.purpose = input.purpose.trim().slice(0, 200);
	if (input.instructions !== undefined && input.instructions !== current.instructions) {
		next.instructions = input.instructions.slice(0, 20_000);
		next.instructionsVersion = current.instructionsVersion + 1;
	}
	if (input.model !== undefined) {
		const [provider, ...rest] = input.model.split("/");
		const modelId = rest.join("/");
		const known = provider && modelId ? rules.model?.(provider, modelId) : undefined;
		if (!known) throw new Error(`${input.model} is not one of your models.`);
		next.model = { provider: provider!, modelId };
	}
	if (input.thinking !== undefined) {
		const ref = next.model;
		const supported = ref ? rules.model?.(ref.provider, ref.modelId)?.thinking : undefined;
		if (supported && !supported.includes(input.thinking))
			throw new Error(`This model's thinking levels are ${supported.join(", ")}.`);
		next.thinking = input.thinking;
	}
	if (JSON.stringify(next) !== JSON.stringify(current)) await store.write(next);
	return next;
}

/** `changed` runs after a change, so model changes reach the conversation and powers turned off take their tools. */
export function updateBotTool(
	store: SettingsStore,
	changed?: (settings: BotSettings, before: BotSettings) => Promise<void>,
	rules: () => UpdateRules = () => ({}),
) {
	return defineTool({
		name: "update_bot",
		description:
			"Read (no fields) or change your settings. Powers (computer access, approvals) can only go down here.",
		parameters: obj({
			name: opt(str()),
			purpose: opt(str()),
			instructions: opt(str()),
			model: opt(str()),
			thinking: opt(str()),
			computerAccess: opt(bool()),
			approvals: opt(union([lit("never"), lit("auto"), lit("ask"), lit("default")])),
		}),
		execute: async (args) => {
			try {
				const before = store.read();
				const settings = await updateBot(store, args, rules());
				if (JSON.stringify(settings) !== JSON.stringify(before)) await changed?.(settings, before);
				return { output: [{ type: "text" as const, text: JSON.stringify(settings) }] };
			} catch (error) {
				return { output: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
			}
		},
	});
}
