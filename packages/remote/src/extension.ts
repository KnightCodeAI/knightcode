import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@knightcodeai/cli";
import { deleteToken, login, logout, readToken, relayOrigin, writeToken } from "./auth.ts";
import { RelayHost } from "./host.ts";
import { Mirror, type MirrorSource } from "./mirror.ts";

const STATUS_KEY = "remote";

/**
 * A copy of packages/cli/src/utils/open-browser.ts, not an import: packages/cli already
 * depends on this package, so importing a runtime value back would close a workspace cycle.
 * Keep the two in step — in particular never use `cmd /c start` on Windows, which re-parses
 * &, | and ^ in the URL before `start` sees it.
 */
function openBrowser(target: string): void {
	const [command, args]: [string, string[]] =
		process.platform === "darwin"
			? ["open", [target]]
			: process.platform === "win32"
				? ["rundll32", ["url.dll,FileProtocolHandler", target]]
				: ["xdg-open", [target]];
	// Best effort: the caller always prints the url too, so a missing launcher must not throw.
	spawn(command, args, { stdio: "ignore", detached: true })
		.on("error", () => {})
		.unref();
}
const SUBCOMMANDS = ["status", "stop", "logout"] as const;

interface Session {
	host: RelayHost;
	mirror: Mirror;
	roomId: string;
	viewers: number;
}

function sourceFor(ctx: ExtensionContext): MirrorSource {
	return {
		cwd: ctx.cwd,
		model: ctx.model?.id,
		getEntries: () => ctx.sessionManager.getEntries(),
		getLeafId: () => ctx.sessionManager.getLeafId(),
		getSessionName: () => ctx.sessionManager.getSessionName(),
	};
}

/**
 * Assistant content is a block union, and AgentMessage also covers message kinds with no
 * `content` at all (BashExecutionMessage), so the property is read defensively.
 */
function textOf(message: object): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const block of content) {
		if (typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text") {
			const value = (block as { text?: unknown }).text;
			if (typeof value === "string") text += value;
		}
	}
	return text;
}

