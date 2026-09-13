import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@knightcodeai/cli";
import { logout, readToken, relayOrigin, writeToken } from "./auth.ts";
import { RelayHost, type RelayHostOptions } from "./host.ts";
import { Mirror, type MirrorSource } from "./mirror.ts";
import type { RemoteCommand } from "./protocol.ts";
import { signIn } from "./signin.ts";

const STATUS_KEY = "remote";

const SUBCOMMANDS = ["status", "stop", "logout"] as const;

interface Session {
	host: RelayHost;
	mirror: Mirror;
	roomId: string;
	viewers: number;
}

export interface RemoteExtensionDeps {
	/** Test seam: stands in for the relay websocket. */
	socketFactory?: RelayHostOptions["socketFactory"];
}

/**
 * Everything getCommands() returns is dispatchable through sendUserMessage with
 * expandPromptTemplates: extension commands run, skills and prompt templates expand.
 * Built-in TUI commands (/model, /tree…) are not in that list and cannot be sent as text.
 * "remote" itself is dropped: stopping the remote from the remote is a footgun.
 */
export function remoteCommands(commands: Array<{ name: string; description?: string }>): RemoteCommand[] {
	return commands
		.filter((command) => command.name !== "remote")
		.map((command) => ({ name: command.name, description: command.description }));
}

function sourceFor(knightcode: ExtensionAPI, ctx: ExtensionContext): MirrorSource {
	return {
		cwd: ctx.cwd,
		model: ctx.model?.id,
		getEntries: () => ctx.sessionManager.getEntries(),
		getLeafId: () => ctx.sessionManager.getLeafId(),
		getSessionName: () => ctx.sessionManager.getSessionName(),
		getCommands: () => remoteCommands(knightcode.getCommands()),
	};
}

/**
 * Assistant content is a block union, and AgentMessage also covers message kinds with no
 * `content` at all (BashExecutionMessage), so the property is read defensively.
 */
function blocksOf(message: object, type: "text" | "thinking"): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return type === "text" ? content : "";
	if (!Array.isArray(content)) return "";
	let text = "";
	for (const block of content) {
		if (typeof block === "object" && block !== null && (block as { type?: unknown }).type === type) {
			// Text blocks carry `text` and thinking blocks carry `thinking`: the field is named after the type.
			const value = (block as Record<string, unknown>)[type];
			if (typeof value === "string") text += value;
		}
	}
	return text;
}

export function remoteExtension(knightcode: ExtensionAPI, deps: RemoteExtensionDeps = {}): void {
	let session: Session | undefined;
	// A paused session publishes to this room again, so toggling /remote keeps the link.
	let lastRoomId: string | undefined;

	const linkFor = (roomId: string): string => `${relayOrigin()}/r/${roomId}`;

	const publish = (ctx: ExtensionContext): void => {
		if (!session) return;
		for (const frame of session.mirror.drain(sourceFor(knightcode, ctx))) session.host.send(frame);
		session.host.send(
			session.mirror.status(ctx.isIdle(), !ctx.isIdle(), ctx.model?.id, ctx.getContextUsage()?.tokens ?? undefined),
		);
	};

	// agent_start is what flips the session to "working" on the web before anything settles;
	// without it the first status the viewer sees arrives with the first finished message.
	knightcode.on("agent_start", (_event, ctx) => publish(ctx));
	// The CLI appends a message to the session only after every message_end handler has returned,
	// so draining inline missed the very message that ended: a prompt sent from the phone showed up
	// only once the reply to it finished. The next macrotask runs after that append.
	knightcode.on("message_end", (_event, ctx) => {
		setTimeout(() => publish(ctx), 0);
	});
	knightcode.on("tool_execution_end", (_event, ctx) => publish(ctx));
	knightcode.on("turn_end", (_event, ctx) => publish(ctx));
	knightcode.on("agent_end", (_event, ctx) => publish(ctx));
	// agent_end fires while the run flag is still set, so isIdle() is false there and the
	// phone kept showing "Working". agent_settled is the first event after it clears.
	knightcode.on("agent_settled", (_event, ctx) => publish(ctx));

	knightcode.on("message_update", (event, ctx) => {
		// Token-rate path: never call getEntries() here, and send nothing with no viewers watching.
		if (!session || session.viewers === 0) return;
		const text = blocksOf(event.message, "text");
		const thinking = blocksOf(event.message, "thinking");
		if (text.length === 0 && thinking.length === 0) return;
		session.host.send(
			session.mirror.stream(String(ctx.sessionManager.getLeafId() ?? "live"), text, thinking || undefined),
		);
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
		description: "Toggle publishing this session to a live web link",
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
				// Closing the socket alone would leave the room readable for its TTL.
				await session.host.deleteRoom();
				session = undefined;
				lastRoomId = undefined;
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.notify("Remote stopped and the link deleted", "info");
				return;
			}

			if (command === "logout") {
				await session?.host.close("Signed out");
				session = undefined;
				lastRoomId = undefined;
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
				// Toggle off. The room goes offline but stays readable; the next bare /remote
				// reconnects to the same link. /remote stop is the one that deletes.
				await session.host.close("Paused from the terminal");
				lastRoomId = session.roomId;
				session = undefined;
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.notify("Remote paused. /remote again resumes the same link", "info");
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
				// The screen owns the whole device flow: it shows the code, opens the browser and
				// stays up until the relay answers, so the url is on screen for a headless box or
				// a remote shell where nothing launched.
				const result = await signIn(ctx, origin);
				if (!result) {
					ctx.ui.notify("Sign-in cancelled", "info");
					return;
				}
				if ("error" in result) {
					ctx.ui.notify(`Sign-in failed: ${result.error}`, "error");
					return;
				}
				token = result.token;
				await writeToken(token);
			}

			const mirror = new Mirror();
			const host = new RelayHost({
				origin,
				token,
				roomId: lastRoomId,
				cwd: ctx.cwd,
				sessionName: ctx.sessionManager.getSessionName(),
				socketFactory: deps.socketFactory,
				onRoom: () => {},
				onOpen: () => {
					// On every open, not just the first: frames sent while the socket was down
					// were dropped, and the relay replaces its log on the next snapshot anyway.
					// Publishing before the socket existed is how the phone came to miss the
					// earlier chat and the command list entirely.
					mirror.markStale();
					publish(ctx);
				},
				onPrompt: (text) => {
					// Dropped while stale so a remote message cannot land in a session the viewer never saw.
					// expandPromptTemplates puts the text on the same path as the terminal's own input:
					// a leading slash dispatches an extension command or expands a skill or template.
					if (session && !session.mirror.isStale()) {
						knightcode.sendUserMessage(text, { deliverAs: "followUp", expandPromptTemplates: true });
					}
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
			lastRoomId = host.roomId;
			host.start();
			ctx.ui.notify(`Remote session: ${linkFor(host.roomId)}`, "info");
		},
	});
}
