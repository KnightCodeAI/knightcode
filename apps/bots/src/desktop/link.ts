// The desktop link (spec section 14): the desktop app keeps one outbound WebSocket to the account's user object. It
// authenticates with a "socket" ticket in its first frame. Bots send commands down it; the desktop decides locally
// (asking before the first command in a session, then "Allow on this computer") and answers. With no linked desktop
// (app closed, PC asleep) the bot is told the computer is offline.
import { sessionLive } from "../auth/session.ts";
import { verifyTicket } from "../auth/tickets.ts";
import type { Env } from "../env.ts";

export const OFFLINE =
	"The owner's computer is offline: the KnightCode desktop app is closed, the computer is asleep, or the owner has not let bots use it.";

/** How long a command may wait, including the owner answering the desktop's question. */
const EXEC_TIMEOUT_MS = 10 * 60 * 1000;

export type DesktopFrame =
	| { kind: "auth"; ticket: string }
	| { kind: "exec"; id: string; botId: string; session: string; command: string }
	| { kind: "exec-result"; id: string; output?: string; exitCode?: number; refused?: boolean; error?: string }
	| { kind: "proxy-open"; id: string; host: string; port: number }
	| { kind: "proxy-data"; id: string; data: string }
	| { kind: "proxy-close"; id: string; reason?: string };

/** One TCP connection the desktop makes for home routing; bytes go both ways as base64 frames. */
export interface Tunnel {
	write(bytes: Uint8Array): void;
	close(): void;
}

const toBase64 = (bytes: Uint8Array) => btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export type ExecResult = { ok: true; output: string; exitCode: number } | { ok: false; error: string };

type Attachment = { authed?: boolean; sessionId?: string; checkedAt?: number };

/** How often a linked desktop's session is checked again. */
const SESSION_RECHECK_MS = 30_000;

/** The user object's half of the link: one per account. */
export class DesktopLink {
	readonly #ctx: DurableObjectState;
	readonly #env: Env;
	readonly #accountId: () => string;
	// ponytail: pending commands live in memory; a user object evicted mid-command fails it, and the bot can retry.
	readonly #pending = new Map<string, (result: ExecResult) => void>();
	readonly #tunnels = new Map<string, { data(bytes: Uint8Array): void; closed(reason?: string): void }>();

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
			socket.serializeAttachment({ authed: true, sessionId: principal.sessionId, checkedAt: Date.now() } satisfies Attachment);
			return;
		}
		if (!(await this.#stillSignedIn(socket))) return;
		if (frame.kind === "proxy-data") return this.#tunnels.get(frame.id)?.data(fromBase64(frame.data));
		if (frame.kind === "proxy-close") {
			const tunnel = this.#tunnels.get(frame.id);
			this.#tunnels.delete(frame.id);
			return tunnel?.closed(frame.reason);
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
		for (const tunnel of this.#tunnels.values()) tunnel.closed("offline");
		this.#tunnels.clear();
	}

	/** A connection to host:port made by the desktop (home routing); undefined when no desktop is linked. */
	async tunnel(host: string, port: number, handlers: { data(bytes: Uint8Array): void; closed(reason?: string): void }): Promise<Tunnel | undefined> {
		let socket: WebSocket | undefined;
		for (const candidate of this.#linked()) if (await this.#stillSignedIn(candidate)) socket = candidate;
		if (!socket) return undefined;
		const linked = socket;
		const id = crypto.randomUUID();
		this.#tunnels.set(id, handlers);
		linked.send(JSON.stringify({ kind: "proxy-open", id, host, port } satisfies DesktopFrame));
		return {
			write: (bytes) => linked.send(JSON.stringify({ kind: "proxy-data", id, data: toBase64(bytes) } satisfies DesktopFrame)),
			close: () => {
				if (!this.#tunnels.delete(id)) return;
				linked.send(JSON.stringify({ kind: "proxy-close", id } satisfies DesktopFrame));
			},
		};
	}

	/**
	 * Whether the session that linked this socket is still live (checked at most every 30 seconds). A revoked or expired
	 * session closes the socket: the desktop stops receiving commands at once.
	 */
	async #stillSignedIn(socket: WebSocket): Promise<boolean> {
		const attachment = (socket.deserializeAttachment() ?? {}) as Attachment;
		if (Date.now() - (attachment.checkedAt ?? 0) < SESSION_RECHECK_MS) return true;
		if (attachment.sessionId && (await sessionLive(this.#env, attachment.sessionId))) {
			socket.serializeAttachment({ ...attachment, checkedAt: Date.now() } satisfies Attachment);
			return true;
		}
		socket.serializeAttachment({} satisfies Attachment);
		socket.close(4401, "session ended");
		return false;
	}

	async exec(input: { botId: string; session: string; command: string }): Promise<ExecResult> {
		let socket: WebSocket | undefined;
		for (const candidate of this.#linked()) if (await this.#stillSignedIn(candidate)) socket = candidate;
		if (!socket) return { ok: false, error: OFFLINE };
		const id = crypto.randomUUID();
		const linked = socket;
		return new Promise<ExecResult>((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				resolve({ ok: false, error: "The owner's computer did not answer in time." });
			}, EXEC_TIMEOUT_MS);
			this.#pending.set(id, (result) => {
				clearTimeout(timer);
				resolve(result);
			});
			linked.send(JSON.stringify({ kind: "exec", id, ...input } satisfies DesktopFrame));
		});
	}
}
