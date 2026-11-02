// The desktop link (spec section 14): the desktop app keeps one outbound WebSocket to the account's user object. It
// authenticates with a "socket" ticket in its first frame. Bots send commands down it; the desktop decides locally
// (asking before the first command in a session, then "Allow on this computer") and answers. With no linked desktop
// (app closed, PC asleep) the bot is told the computer is offline.
import { verifyTicket } from "../auth/tickets.ts";
import type { Env } from "../env.ts";

export const OFFLINE =
	"The owner's computer is offline: the KnightCode desktop app is closed, the computer is asleep, or the owner has not let bots use it.";

/** How long a command may wait, including the owner answering the desktop's question. */
const EXEC_TIMEOUT_MS = 10 * 60 * 1000;

export type DesktopFrame =
	| { kind: "auth"; ticket: string }
	| { kind: "exec"; id: string; botId: string; session: string; command: string }
	| { kind: "exec-result"; id: string; output?: string; exitCode?: number; refused?: boolean; error?: string };

export type ExecResult = { ok: true; output: string; exitCode: number } | { ok: false; error: string };

type Attachment = { authed?: boolean };

/** The user object's half of the link: one per account. */
export class DesktopLink {
	readonly #ctx: DurableObjectState;
	readonly #env: Env;
	readonly #accountId: () => string;
	// ponytail: pending commands live in memory; a user object evicted mid-command fails it, and the bot can retry.
	readonly #pending = new Map<string, (result: ExecResult) => void>();

	constructor(ctx: DurableObjectState, env: Env, accountId: () => string) {
		this.#ctx = ctx;
		this.#env = env;
		this.#accountId = accountId;
	}

	accept(): Response {
		const { 0: client, 1: server } = new WebSocketPair();
		this.#ctx.acceptWebSocket(server, ["desktop"]);
		server.serializeAttachment({} satisfies Attachment);
		return new Response(null, { status: 101, webSocket: client });
	}

	#linked(): WebSocket[] {
		return this.#ctx.getWebSockets("desktop").filter((socket) => (socket.deserializeAttachment() as Attachment | null)?.authed);
	}

	online(): boolean {
		return this.#linked().length > 0;
	}

	async message(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		let frame: DesktopFrame;
		try {
			frame = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as DesktopFrame;
		} catch {
			return socket.close(4400, "bad frame");
		}
		const attachment = (socket.deserializeAttachment() ?? {}) as Attachment;
		if (!attachment.authed) {
			const principal = frame.kind === "auth" ? await verifyTicket(this.#env, frame.ticket, "socket") : undefined;
			if (!principal || principal.accountId !== this.#accountId()) return socket.close(4401, "unauthorized");
			socket.serializeAttachment({ authed: true } satisfies Attachment);
			return;
		}
		if (frame.kind !== "exec-result") return;
		const settle = this.#pending.get(frame.id);
		if (!settle) return;
		this.#pending.delete(frame.id);
		if (frame.refused) settle({ ok: false, error: "The owner declined this command on their computer." });
		else if (frame.error) settle({ ok: false, error: frame.error });
		else settle({ ok: true, output: frame.output ?? "", exitCode: frame.exitCode ?? 0 });
	}

	/** The desktop went away: every waiting command learns the computer is offline. */
	closed(): void {
		if (this.online()) return;
		for (const settle of this.#pending.values()) settle({ ok: false, error: OFFLINE });
		this.#pending.clear();
	}

	exec(input: { botId: string; session: string; command: string }): Promise<ExecResult> {
		const socket = this.#linked()[0];
		if (!socket) return Promise.resolve({ ok: false, error: OFFLINE });
		const id = crypto.randomUUID();
		return new Promise<ExecResult>((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				resolve({ ok: false, error: "The owner's computer did not answer in time." });
			}, EXEC_TIMEOUT_MS);
			this.#pending.set(id, (result) => {
				clearTimeout(timer);
				resolve(result);
			});
			socket.send(JSON.stringify({ kind: "exec", id, ...input } satisfies DesktopFrame));
		});
	}
}
