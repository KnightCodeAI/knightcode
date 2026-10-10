import type { Credential } from "@knightcode/ai";
import { stripTerminalSequences, type TUI, visibleWidth } from "@knightcode/tui";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { createEventBus } from "../src/core/event-bus.ts";
import { createExtensionRuntime, loadExtensionFromFactory } from "../src/core/extensions/loader.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../src/core/extensions/types.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { builtInExtensions } from "../src/extensions/index.ts";
import usageExtension from "../src/extensions/usage/index.ts";
import { UsagePanel } from "../src/extensions/usage/panel.ts";
import type { UsageAccount, UsageRow } from "../src/extensions/usage/providers.ts";
import { initTheme, theme, type Theme } from "../src/modes/interactive/theme/theme.ts";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const claude: UsageAccount = { providerId: "anthropic", displayName: "Anthropic", supported: true };
const codex: UsageAccount = { providerId: "openai-codex", displayName: "OpenAI Codex (legacy)", supported: true };
const grok: UsageAccount = { providerId: "xai", displayName: "xAI", supported: true };
const unsupported: UsageAccount = {
	providerId: "openai",
	displayName: "OpenAI",
	supported: false,
	unsupportedReason: "Usage lookup is not available for this ChatGPT sign-in yet.",
};
const codexBody = {
	plan_type: "pro",
	rate_limit: {
		primary_window: { used_percent: 32, limit_window_seconds: 18000, reset_at: NOW / 1000 + 3600 },
		secondary_window: null,
	},
};
const claudeBody = {
	five_hour: { utilization: 40, resets_at: new Date(NOW + 3600000).toISOString() },
	extra_usage: { is_enabled: true, utilization: 40, monthly_limit: 100, used_credits: 40 },
};

const grokBody = {
	config: {
		creditUsagePercent: 37.5,
		currentPeriod: { type: "USAGE_PERIOD_TYPE_WEEKLY", end: new Date(NOW + 3600000).toISOString() },
		isUnifiedBillingUser: true,
		productUsage: [
			{ product: "GrokBuild", usagePercent: 20 },
			{ product: "Api", usagePercent: 5 },
		],
	},
};

