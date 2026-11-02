// The account's client-facing state that no richer store owns, kept as documents in the user object: the profile's
// preferences, the sidebar (sections and per-bot and per-group flags), reactions, approval settings, home routing,
// Tailscale, shared memory and billing preferences.
import type {
	Account,
	ApprovalSettings,
	FakeSeed,
	HomeRouting,
	Note,
	Section,
	Tailscale,
} from "@knightcode/bots-protocol";
import { readDoc, updateDoc, writeDoc } from "./docs.ts";

export type Reaction = { emoji: string; count: number; mine: boolean };
export type BotFlags = { pinned?: boolean; archived?: boolean; sectionId?: string; unread?: number; needsYou?: boolean; main?: boolean };
export type GroupFlags = { pinned?: boolean; unread?: number; needsYou?: boolean };
export type Sidebar = { sections: Section[]; bots: Record<string, BotFlags>; groups: Record<string, GroupFlags> };
export type Profile = Pick<Account, "timeZone" | "helperModels"> & { name?: string; defaultModel?: Account["defaultModel"] };
export type AutoTopUp = { enabled: boolean; threshold?: number; amount?: number };
export type Receipt = { id: string; at: number; amount: number; fee: number; credited: number };

const SIDEBAR = (): Sidebar => ({ sections: [], bots: {}, groups: {} });
const PROFILE = (): Profile => ({ timeZone: "UTC", helperModels: {} });
const APPROVALS = (): ApprovalSettings => ({ mode: "ask", allow: [], block: [] });
const HOME_ROUTING = (): HomeRouting => ({ enabled: false, route: "desktop", failClosed: true, allowedPrivateHosts: [] });
const TAILSCALE = (): Tailscale => ({ joined: false, hasKey: false });
const SHARED = (): { notes: Note[]; summary: string } => ({ notes: [], summary: "" });

export class AccountState {
	readonly #sql: SqlStorage;

	constructor(sql: SqlStorage) {
		this.#sql = sql;
	}

	profile(): Profile {
		return readDoc(this.#sql, "profile", PROFILE);
	}
	updateProfile(patch: Partial<Profile>): Profile {
		return updateDoc(this.#sql, "profile", PROFILE, (profile) => ({ ...profile, ...patch }));
	}

	sidebar(): Sidebar {
		return readDoc(this.#sql, "sidebar", SIDEBAR);
	}
	setBotFlags(botId: string, flags: BotFlags): void {
		updateDoc(this.#sql, "sidebar", SIDEBAR, (sidebar) => {
			sidebar.bots[botId] = { ...sidebar.bots[botId], ...flags };
			// A bot lives in at most one section.
			if (flags.sectionId !== undefined)
				for (const section of sidebar.sections) {
					section.itemIds = section.itemIds.filter((id) => id !== botId);
					if (section.id === flags.sectionId) section.itemIds.push(botId);
				}
		});
	}
	setGroupFlags(groupId: string, flags: GroupFlags): void {
		updateDoc(this.#sql, "sidebar", SIDEBAR, (sidebar) => {
			sidebar.groups[groupId] = { ...sidebar.groups[groupId], ...flags };
		});
	}
	setSections(sections: Section[]): Section[] {
		updateDoc(this.#sql, "sidebar", SIDEBAR, (sidebar) => {
			sidebar.sections = sections;
			const placed = new Map(sections.flatMap((section) => section.itemIds.map((id) => [id, section.id] as const)));
			for (const [id, flags] of Object.entries(sidebar.bots)) {
				const sectionId = placed.get(id);
				if (sectionId) flags.sectionId = sectionId;
				else delete flags.sectionId;
			}
		});
		return sections;
	}

