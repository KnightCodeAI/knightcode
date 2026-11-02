// The management tools (spec section 11), used by the Chief of Staff template: list the user's bots and groups, create
// a bot, create and edit groups, organize the sidebar, edit a managed bot's profile, replace its instructions (passing
// the version read), set its model, and schedule a routine for it. A bot manages only bots it created or the user
// assigned to it. Replacing instructions or changing a model always asks the owner, with the full change, in every
// mode. The tools exist only in runs the user started (the bot object narrows the conversation's tools otherwise).
// They cannot delete bots, read or change credentials, or touch other bots.
import { defineTool } from "@knightcode/durable";
import { arr, num, obj, opt, str } from "@knightcode/schema";
import { type GateResult, gateMessage } from "../bot/action-tools.ts";

export const FLEET_TOOL_NAMES = [
	"list_bots",
	"create_bot",
	"manage_group",
	"organize_sidebar",
	"edit_bot_profile",
	"replace_instructions",
	"set_bot_model",
	"schedule_routine",
] as const;

export interface ManagedBot {
	id: string;
	name: string;
	purpose: string;
	managed: boolean;
	/** Only for bots this bot manages. */
	instructions?: string;
	instructionsVersion?: number;
}

export interface FleetDeps {
	listBots(): Promise<ManagedBot[]>;
	listGroups(): Promise<{ id: string; name: string; members: string[] }[]>;
	createBot(input: { name: string; purpose: string; instructions: string }): Promise<{ id: string; name: string }>;
	manageGroup(input: { groupId?: string; name: string; members: string[]; lead?: string; rules?: string }): Promise<{ id: string }>;
	organize(order: string[]): Promise<void>;
	editProfile(botId: string, patch: { name?: string; purpose?: string }): Promise<void>;
	/** Always becomes an approval card showing the full change. */
	proposeInstructions(botId: string, instructions: string, readVersion: number): Promise<GateResult>;
	proposeModel(botId: string, model: string): Promise<GateResult>;
	scheduleRoutine(botId: string, input: { name: string; prompt: string; cron: string; timeZone: string }): Promise<{ id: string }>;
}

const text = (value: unknown, isError = false) => ({
	output: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
	...(isError ? { isError } : {}),
});
const safely = async (work: () => Promise<unknown>) => {
	try {
		return text(await work());
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
};
/** An approval-gated change: the gate's verdict as text, or the refusal (not their bot, stale version) as an error. */
const gated = async (propose: () => Promise<GateResult>) => {
	try {
		const message = gateMessage(await propose());
		return text(message.text, message.isError);
	} catch (error) {
		return text(error instanceof Error ? error.message : String(error), true);
	}
};

export function fleetTools(deps: FleetDeps) {
	return [
		defineTool({
			name: "list_bots",
			description: "List the owner's bots and groups (instructions shown for bots you manage).",
			parameters: obj({}),
			execute: () => safely(async () => ({ bots: await deps.listBots(), groups: await deps.listGroups() })),
		}),
		defineTool({
			name: "create_bot",
			description: "Create a bot you will manage.",
			deferred: true,
			parameters: obj({ name: str(), purpose: str({ description: "One line: what it is for" }), instructions: str() }),
			execute: (args) => safely(() => deps.createBot(args)),
		}),
		defineTool({
			name: "manage_group",
			description: "Create a group chat (2 to 10 bots), or change one by its id.",
			deferred: true,
			parameters: obj({ groupId: opt(str()), name: str(), members: arr(str()), lead: opt(str()), rules: opt(str()) }),
			execute: (args) => safely(() => deps.manageGroup(args)),
		}),
		defineTool({
			name: "organize_sidebar",
			description: "Order the owner's bots in the sidebar (ids, first to last).",
			deferred: true,
			parameters: obj({ order: arr(str()) }),
			execute: (args) => safely(async () => (await deps.organize(args.order), "Done.")),
		}),
		defineTool({
			name: "edit_bot_profile",
			description: "Change a managed bot's name or purpose line.",
			deferred: true,
			parameters: obj({ botId: str(), name: opt(str()), purpose: opt(str()) }),
			execute: (args) => safely(async () => (await deps.editProfile(args.botId, { name: args.name, purpose: args.purpose }), "Done.")),
		}),
		defineTool({
			name: "replace_instructions",
			description: "Replace a managed bot's instructions. Pass the instructionsVersion you read; the owner approves.",
			deferred: true,
			parameters: obj({ botId: str(), instructions: str(), readVersion: num() }),
			execute: (args) => gated(() => deps.proposeInstructions(args.botId, args.instructions, args.readVersion)),
		}),
		defineTool({
			name: "set_bot_model",
			description: "Change a managed bot's model (provider/modelId); the owner approves.",
			deferred: true,
			parameters: obj({ botId: str(), model: str() }),
			execute: (args) => gated(() => deps.proposeModel(args.botId, args.model)),
		}),
		defineTool({
			name: "schedule_routine",
			description: "Schedule a routine for a managed bot (five-field cron, time zone).",
			deferred: true,
			parameters: obj({ botId: str(), name: str(), prompt: str(), cron: str(), timeZone: str() }),
			execute: (args) => safely(() => deps.scheduleRoutine(args.botId, args)),
		}),
	];
}