function responseFor(url: string): Response {
	return Response.json(url.includes("anthropic") ? claudeBody : url.includes("grok.com") ? grokBody : codexBody);
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function credentials(): Record<string, Credential> {
	const oauth = { type: "oauth" as const, access: "SECRET-TOKEN", refresh: "refresh", expires: Date.now() + 3600000 };
	const token = `header.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-id" } })).toString("base64url")}.signature`;
	const grokToken = `header.${Buffer.from(JSON.stringify({ sub: "subject-id", marker: "SECRET-TOKEN" })).toString("base64url")}.signature`;
	return {
		anthropic: oauth,
		"openai-codex": { ...oauth, access: token },
		xai: { ...oauth, access: grokToken },
		openai: oauth,
	};
}

const cleanups: Array<() => void> = [];
beforeAll(() => initTheme("dark"));
beforeEach(() => {
	vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

async function harness(options: { mode?: string; active?: string; credentials?: Record<string, Credential> } = {}) {
	type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
	const commands = new Map<string, Command>();
	const handlers = new Map<string, () => void>();
	const pi = {
		on: (event: string, handler: () => void) => handlers.set(event, handler),
		registerCommand: (name: string, command: Command) => commands.set(name, command),
	} as unknown as ExtensionAPI;
	usageExtension(pi);
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(options.credentials ?? credentials()),
		modelsPath: null,
	});
	const registry = new ModelRegistry(runtime);
	const panels: UsagePanel[] = [];
	const requestRender = vi.fn();
	const notify = vi.fn();
	const done = vi.fn();
	const custom = vi.fn(
		(factory: (tui: TUI, theme: Theme, kb: KeybindingsManager, done: () => void) => UsagePanel) =>
			new Promise<void>((resolve) => {
				const finish = () => {
					done();
					resolve();
				};
				panels.push(
					factory(
						{ requestRender } as unknown as TUI,
						theme,
						new KeybindingsManager({ "tui.select.cancel": "ctrl+q" }),
						finish,
					),
				);
			}),
	);
	const ctx = {
		mode: options.mode ?? "tui",
		model: options.active ? { provider: options.active } : undefined,
		modelRegistry: registry,
		ui: { custom, notify },
	} as unknown as ExtensionCommandContext;
	cleanups.push(() => handlers.get("session_shutdown")?.());
	return {
		ctx,
		registry,
		panels,
		requestRender,
		notify,
		custom,
		done,
		open: () => commands.get("usage")!.handler("", ctx),
		shutdown: () => handlers.get("session_shutdown")!(),
		text: () => panels.at(-1)!.render(120).map(stripTerminalSequences).join("\n"),
		close: () => panels.at(-1)!.handleInput("\x11"),
	};
}

function render(rows: UsageRow[], width = 80) {
	const panel = new UsagePanel(theme, new KeybindingsManager({ "tui.select.cancel": "ctrl+q" }), () => {});
	panel.setRows(rows);
	return panel.render(width).map(stripTerminalSequences).join("\n");
}

function ok(account: UsageAccount, remaining: number | null = 68, resetsAt: number | null = NOW + 3600000): UsageRow {
	return {
		account,
		state: "ok",
		usage: {
			providerId: account.providerId,
			checkedAt: NOW,
			windows: [{ label: "5-hour", remainingPercent: remaining, resetsAt }],
			...(account === claude
				? { extraUsage: { enabled: true, usedPercent: 40 } as const }
				: account.providerId === "openai-codex"
					? { planName: "pro" }
					: {}),
		},
	};
}

describe("usage panel", () => {
	it("insets content and separates headings, quota rows, and timestamps", () => {
		const row = ok(grok, 35);
		if (row.state !== "ok") throw new Error("expected ok");
		row.usage.windows = [
			{ label: "Weekly", remainingPercent: 35, resetsAt: NOW + 3600000 },
			{ label: "Weekly (Grok Build)", remainingPercent: 0, resetsAt: NOW + 3600000 },
		];
		const lines = render([row, ok(codex)]).split("\n");
		const title = lines.findIndex((line) => line.includes("Subscription usage"));
		const provider = lines.indexOf("  xAI");
		const weekly = lines.findIndex((line) => line.includes("35% left"));
		const build = lines.findIndex((line) => line.includes("0% left"));
		const checked = lines.findIndex((line) => line.includes("Checked"));
		const close = lines.findIndex((line) => line.includes("ctrl+q close"));
		expect(lines[title]).toBe("  Subscription usage");
		expect(lines[title - 1]).toBe("");
		expect(provider).toBeGreaterThan(title);
		expect(lines[provider + 1]).toBe("");
		expect(lines[weekly]).toMatch(/^ {4}Weekly/);
		expect(lines[weekly + 1]).toBe("");
		expect(build).toBe(weekly + 2);
		expect(lines[checked - 1]).toBe("");
		expect(lines[checked]).toMatch(/^ {4}Checked/);
		expect(lines[checked + 1]).toBe("");
		expect(lines[checked + 2]).toBe("  OpenAI Codex (legacy) · pro");
		expect(lines[close - 1]).toBe("");
		expect(lines[close + 1]).toBe("");
	});

	it.each([40, 80])("wraps notices within the padded body at %s columns", (width) => {
		const lines = render([{ account: unsupported, state: "unsupported" }, ok(claude)], width).split("\n");
		const provider = lines.indexOf("  OpenAI");
		expect(provider).toBeGreaterThan(0);
		expect(lines[provider + 1]).toBe("");
		const details: string[] = [];
		for (const line of lines.slice(provider + 2)) {
			if (!line.trim()) break;
			expect(line).toMatch(/^ {4}\S/);
			expect(visibleWidth(line)).toBeLessThanOrEqual(width - 2);
			details.push(line.trim());
		}
		expect(details.join(" ")).toBe(unsupported.unsupportedReason);
		expect(lines.map((line) => line.trim()).join(" ")).toContain(
			"KnightCode draws from extra usage, not these plan limits.",
		);
	});

	it("aligns quota columns and keeps complete reset times in a padded 80-column panel", () => {
		const row = ok(grok);
		if (row.state !== "ok") throw new Error("expected ok");
		row.usage.windows = [
			{ label: "Weekly", remainingPercent: 100, resetsAt: NOW + 2 * 86400000 + 23 * 3600000 },
			{ label: "Weekly (Grok Build)", remainingPercent: 0, resetsAt: NOW + 2 * 86400000 + 23 * 3600000 },
		];
		const lines = render([row])
			.split("\n")
			.filter((line) => line.includes("% left"));
		expect(lines).toHaveLength(2);
		for (const line of lines) {
			expect(line).toMatch(/^ {4}Weekly/);
			expect(line).toContain("resets in 2d 23h");
			expect(visibleWidth(line)).toBeLessThanOrEqual(78);
		}
		expect(lines[0].search(/\d+% left/)).toBe(lines[1].search(/\d+% left/));
	});

	// PR #316: fractional percentages must not push the reset text onto another line.
	it.each([66, 77, 78, 80])("keeps fractional quota and reset text together at %s columns", (width) => {
		const row = ok(grok, 62.5);
		if (row.state !== "ok") throw new Error("expected ok");
		row.usage.windows[0].label = "Weekly";
		const lines = render([row], width).split("\n");
		const quota = lines.find((line) => line.includes("62.5% left"));
		expect(quota).toBeDefined();
		expect(quota).toMatch(/[█░]/);
		expect(quota).toContain("62.5% left · resets in 1h 0m");
		for (const line of lines.slice(1, -1)) expect(visibleWidth(line)).toBeLessThanOrEqual(width - 2);
	});

	it.each([40, 80])("fits all states in %s columns and never hides quota behind color", (width) => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const rows: UsageRow[] = [
			{ account: claude, state: "loading" },
			ok(codex),
			ok(claude, null, null),
			ok(codex, 0, NOW - 1000),
			{ account: claude, state: "error", failure: { kind: "permission", message: "This sign-in cannot read usage." } },
			{ account: unsupported, state: "unsupported" },
		];
		const text = render(rows, width);
		for (const line of text.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		expect(text).toContain("Checking…");
		expect(text).toContain("68% left");
		expect(text).toContain("unavailable");
		expect(text).toContain("reset passed");
		expect(text).toContain("cannot read usage");
		expect(text).toContain("OpenAI");
		expect(text).toContain("Usage lookup");
		for (const line of text.split("\n").filter((line) => line.includes("5-hour")))
			expect(line).toMatch(/\d+(?:\.\d+)?% left|unavailable/);
	});

	it("leads Claude with extra usage and caveat, and keeps number before reset text", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const text = render([ok(claude)], 100);
		expect(text).toContain("Extra usage: 40% of monthly limit used");
		expect(text).toContain("KnightCode draws from extra usage, not these plan limits.");
		expect(text.indexOf("Extra usage")).toBeLessThan(text.indexOf("5-hour"));
		expect(text).toContain("68% left · resets in 1h 0m");
		expect(text).toContain("Checked");
		expect(text).toContain("ctrl+q close");
		expect(render([ok(codex)])).toContain("OpenAI Codex (legacy) · pro");
	});

	it.each([
		[{ enabled: false }, "Extra usage: off"],
		[{ enabled: true, unlimited: true }, "Extra usage: unlimited"],
		[{ enabled: true, usedPercent: null }, "Extra usage: unavailable"],
		[undefined, "Extra usage: unavailable"],
	] as const)("shows extra usage state without inventing allowance", (extra, expected) => {
		const row = ok(claude);
		if (row.state !== "ok") throw new Error("expected ok");
		row.usage.extraUsage = extra;
		expect(render([row])).toContain(expected);
	});

	it("marks a passed reset instead of claiming full allowance", () => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		const text = render([ok(codex, 100, NOW - 1)], 100);
		expect(text).toContain("reset passed · run /usage again");
		expect(text).not.toContain("100% left");
		expect(render([ok(codex, 68, null)])).not.toContain("resets in");
	});

	it.each([
		[30000, "under 1m"],
		[120000, "2m"],
		[7200000 + 180000, "2h 3m"],
		[2 * 86400000 + 3600000, "2d 1h"],
	])("formats reset duration %s", (duration, expected) => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		expect(render([ok(codex, 68, NOW + Number(duration))], 120)).toContain(`resets in ${expected}`);
	});

	it("shows distinct empty, initial loading, and sign-in-store failure states", () => {
		const panel = new UsagePanel(theme, new KeybindingsManager(), () => {});
		expect(panel.render(120).join("\n")).toContain("Checking");
		panel.setRows([]);
		expect(panel.render(120).join("\n")).toContain(
			"No subscription sign-ins. Run /login to connect Claude, Codex or Grok.",
		);
		panel.setReadError();
		expect(panel.render(120).join("\n")).toContain("Could not read sign-ins.");
	});

	it.each([40, 80])("renders the Grok pool and product shares at %s columns without the Claude caveat", (width) => {
		const row: UsageRow = {
			account: grok,
			state: "ok",
			usage: {
				providerId: "xai",
				checkedAt: NOW,
				windows: [
					{ label: "Weekly", remainingPercent: 62.5, resetsAt: NOW + 3600000 },
					{ label: "Weekly (Grok Build)", remainingPercent: 80, resetsAt: NOW + 3600000 },
					{ label: "Weekly (API)", remainingPercent: 95, resetsAt: NOW + 3600000 },
				],
			},
		};
		const text = render([row], width);
		for (const line of text.split("\n")) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		expect(text).toContain("62.5% left");
		expect(text).toContain("80% left");
		expect(text).toContain("95% left");
		expect(text).toContain("Checked");
		expect(text).not.toContain("extra usage");
	});

	it.each([grok, codex, claude])(
		"shows a muted missing-windows notice for $providerId instead of an empty quota section",
		(account) => {
			const row = ok(account);
			if (row.state !== "ok") throw new Error("expected ok");
			row.usage.windows = [];
			const panel = new UsagePanel(theme, new KeybindingsManager(), () => {});
			panel.setRows([row]);
			const text = panel.render(80).join("\n");
			expect(text).toContain(theme.fg("muted", "No usage windows reported."));
			expect(text).toContain("Checked");
		},
	);

	it("bounds ANSI/wide names and omits the bar below eight columns", () => {
		const row = ok({ ...codex, displayName: "模型".repeat(30) });
		for (const width of [0, 1, 20, 40, 51, 80]) {
			const panel = new UsagePanel(theme, new KeybindingsManager(), () => {});
			panel.setRows([row]);
			for (const line of panel.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
			if (width < 52) expect(panel.render(width).join("\n")).not.toMatch(/[█░]/);
		}
	});
});