	reactions(thread: string): Record<string, Reaction[]> {
		return readDoc(this.#sql, `reactions:${thread}`, () => ({}));
	}
	/** Toggles the user's `emoji` on one entry. */
	react(thread: string, entryId: string, emoji: string): Reaction[] {
		let result: Reaction[] = [];
		updateDoc(this.#sql, `reactions:${thread}`, () => ({}) as Record<string, Reaction[]>, (all) => {
			const reactions = (all[entryId] ?? []).map((reaction) => ({ ...reaction }));
			const existing = reactions.find((reaction) => reaction.emoji === emoji);
			if (!existing) reactions.push({ emoji, count: 1, mine: true });
			else if (existing.mine) Object.assign(existing, { count: existing.count - 1, mine: false });
			else Object.assign(existing, { count: existing.count + 1, mine: true });
			result = reactions.filter((reaction) => reaction.count > 0);
			all[entryId] = result;
		});
		return result;
	}

	approvalSettings(): ApprovalSettings {
		return readDoc(this.#sql, "approvals", APPROVALS);
	}
	updateApprovalSettings(patch: Partial<ApprovalSettings>): ApprovalSettings {
		return updateDoc(this.#sql, "approvals", APPROVALS, (settings) => ({ ...settings, ...patch }));
	}

	homeRouting(): HomeRouting {
		return readDoc(this.#sql, "home-routing", HOME_ROUTING);
	}
	updateHomeRouting(patch: Partial<HomeRouting>): HomeRouting {
		return updateDoc(this.#sql, "home-routing", HOME_ROUTING, (routing) => ({ ...routing, ...patch }));
	}

	tailscale(): Tailscale {
		return readDoc(this.#sql, "tailscale", TAILSCALE);
	}
	setTailscale(state: Tailscale): Tailscale {
		return writeDoc(this.#sql, "tailscale", state);
	}

	sharedMemory(): { notes: Note[]; summary: string } {
		return readDoc(this.#sql, "shared-memory", SHARED);
	}
	addSharedNotes(notes: Note[]): void {
		updateDoc(this.#sql, "shared-memory", SHARED, (shared) => {
			const names = new Set(notes.map((note) => note.name));
			shared.notes = [...shared.notes.filter((note) => !names.has(note.name)), ...notes.map((note) => ({ ...note, shared: true }))];
		});
	}

	autoTopUp(): AutoTopUp {
		return readDoc(this.#sql, "auto-top-up", () => ({ enabled: false }));
	}
	setAutoTopUp(value: AutoTopUp): AutoTopUp {
		return writeDoc(this.#sql, "auto-top-up", value);
	}
	receipts(): Receipt[] {
		return readDoc(this.#sql, "receipts", () => [] as Receipt[]);
	}
	addReceipt(receipt: Receipt): void {
		updateDoc(this.#sql, "receipts", () => [] as Receipt[], (receipts) => [receipt, ...receipts].slice(0, 100));
	}

	/** Development seeding: the documents' part of a FakeSeed. */
	importSeed(seed: FakeSeed): void {
		this.updateProfile({
			name: seed.account.name,
			timeZone: seed.account.timeZone,
			helperModels: seed.account.helperModels,
			...(seed.account.defaultModel ? { defaultModel: seed.account.defaultModel } : {}),
		});
		writeDoc(this.#sql, "sidebar", {
			sections: seed.sections,
			bots: Object.fromEntries(
				seed.bots.map((bot) => [
					bot.id,
					{ pinned: bot.pinned, archived: bot.archived, unread: bot.unread, needsYou: bot.needsYou, ...(bot.sectionId ? { sectionId: bot.sectionId } : {}), ...(bot.main ? { main: true } : {}) },
				]),
			),
			groups: Object.fromEntries(seed.groups.map((group) => [group.id, { pinned: group.pinned, unread: group.unread, needsYou: group.needsYou }])),
		} satisfies Sidebar);
		writeDoc(this.#sql, "approvals", seed.approvalSettings);
		writeDoc(this.#sql, "home-routing", seed.homeRouting);
		writeDoc(this.#sql, "tailscale", seed.tailscale);
		writeDoc(this.#sql, "shared-memory", seed.sharedMemory);
		writeDoc(this.#sql, "auto-top-up", seed.billing.autoTopUp);
		writeDoc(this.#sql, "receipts", seed.billing.receipts);
	}
}