export function remoteExtension(knightcode: ExtensionAPI): void {
	let session: Session | undefined;

	const linkFor = (roomId: string): string => `${relayOrigin()}/r/${roomId}`;

	const publish = (ctx: ExtensionContext): void => {
		if (!session) return;
		for (const frame of session.mirror.drain(sourceFor(ctx))) session.host.send(frame);
		session.host.send(
			session.mirror.status(ctx.isIdle(), !ctx.isIdle(), ctx.model?.id, ctx.getContextUsage()?.tokens ?? undefined),
		);
	};

	knightcode.on("message_end", (_event, ctx) => publish(ctx));
	knightcode.on("tool_execution_end", (_event, ctx) => publish(ctx));
	knightcode.on("turn_end", (_event, ctx) => publish(ctx));
	knightcode.on("agent_end", (_event, ctx) => publish(ctx));

	knightcode.on("message_update", (event, ctx) => {
		// Token-rate path: never call getEntries() here, and send nothing with no viewers watching.
		if (!session || session.viewers === 0) return;
		const text = textOf(event.message);
		if (text.length === 0) return;
		session.host.send(session.mirror.stream(String(ctx.sessionManager.getLeafId() ?? "live"), text));
	});

	// Written out rather than looped: `on` is an overload set, and a union-typed event
	// name matches none of its signatures.
	const markStale = (): void => session?.mirror.markStale();
	knightcode.on("session_start", markStale);
	knightcode.on("session_before_switch", markStale);
	knightcode.on("session_before_fork", markStale);
	knightcode.on("session_tree", markStale);

	knightcode.on("session_shutdown", async () => {
		// Closing the socket marks the room offline; its history stays readable until the TTL.
		await session?.host.close("Terminal session ended");
		session = undefined;
	});

	knightcode.registerCommand("remote", {
		description: "Publish this session to a live web link",
		getArgumentCompletions: (prefix: string) =>
			SUBCOMMANDS.filter((name) => name.startsWith(prefix.trim())).map((name) => ({ value: name, label: name })),
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			const command = args.trim().toLowerCase();

			if (command === "stop") {
				if (!session) {
					ctx.ui.notify("Remote is not running", "info");
					return;
				}
				await session.host.close("Stopped from the terminal");
				// Closing the socket alone would leave the room readable for its 24 hour TTL.
				await session.host.deleteRoom();
				session = undefined;
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.notify("Remote stopped", "info");
				return;
			}

			if (command === "logout") {
				await session?.host.close("Signed out");
				session = undefined;
				ctx.ui.setStatus(STATUS_KEY, undefined);
				await logout(relayOrigin());
				ctx.ui.notify("Signed out of KnightCode remote", "info");
				return;
			}

			if (command === "status") {
				if (!session) ctx.ui.notify("Remote is not running", "info");
				else ctx.ui.notify(`${linkFor(session.roomId)} — ${session.viewers} viewer(s)`, "info");
				return;
			}

			if (session) {
				ctx.ui.notify(linkFor(session.roomId), "info");
				return;
			}

			if (ctx.mode !== "tui") {
				ctx.ui.notify("Remote sessions need the interactive terminal", "error");
				return;
			}

			if (process.env.KNIGHTCODE_OFFLINE !== undefined) {
				ctx.ui.notify("Remote sessions are unavailable in offline mode", "error");
				return;
			}

			const origin = relayOrigin();
			let token = await readToken();
			if (!token) {
				try {
					token = await login(
						origin,
						(userCode, uri) => {
							// The url is printed as well as opened: a headless box, a remote shell or a
							// browser that simply does not launch all leave the user something to paste.
							ctx.ui.notify(`Approve ${userCode} at ${uri}`, "info");
							openBrowser(uri);
						},
						new AbortController().signal,
					);
					await writeToken(token);
				} catch (error) {
					ctx.ui.notify(`Sign-in failed: ${error instanceof Error ? error.message : String(error)}`, "error");
					return;
				}
			}

			const mirror = new Mirror();
			const host = new RelayHost({
				origin,
				token,
				cwd: ctx.cwd,
				sessionName: ctx.sessionManager.getSessionName(),
				onRoom: () => {},
				onPrompt: (text) => {
					// Dropped while stale so a remote message cannot land in a session the viewer never saw.
					if (session && !session.mirror.isStale()) knightcode.sendUserMessage(text, { deliverAs: "followUp" });
				},
				onAbort: () => ctx.abort(),
				onResnapshot: () => mirror.markStale(),
				onStatus: (status) => {
					const previousViewers = session?.viewers ?? 0;
					if (session && status.state === "connected") session.viewers = status.viewers;
					// Green only once the socket is actually up. The viewer count moved out of the
					// footer: it changes whenever a phone locks its screen, which made a line the
					// user cannot act on the most animated thing in the terminal. /remote status
					// still reports it on demand.
					const [colour, label] =
						status.state === "connected"
							? (["success", "remote active"] as const)
							: status.state === "retrying"
								? (["warning", "remote reconnecting"] as const)
								: status.state === "expired"
									? (["error", "remote link expired"] as const)
									: (["dim", "remote connecting"] as const);
					ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(colour, label));
					// Only on a rise from nobody watching: otherwise every reconnect and every
					// viewer-count change would fire another notification.
					if (status.state === "connected" && status.viewers > 0 && previousViewers === 0) {
						ctx.ui.notify("A viewer connected to your remote session", "info");
					}
					// A revoked token or a deleted room is not recoverable by retrying; the
					// user has to run /remote again. The session itself is untouched.
					if (status.state === "expired") {
						session = undefined;
					}
				},
			});

			session = { host, mirror, roomId: host.roomId, viewers: 0 };
			host.start();
			publish(ctx);
			ctx.ui.notify(`Remote session: ${linkFor(host.roomId)}`, "info");
		},
	});
}
