import type { ExtensionAPI, ExtensionCommandContext } from "../../core/extensions/types.ts";
import { UsagePanel } from "./panel.ts";
import {
	fetchSubscriptionUsage,
	formatUsageDuration,
	getUsageAccounts,
	UsageFetchError,
	type UsageRow,
} from "./providers.ts";

export default function usageExtension(pi: ExtensionAPI): void {
	const cooldowns = new Map<string, number>();
	let active: { controller: AbortController; close: () => void } | undefined;

	pi.on("session_shutdown", () => {
		active?.controller.abort();
		active?.close();
	});

	pi.registerCommand("usage", {
		description: "Show subscription usage limits",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/usage needs the interactive terminal.", "warning");
				return;
			}
			const controller = new AbortController();
			try {
				await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
					let closed = false;
					const close = () => {
						if (closed) return;
						closed = true;
						controller.abort();
						done();
					};
					active = { controller, close };
					const panel = new UsagePanel(theme, keybindings, close);
					void load(
						ctx,
						controller.signal,
						cooldowns,
						(rows) => {
							if (controller.signal.aborted) return;
							panel.setRows(rows);
							tui.requestRender();
						},
						() => {
							if (controller.signal.aborted) return;
							panel.setReadError();
							tui.requestRender();
						},
					);
					return panel;
				});
			} finally {
				controller.abort();
				if (active?.controller === controller) active = undefined;
			}
		},
	});
}

async function load(
	ctx: ExtensionCommandContext,
	signal: AbortSignal,
	cooldowns: Map<string, number>,
	publish: (rows: readonly UsageRow[]) => void,
	readError: () => void,
): Promise<void> {
	let accounts;
	try {
		accounts = await getUsageAccounts(ctx.modelRegistry, { activeProviderId: ctx.model?.provider, signal });
	} catch {
		if (!signal.aborted) readError();
		return;
	}
	if (signal.aborted) return;
	let rows: UsageRow[] = accounts.map((account): UsageRow => {
		if (!account.supported) return { account, state: "unsupported" };
		const retryAt = cooldowns.get(account.providerId);
		if (retryAt !== undefined && retryAt > Date.now()) {
			return {
				account,
				state: "error",
				failure: {
					kind: "rate_limit",
					retryAt,
					message: `Rate limited. Try again in ${formatUsageDuration(retryAt - Date.now())}.`,
				},
			};
		}
		cooldowns.delete(account.providerId);
		return { account, state: "loading" };
	});
	publish(rows);
	for (const [index, row] of rows.entries()) {
		if (row.state !== "loading") continue;
		// No await between providers: slow/failing lookups never hold up their siblings.
		void fetchSubscriptionUsage(ctx.modelRegistry, row.account.providerId, { signal }).then(
			(usage) => {
				if (signal.aborted) return;
				rows = rows.map((current, i) => (i === index ? { account: row.account, state: "ok", usage } : current));
				publish(rows);
			},
			(error: unknown) => {
				if (signal.aborted) return;
				const failure =
					error instanceof UsageFetchError
						? error.failure
						: { kind: "network" as const, message: "Could not reach the usage service." };
				if (failure.kind === "rate_limit" && failure.retryAt !== undefined)
					cooldowns.set(row.account.providerId, failure.retryAt);
				rows = rows.map((current, i) => (i === index ? { account: row.account, state: "error", failure } : current));
				publish(rows);
			},
		);
	}
}
