import {
	decodeHostFrame,
	decodeViewerFrame,
	encodeFrame,
	MAX_ROOM_BYTES,
	MAX_VIEWERS,
} from "../../../packages/remote/src/protocol.ts";
import type { Env } from "./accounts.ts";

// Thirty days rather than the original 24 hours: past sessions are a feature of the web app
// now, so a room outlives its terminal until the owner deletes it or this expires. Storage
// per room is still bounded by MAX_ROOM_BYTES through resnapshot.
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Ceiling: per-viewer send backpressure is not enforced here. The design called for
// closing a viewer whose outbound buffer passed MAX_VIEWER_BUFFER_BYTES, but the Workers
// WebSocket API exposes no `bufferedAmount`, so that check could only ever compare
// undefined and never fire. workerd applies its own limit and tears the socket down,
// which #send below treats as an ordinary viewer disconnect. Revisit if the runtime
// ever surfaces buffer depth.
const SEQ_DIGITS = 14;

/**
 * `roomId` is the name the Durable Object was addressed by, which is also the primary key
 * of the D1 `rooms` row. It has to be stored: `state.id.toString()` is the derived hex id
 * and matches no row, so keying D1 writes on it silently updates and deletes nothing.
 */
interface RoomMeta {
	ownerAccountId: string;
	roomId: string;
	createdAt: number;
}

function frameKey(seq: number): string {
	return `f:${String(seq).padStart(SEQ_DIGITS, "0")}`;
}

export class RemoteRoom {
	readonly #state: DurableObjectState;
	readonly #env: Env;

	constructor(state: DurableObjectState, env: Env) {
		this.#state = state;
		this.#env = env;
	}

	hostCount(): number {
		return this.#sockets("host").length;
	}

