// The UI's one realtime socket (spec section 15), served by the account's user object: the client authenticates with
// a ticket, then subscribes to threads by bot. The hub keeps one socket to each subscribed bot object, authenticated
// with a ticket for the same principal (so the bot still checks ownership itself), and routes frames by bot. Account
// events (bots, inbox items, approvals, the computer) go to every client.
import { type ClientFrame, decodeFrame, encodeFrame, type ServerEvent, type ServerFrame } from "@knightcode/bots-protocol";
import type { Principal } from "../auth/session.ts";
import { issueTicket, verifyTicket } from "../auth/tickets.ts";
import type { Env } from "../env.ts";
import { groupEntries, pageOf } from "../team/group-view.ts";
import { addressees, GroupTurns } from "../team/groups.ts";

type Attachment = { principal?: Principal; bots?: string[]; groups?: string[] };

type Upstream = { socket?: WebSocket; ready: boolean; queue: string[]; opening?: Promise<void> };

export class ThreadHub {
	readonly #ctx: DurableObjectState;
	readonly #env: Env;
	readonly #accountId: () => string;
	// ponytail: upstream sockets live in memory; outbound sockets keep the object awake, and an evicted hub reopens them
	// on the client's next frame (the UI resubscribes with its version after any reconnect).
	readonly #upstreams = new Map<string, Upstream>();

	constructor(ctx: DurableObjectState, env: Env, accountId: () => string) {
		this.#ctx = ctx;
		this.#env = env;
		this.#accountId = accountId;
	}

	accept(): Response {
		const { 0: client, 1: server } = new WebSocketPair();
		this.#ctx.acceptWebSocket(server, ["client"]);
		server.serializeAttachment({} satisfies Attachment);
		return new Response(null, { status: 101, webSocket: client });
	}

