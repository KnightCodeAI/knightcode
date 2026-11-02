// update_bot (spec section 5): a bot reads its own settings, and changes the ones that grant nothing (name, purpose,
// instructions) from chat. Anything that widens what it may do (computer access, approvals, apps, model) is refused
// with a pointer to the bot's settings; turning a power off is allowed.
import { bool, lit, obj, opt, str, union } from "@knightcode/schema";
import { defineTool } from "@knightcode/durable";

export interface BotSettings {
	name: string;
	purpose: string;
	instructions: string;
	instructionsVersion: number;
	computerAccess: boolean;
	approvals: "never" | "auto" | "ask" | "default";
}

const DEFAULTS: BotSettings = {
	name: "Bot",
	purpose: "",
	instructions: "",
	instructionsVersion: 1,
	computerAccess: false,
	approvals: "default",
};

/** The bot's settings in its own SQLite. */
export class SettingsStore {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
		sql.exec("CREATE TABLE IF NOT EXISTS bot_settings (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)");
	}

	read(): BotSettings {
		const row = this.#sql.exec<{ value: string }>("SELECT value FROM bot_settings WHERE id = 1").toArray()[0];
		return { ...DEFAULTS, ...(row ? (JSON.parse(row.value) as Partial<BotSettings>) : {}) };
	}

	write(settings: BotSettings): void {
		this.#sql.exec(
			"INSERT INTO bot_settings (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value",
			JSON.stringify(settings),
		);
	}
}

export class WidensPowers extends Error {
	constructor(field: string) {
		super(`Changing ${field} from chat could give the bot more power; the owner changes it in the bot's settings.`);
		this.name = "WidensPowers";
	}
}

export type UpdateBotInput = Partial<Pick<BotSettings, "name" | "purpose" | "instructions" | "computerAccess" | "approvals">> & {
	appIds?: string[];
	model?: unknown;
};

/** Applies a chat-side change: reads without fields, patches the harmless ones, narrows powers, refuses widening. */
export function updateBot(store: SettingsStore, input: UpdateBotInput): BotSettings {
	const current = store.read();
	const next = { ...current };
	if (input.appIds !== undefined) throw new WidensPowers("connected apps");
	if (input.model !== undefined) throw new WidensPowers("the model");
	if (input.computerAccess !== undefined) {
		if (input.computerAccess && !current.computerAccess) throw new WidensPowers("computer access");
		next.computerAccess = input.computerAccess;
	}
	if (input.approvals !== undefined) {
		// Only to "ask", the strictest mode, from chat.
		if (input.approvals !== "ask" && input.approvals !== current.approvals) throw new WidensPowers("approvals");
		next.approvals = input.approvals;
	}
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
	if (JSON.stringify(next) !== JSON.stringify(current)) store.write(next);
	return next;
}

/** `changed` runs after a change, so powers turned off take their tools with them. */
export function updateBotTool(store: SettingsStore, changed?: (settings: BotSettings) => Promise<void>) {
	return defineTool({
		name: "update_bot",
		description:
			"Read your own settings (call with no fields), or change your name, purpose or instructions. Powers (computer access, apps, approvals, model) can only be turned down here.",
		parameters: obj({
			name: opt(str()),
			purpose: opt(str()),
			instructions: opt(str()),
			computerAccess: opt(bool()),
			approvals: opt(union([lit("never"), lit("auto"), lit("ask"), lit("default")])),
		}),
		execute: async (args) => {
			try {
				const before = JSON.stringify(store.read());
				const settings = updateBot(store, args);
				if (JSON.stringify(settings) !== before) await changed?.(settings);
				return { output: [{ type: "text" as const, text: JSON.stringify(settings) }] };
			} catch (error) {
				return { output: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }], isError: true };
			}
		},
	});
}