	#sockets(role: "host" | "viewer"): WebSocket[] {
		return this.#state.getWebSockets(role);
	}

	async fetch(request: Request): Promise<Response> {
		const accountId = request.headers.get("x-kc-account") ?? "";

		if (new URL(request.url).pathname === "/delete") {
			// /remote stop deletes immediately; the TTL alarm is the fallback for an abandoned room.
			// The worker already checked ownership; this repeats it because the operation is destructive.
			const owner = await this.#state.storage.get<RoomMeta>("meta");
			if (owner && owner.ownerAccountId !== accountId) return new Response("Forbidden", { status: 403 });
			for (const socket of [...this.#sockets("host"), ...this.#sockets("viewer")]) {
				socket.close(1000, "Room closed from the terminal");
			}
			await this.#state.storage.deleteAll();
			return new Response(null, { status: 204 });
		}

		const role = request.headers.get("x-kc-role");
		if (role !== "host" && role !== "viewer") return new Response("Bad role", { status: 400 });
		if (role === "viewer" && this.#sockets("viewer").length >= MAX_VIEWERS) {
			return new Response("Too many viewers", { status: 429 });
		}

		const meta = await this.#state.storage.get<RoomMeta>("meta");
		if (!meta) {
			if (role !== "host") return new Response("No such room", { status: 404 });
			const roomId = request.headers.get("x-kc-room");
			if (!roomId) return new Response("Missing room id", { status: 400 });
			await this.#state.storage.put<RoomMeta>("meta", { ownerAccountId: accountId, roomId, createdAt: Date.now() });
		} else if (meta.ownerAccountId !== accountId) {
			return new Response("Forbidden", { status: 403 });
		}

		const pair = new WebSocketPair();
		// Hibernation: the room can be evicted from memory while these sockets stay open.
		this.#state.acceptWebSocket(pair[1], [role]);
		if (role === "host") {
			// A replacement host supersedes the previous one rather than running two publishers.
			for (const existing of this.#sockets("host")) {
				if (existing !== pair[1]) existing.close(1000, "Replaced by a newer host");
			}
			await this.#state.storage.setAlarm(Date.now() + TTL_MS);
			await this.#setStatus("live");
			this.#send("viewer", encodeFrame({ v: 1, type: "host", online: true }));
		}
		this.#broadcastViewerCount();
		return new Response(null, { status: 101, webSocket: pair[0] });
	}

	async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== "string") return;
		const isHost = this.#sockets("host").includes(socket);
		if (isHost) await this.#onHostFrame(message);
		else this.#onViewerFrame(socket, message);
	}

	async webSocketClose(socket: WebSocket): Promise<void> {
		// getWebSockets() has already dropped the closing socket by the time this runs, so
		// the role has to come from its hibernation tags rather than from that list.
		const wasHost = this.#state.getTags(socket).includes("host");
		if (wasHost && this.#sockets("host").filter((existing) => existing !== socket).length === 0) {
			await this.#state.storage.setAlarm(Date.now() + TTL_MS);
			// Without this the session list shows every abandoned room as live for a full day.
			await this.#setStatus("offline");
			// A host that vanished mid-turn would otherwise leave the list spinning for 30 days.
			await this.#setBusy(false);
			await this.#state.storage.delete("stream");
			this.#send("viewer", encodeFrame({ v: 1, type: "host", online: false }));
		}
		this.#broadcastViewerCount();
	}

	async alarm(): Promise<void> {
		// Only fires when no host has reconnected within the TTL.
		if (this.#sockets("host").length > 0) {
			await this.#state.storage.setAlarm(Date.now() + TTL_MS);
			return;
		}
		const meta = await this.#state.storage.get<RoomMeta>("meta");
		if (meta) await this.#env.DB.prepare("DELETE FROM rooms WHERE id = ?").bind(meta.roomId).run();
		await this.#state.storage.deleteAll();
	}

	async #setStatus(status: "live" | "offline"): Promise<void> {
		const meta = await this.#state.storage.get<RoomMeta>("meta");
		if (!meta) return;
		await this.#env.DB.prepare("UPDATE rooms SET status = ?, last_seen_at = ? WHERE id = ?")
			.bind(status, Date.now(), meta.roomId)
			.run();
	}

	/**
	 * `busy` is what the session list draws as the spinning ring. Status frames arrive at every
	 * settle point, which is bursty during a tool-heavy turn, so D1 is written only on a change.
	 */
	async #setBusy(busy: boolean): Promise<void> {
		const previous = (await this.#state.storage.get<boolean>("busy")) ?? false;
		if (previous === busy) return;
		await this.#state.storage.put("busy", busy);
		const meta = await this.#state.storage.get<RoomMeta>("meta");
		if (!meta) return;
		await this.#env.DB.prepare("UPDATE rooms SET busy = ?, last_seen_at = ? WHERE id = ?")
			.bind(busy ? 1 : 0, Date.now(), meta.roomId)
			.run();
	}

	async #onHostFrame(raw: string): Promise<void> {
		const frame = decodeHostFrame(raw);
		if (!frame) return;

		if (frame.type === "status") {
			await this.#setBusy(frame.streaming === true);
		}

		if (frame.type === "stream") {
			// Never persisted in the log; the latest one is kept in a single slot.
			await this.#state.storage.put("stream", raw);
			this.#send("viewer", raw);
			return;
		}
		// Anything else means the draft has settled into the log or the turn moved on. Kept
		// past this point, the slot replayed a stale half-message to every later viewer.
		await this.#state.storage.delete("stream");

		const seq = ((await this.#state.storage.get<number>("seq")) ?? 0) + 1;
		const stamped = JSON.stringify({ ...frame, seq });

		if (frame.type === "snapshot") {
			// A snapshot is a checkpoint: everything before it is dropped.
			const previous = await this.#state.storage.list<string>({ prefix: "f:" });
			await this.#state.storage.delete([...previous.keys()]);
			await this.#state.storage.put("bytes", 0);
		}

		const bytes = ((await this.#state.storage.get<number>("bytes")) ?? 0) + stamped.length;
		await this.#state.storage.put({ [frameKey(seq)]: stamped, seq, bytes });
		this.#send("viewer", stamped);

		if (bytes > MAX_ROOM_BYTES) this.#send("host", encodeFrame({ v: 1, type: "resnapshot" }));
	}

	#onViewerFrame(socket: WebSocket, raw: string): void {
		const frame = decodeViewerFrame(raw);
		if (!frame) return;
		if (frame.type === "hello") {
			void this.#replay(socket, frame.since);
			return;
		}
		if (this.#sockets("host").length === 0) {
			socket.send(encodeFrame({ v: 1, type: "error", message: "The terminal session is offline" }));
			return;
		}
		this.#send("host", raw);
	}

	async #replay(socket: WebSocket, since: number | undefined): Promise<void> {
		const stored = await this.#state.storage.list<string>({ prefix: "f:" });
		const keys = [...stored.keys()];
		const oldest = keys.length > 0 ? Number(keys[0].slice(2)) : 0;
		// A resume point older than the last truncation cannot be honoured; send everything held instead.
		const from = since !== undefined && since + 1 >= oldest ? since + 1 : 0;
		for (const [key, value] of stored) {
			if (Number(key.slice(2)) >= from) socket.send(value);
		}
		const stream = await this.#state.storage.get<string>("stream");
		if (stream) socket.send(stream);
		// Last, so a stale "bye" or "status" in the replayed log never outranks the truth.
		socket.send(encodeFrame({ v: 1, type: "host", online: this.#sockets("host").length > 0 }));
	}

	#send(role: "host" | "viewer", payload: string): void {
		for (const socket of this.#sockets(role)) {
			try {
				socket.send(payload);
			} catch {
				// A send throws once the peer is gone or workerd has torn the socket down for
				// outrunning its own send buffer. Either way it affects that viewer alone:
				// webSocketClose reconciles, and the host and the room carry on.
			}
		}
	}

	#broadcastViewerCount(): void {
		this.#send("host", encodeFrame({ v: 1, type: "viewer", count: this.#sockets("viewer").length }));
	}
}