describe("/usage command lifecycle", () => {
	it("registers as a built-in command through the real extension loader", async () => {
		const builtin = builtInExtensions.find((entry) => entry.name === "usage");
		if (!builtin || typeof builtin === "function") throw new Error("missing built-in usage extension");
		expect(builtin.builtin).toBe(true);
		const extension = await loadExtensionFromFactory(
			builtin.factory,
			process.cwd(),
			createEventBus(),
			createExtensionRuntime(),
			"builtin:usage",
		);
		expect(extension.commands.has("usage")).toBe(true);
	});

	it("uses only the configured close key and aborts on close", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json(codexBody)),
		);
		const h = await harness();
		const operation = h.open();
		h.panels[0].handleInput("\x1b");
		expect(h.done).not.toHaveBeenCalled();
		h.close();
		h.close();
		await operation;
		expect(h.done).toHaveBeenCalledTimes(1);
	});

	it.each(["print", "rpc", "json", "engine"])(
		"only notifies in %s mode, without requests or custom UI",
		async (mode) => {
			const fetchMock = vi.fn();
			vi.stubGlobal("fetch", fetchMock);
			const h = await harness({ mode });
			await h.open();
			expect(h.notify).toHaveBeenCalledExactlyOnceWith("/usage needs the interactive terminal.", "warning");
			expect(h.custom).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);

	it("lists all three accounts with no model, lists unsupported ChatGPT, and uses an inline panel", async () => {
		const fetchMock = vi.fn(async (url: string) => responseFor(url));
		vi.stubGlobal("fetch", fetchMock);
		const h = await harness();
		const operation = h.open();
		await vi.waitFor(() => expect(h.text()).toContain("68% left"));
		expect(h.text()).toContain("60% left");
		expect(h.text()).toContain("62.5% left");
		expect(h.text()).toContain("ChatGPT sign-in yet");
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(h.custom.mock.calls[0]).toHaveLength(1);
		h.close();
		await operation;
	});

	it.each(["openai-codex", "xai"])(
		"orders active %s first and never sends unsupported account auth",
		async (active) => {
			const fetchMock = vi.fn(async (url: string) => responseFor(url));
			vi.stubGlobal("fetch", fetchMock);
			const h = await harness({ active });
			const operation = h.open();
			await vi.waitFor(() => expect(h.text()).toContain("68% left"));
			expect(h.text().indexOf(active === "xai" ? "xAI" : "OpenAI Codex")).toBeLessThan(h.text().indexOf("Anthropic"));
			expect(fetchMock).toHaveBeenCalledTimes(3);
			h.close();
			await operation;
		},
	);

	it("isolates an HTTP error from the other provider's delayed result", async () => {
		const pending = deferred<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.includes("anthropic")
					? Promise.resolve(new Response("RAW-RESPONSE SECRET-TOKEN", { status: 500 }))
					: url.includes("grok.com")
						? Promise.resolve(responseFor(url))
						: pending.promise,
			),
		);
		const h = await harness();
		const operation = h.open();
		await vi.waitFor(() => expect(h.text()).toContain("Usage service returned HTTP 500."));
		pending.resolve(Response.json(codexBody));
		await vi.waitFor(() => expect(h.text()).toContain("68% left"));
		expect(h.text()).toContain("HTTP 500");
		expect(h.text()).not.toContain("SECRET-TOKEN");
		h.close();
		await operation;
	});

	it("does not let a Grok 500 hold up Claude or delayed Codex results", async () => {
		const pending = deferred<Response>();
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.includes("grok.com")
					? Promise.resolve(new Response("SECRET-TOKEN RAW-RESPONSE", { status: 500 }))
					: url.includes("anthropic")
						? Promise.resolve(responseFor(url))
						: pending.promise,
			),
		);
		const h = await harness();
		const operation = h.open();
		await vi.waitFor(() => {
			expect(h.text()).toContain("HTTP 500");
			expect(h.text()).toContain("60% left");
		});
		pending.resolve(Response.json(codexBody));
		await vi.waitFor(() => expect(h.text()).toContain("68% left"));
		expect(h.text()).not.toContain("SECRET-TOKEN");
		h.close();
		await operation;
	});

	it("does not wait for a hung Claude lookup before rendering Codex", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn((url: string) =>
				url.includes("anthropic") ? new Promise<Response>(() => {}) : Promise.resolve(responseFor(url)),
			),
		);
		const h = await harness();
		const operation = h.open();
		await vi.waitFor(() => expect(h.text()).toContain("68% left"));
		expect(h.text()).toContain("Checking…");
		h.close();
		await operation;
	});

	it.each(["openai-codex", "xai"])("honors %s cooldowns on reopening and retries after expiry", async (provider) => {
		vi.spyOn(Date, "now").mockReturnValue(NOW);
		let attempts = 0;
		const rateLimitedHost = provider === "xai" ? "grok.com" : "chatgpt.com";
		const fetchMock = vi.fn(async (url: string) => {
			if (!url.includes(rateLimitedHost)) return responseFor(url);
			attempts++;
			return attempts === 1
				? new Response("RAW-RESPONSE", { status: 429, headers: { "Retry-After": "120" } })
				: responseFor(url);
		});
		vi.stubGlobal("fetch", fetchMock);
		const h = await harness();
		let operation = h.open();
		await vi.waitFor(() => expect(h.text()).toContain("Rate limited. Try again in 2m."));
		h.close();
		await operation;
		vi.spyOn(Date, "now").mockReturnValue(NOW + 60000);
		operation = h.open();
		await vi.waitFor(() => expect(h.text()).toContain("60% left"));
		expect(h.text()).toContain("Rate limited. Try again in 1m.");
		expect(attempts).toBe(1);
		expect(fetchMock).toHaveBeenCalledTimes(5);
		h.close();
		await operation;
		vi.spyOn(Date, "now").mockReturnValue(NOW + 120001);
		operation = h.open();
		await vi.waitFor(() => expect(h.text()).toContain(provider === "xai" ? "62.5% left" : "68% left"));
		expect(attempts).toBe(2);
		h.close();
		await operation;
	});

	it.each(["close", "shutdown"])("aborts and ignores stale results after %s", async (action) => {
		const pending = deferred<Response>();
		const signals: AbortSignal[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn((_url: string, init: RequestInit) => {
				signals.push(init.signal as AbortSignal);
				return pending.promise;
			}),
		);
		const h = await harness();
		const operation = h.open();
		await vi.waitFor(() => expect(signals).toHaveLength(3));
		if (action === "close") h.close();
		else h.shutdown();
		await operation;
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		const renders = h.requestRender.mock.calls.length;
		pending.resolve(Response.json(codexBody));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(h.requestRender).toHaveBeenCalledTimes(renders);
		expect(h.done).toHaveBeenCalledTimes(1);
	});

	it("handles sign-in-store errors without exposing their cause", async () => {
		vi.stubGlobal("fetch", vi.fn());
		const h = await harness();
		vi.spyOn(h.registry, "listCredentials").mockRejectedValue(new Error("SECRET-TOKEN RAW-RESPONSE"));
		const operation = h.open();
		await vi.waitFor(() => expect(h.text()).toContain("Could not read sign-ins."));
		expect(h.text()).not.toContain("SECRET-TOKEN");
		h.close();
		await operation;
	});

	it("shows the empty state without fetching", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const h = await harness({ credentials: {} });
		const operation = h.open();
		await vi.waitFor(() => expect(h.text()).toContain("No subscription sign-ins."));
		expect(fetchMock).not.toHaveBeenCalled();
		h.close();
		await operation;
	});
});
