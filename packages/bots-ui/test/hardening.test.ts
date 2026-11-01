// Findings from the Part 1 review, each pinned by the smallest check that fails without its fix.
import { type ConversationView, createFakeBackend, type Recipe } from "@knightcode/bots-protocol";
import { describe, expect, it } from "vitest";
import { cleanRecipe, defaultSelection } from "../src/bot/RecipePreview.tsx";
import { PANEL_SANDBOX } from "../src/chat/McpAppFrame.tsx";
import { approvalDecisions, confirmSpend } from "../src/chat/spend.ts";
import { stayPinned } from "../src/chat/Transcript.tsx";
import { isChartSpec, tableRows } from "../src/pages/blocks/WidgetBlock.tsx";
import { shownVersion } from "../src/pages/PageView.tsx";
import { ThreadSocket } from "../src/state/socket.ts";

describe("recipe import", () => {
	const recipe: Recipe = {
		profile: { name: "password: hunter22", description: "Help out. api_key=sk-abcdefghijklmnopqrstuvwx" },
		memory: [
			{ content: "Likes tea" },
			{ content: "token: ghp_abcdefghijklmnopqrstuvwxyz123456" },
			{ content: "Works late" },
		],
		skills: [{ name: "deploy secret=hunter22", description: "uses password: hunter22", content: "steps" }],
		routines: [{ name: "check pin: 1234", slug: "check", description: "d", content: "c" }],
		plugins: [{ name: "p", description: "secret: abc123", pluginId: "x" }],
	};

	it("sends no credential-like text in any field, and no memory that was not chosen", () => {
		const selection = { ...defaultSelection(recipe), memory: [0, 1] };
		const sent = JSON.stringify(cleanRecipe(recipe, selection));
		for (const secret of [
			"hunter22",
			"sk-abcdefghijklmnopqrstuvwx",
			"ghp_abcdefghijklmnopqrstuvwxyz123456",
			"1234",
			"abc123",
		])
			expect(sent).not.toContain(secret);
		// Positions stay, so chosen indexes still point at the right entries; unchosen and blocked ones are empty.
		const memory = cleanRecipe(recipe, selection).memory;
		expect(memory.map((m) => m.content)).toEqual(["Likes tea", "", ""]);
	});
});

describe("widget data", () => {
	it("keeps only object rows of a table and refuses a malformed chart", () => {
		expect(tableRows([null, { amount: 1 }, 3, "x"])).toEqual([{ amount: 1 }]);
		expect(tableRows({ amount: 1 })).toEqual([]);
		expect(isChartSpec({ kind: "bar", labels: ["a"], series: [null] })).toBe(false);
		expect(isChartSpec({ kind: "bar", labels: ["a"], series: [{ name: "n", values: ["1"] }] })).toBe(false);
		expect(isChartSpec({ kind: "bar", labels: ["a"], series: [{ name: "n", values: [1] }] })).toBe(true);
	});
});

describe("thread socket", () => {
	it("works again after a close and reopen, as React's development double-run does", async () => {
		const fake = createFakeBackend();
		const socket = new ThreadSocket(
			() => fake.connect(),
			async () => "ticket",
		);
		let view: ConversationView | undefined;
		socket.watch({ botId: "inbox" }, (next) => {
			view = next;
		});
		await fake.clock.runAll();
		socket.close();
		socket.reopen();
		await fake.clock.runAll();
		const before = view?.entries.length ?? 0;
		socket.submit({ botId: "inbox" }, "hello");
		await fake.clock.runAll();
		expect(view?.entries.length).toBe(before + 2);
	});
});

describe("transcript pinning", () => {
	it("follows new entries only when the reader was at the bottom of what was there before", () => {
		// 1000 px of content in a 400 px window: the bottom is at scrollTop 600.
		expect(stayPinned(1000, 600, 400)).toBe(true);
		expect(stayPinned(1000, 570, 400)).toBe(true);
		expect(stayPinned(1000, 0, 400)).toBe(false);
		// Content that fits the window is always at its bottom.
		expect(stayPinned(300, 0, 400)).toBe(true);
	});
});

describe("app panels", () => {
	it("keep their own origin, so messages from them can be checked against the sandbox origin", () => {
		// Without allow-same-origin a sandboxed frame's origin is "null" and no message could ever match.
		expect(PANEL_SANDBOX.split(" ")).toContain("allow-same-origin");
		expect(PANEL_SANDBOX.split(" ")).toContain("allow-scripts");
	});
});

describe("spending approvals", () => {
	const purchase = {
		id: "ap-1",
		botId: "b",
		digest: "d1g3st",
		action: { tool: "buy", title: "Buy", spend: { merchant: "Shop", amount: 12, currency: "USD", item: "Cable" } },
		expiresAt: 0,
		state: "pending",
	} as unknown as Parameters<typeof approvalDecisions>[0];
	const plain = { ...purchase, action: { tool: "post", title: "Post" } } as typeof purchase;

	it("never offers Always allow for a purchase", () => {
		expect(approvalDecisions(purchase)).toEqual(["deny", "allow"]);
		expect(approvalDecisions(plain)).toEqual(["deny", "always", "allow"]);
	});

	it("asks for a passkey over the approval's digest and gives no assertion when the person cancels", async () => {
		let asked: CredentialRequestOptions | undefined;
		const credentials = {
			get: async (options: CredentialRequestOptions) => {
				asked = options;
				return { toJSON: () => ({ id: "cred", type: "public-key" }) };
			},
		};
		expect(await confirmSpend(purchase, credentials)).toEqual({ id: "cred", type: "public-key" });
		expect(new TextDecoder().decode(asked?.publicKey?.challenge as Uint8Array)).toBe("d1g3st");
		expect(asked?.publicKey?.userVerification).toBe("required");
		expect(await confirmSpend(purchase, { get: async () => null })).toBeUndefined();
		expect(
			await confirmSpend(purchase, { get: async () => Promise.reject(new Error("NotAllowedError")) }),
		).toBeUndefined();
	});
});

describe("page history", () => {
	it("shows a previewed version only on the page it came from", () => {
		const preview = { pageId: "a", page: { id: "a", version: 1 } as never };
		expect(shownVersion(preview, "a")).toBe(preview.page);
		expect(shownVersion(preview, "b")).toBeUndefined();
		expect(shownVersion(undefined, "a")).toBeUndefined();
	});
});