	#clients(): WebSocket[] {
		return this.#ctx.getWebSockets("client").filter((socket) => (socket.deserializeAttachment() as Attachment | null)?.principal);
	}

	/** Sends an account event to every signed-in client. */
	broadcast(event: ServerEvent): void {
		const text = encodeFrame({ type: "event", event });
		for (const socket of this.#clients()) {
			try {
				socket.send(text);
			} catch {
				// A closing socket; its close handler cleans up.
			}
		}
	}

	async message(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
		const send = (frame: ServerFrame) => socket.send(encodeFrame(frame));
		let frame: ClientFrame;
		try {
			frame = decodeFrame(typeof data === "string" ? data : new TextDecoder().decode(data)) as ClientFrame;
		} catch {
			return send({ type: "error", code: "bad_frame", message: "bad frame" });
		}
		const attachment = (socket.deserializeAttachment() ?? {}) as Attachment;
		if (!attachment.principal) {
			const principal = frame.type === "auth" ? await verifyTicket(this.#env, frame.ticket, "socket") : undefined;
			if (!principal || principal.accountId !== this.#accountId()) {
				send({ type: "error", code: "unauthorized", message: "unauthorized" });
				return socket.close(4401, "unauthorized");
			}
			socket.serializeAttachment({ principal, bots: [] } satisfies Attachment);
			return send({ type: "ready", accountId: principal.accountId });
		}
		if (frame.type === "auth") return;
		if (!("botId" in frame)) return this.#groupFrame(socket, attachment, frame);
		const bots = new Set(attachment.bots ?? []);
		if (frame.type === "subscribe") bots.add(frame.botId);
		if (frame.type === "unsubscribe") bots.delete(frame.botId);
		socket.serializeAttachment({ ...attachment, bots: [...bots] } satisfies Attachment);
		// The last client leaving a bot ends its upstream; otherwise the frame goes to the bot as it is.
		if (frame.type === "unsubscribe" && !this.#subscribers(frame.botId).length) {
			this.#upstreams.get(frame.botId)?.socket?.close(1000, "unsubscribed");
			this.#upstreams.delete(frame.botId);
			return;
		}
		await this.#toBot(frame.botId, attachment.principal, encodeFrame(frame));
	}

	/** Groups with a run going in this instance. */
	readonly #running = new Set<string>();

	async #groupFrame(socket: WebSocket, attachment: Attachment, frame: Extract<ClientFrame, { groupId: string }>): Promise<void> {
		const group = await this.#env.DB.prepare("SELECT id, name, lead_bot, members FROM groups WHERE id = ? AND account_id = ?")
			.bind(frame.groupId, this.#accountId())
			.first<{ id: string; name: string; lead_bot: string; members: string }>();
		if (!group) return socket.send(encodeFrame({ type: "error", code: "not_found", message: "no such group" }));
		const groups = new Set(attachment.groups ?? []);
		if (frame.type === "subscribe") groups.add(group.id);
		if (frame.type === "unsubscribe") groups.delete(group.id);
		socket.serializeAttachment({ ...attachment, groups: [...groups] } satisfies Attachment);
		if (frame.type === "subscribe") return this.#sendGroup(group.id, [socket]);
		if (frame.type !== "submit" || this.#running.has(group.id)) return;
		const turns = new GroupTurns(this.#env.DB);
		await turns.post(group.id, "user", frame.text);
		const memberIds = JSON.parse(group.members) as string[];
		const names = new Map(
			(await this.#env.DB.prepare(`SELECT id, name FROM bots WHERE account_id = ? AND id IN (${memberIds.map(() => "?").join(",")})`).bind(this.#accountId(), ...memberIds).all<{ id: string; name: string }>()).results.map(
				(row) => [row.id, row.name] as const,
			),
		);
		this.#running.add(group.id);
		await this.#sendGroup(group.id);
		try {
			for (const member of addressees(frame.text, memberIds.map((id) => ({ id, name: names.get(id) ?? id })), group.lead_bot)) {
				await turns.requestTurn(
					group.id,
					member,
					{ since: 0, peers: memberIds.filter((id) => id !== member).map((id) => names.get(id) ?? id), deadline: Date.now() + 120_000, windingDown: false },
					(asked, request) =>
						this.#env.BOT.get(this.#env.BOT.idFromName(asked)).groupTurn(this.#accountId(), {
							group: group.name,
							peers: request.peers,
							since: request.since.map((message) => ({ author: message.author === "user" ? "Owner" : (names.get(message.author) ?? message.author), text: message.text })),
							windingDown: request.windingDown,
						}),
				);
				await this.#sendGroup(group.id);
			}
		} finally {
			this.#running.delete(group.id);
			await this.#sendGroup(group.id);
		}
	}

	/** The group's whole thread to its subscribers (or to `only`), as a new version. */
	async #sendGroup(groupId: string, only?: WebSocket[]): Promise<void> {
		const view = pageOf(await groupEntries(this.#env.DB, groupId), this.#running.has(groupId), undefined, Number.MAX_SAFE_INTEGER);
		const text = encodeFrame({ type: "view", groupId, version: (this.#groupVersion = Math.max(this.#groupVersion + 1, Date.now())), view });
		const targets = only ?? this.#clients().filter((client) => ((client.deserializeAttachment() as Attachment).groups ?? []).includes(groupId));
		for (const client of targets) {
			try {
				client.send(text);
			} catch {
				// Closing.
			}
		}
	}
	#groupVersion = 0;

	/** A client went away: bots nobody watches any more lose their upstream. */
	closed(): void {
		for (const botId of [...this.#upstreams.keys()])
			if (!this.#subscribers(botId).length) {
				this.#upstreams.get(botId)?.socket?.close(1000, "no subscribers");
				this.#upstreams.delete(botId);
			}
	}

	#subscribers(botId: string): WebSocket[] {
		return this.#clients().filter((socket) => ((socket.deserializeAttachment() as Attachment).bots ?? []).includes(botId));
	}

	async #toBot(botId: string, principal: Principal, text: string): Promise<void> {
		let upstream = this.#upstreams.get(botId);
		if (!upstream) {
			upstream = { ready: false, queue: [] };
			this.#upstreams.set(botId, upstream);
			upstream.opening = this.#open(botId, principal, upstream);
		}
		if (upstream.ready && upstream.socket) upstream.socket.send(text);
		else upstream.queue.push(text);
		await upstream.opening;
	}

	async #open(botId: string, principal: Principal, upstream: Upstream): Promise<void> {
		const response = await this.#env.BOT.get(this.#env.BOT.idFromName(botId)).fetch("https://bot/socket", { headers: { upgrade: "websocket" } });
		const socket = response.webSocket;
		if (!socket) {
			this.#upstreams.delete(botId);
			for (const client of this.#subscribers(botId)) client.send(encodeFrame({ type: "error", code: "unavailable", message: "the bot is not reachable" }));
			return;
		}
		socket.accept();
		upstream.socket = socket;
		socket.addEventListener("message", (event) => this.#fromBot(botId, upstream, String(event.data)));
		socket.addEventListener("close", () => {
			if (this.#upstreams.get(botId) === upstream) this.#upstreams.delete(botId);
		});
		socket.send(encodeFrame({ type: "auth", ticket: await issueTicket(this.#env, principal, "socket") }));
	}

	#fromBot(botId: string, upstream: Upstream, text: string): void {
		let frame: ServerFrame;
		try {
			frame = decodeFrame(text) as ServerFrame;
		} catch {
			return;
		}
		if (frame.type === "ready") {
			upstream.ready = true;
			for (const queued of upstream.queue.splice(0)) upstream.socket?.send(queued);
			return;
		}
		for (const client of this.#subscribers(botId)) {
			try {
				client.send(text);
			} catch {
				// Closing.
			}
		}
	}
}
