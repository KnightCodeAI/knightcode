/** A protocol client over any transport: tests use it, and Phase D's terminal will. */

import {
	type ClientMethod,
	Item,
	Turn,
	type PayloadRef,
	type WireItem,
	type WireTurn,
	type ParamsOf,
	PROTOCOL_VERSION,
	type RequestId,
	type ResultOf,
	type ServerRequestMethod,
	type ServerRequestParams,
	type ServerRequestResult,
} from "@knightcode/app-server-protocol";
import { Compile } from "typebox/compile";
import { AppServerError } from "./errors.ts";
import type { Transport } from "./transport.ts";

type RequestHandler = (params: unknown) => Promise<unknown>;
const turnValidator = Compile(Turn);
const itemValidator = Compile(Item);

export class AppServerClient {
	private readonly transport: Transport;
	private nextId = 1;
	private closed = false;
	private readonly pending = new Map<RequestId, { resolve(v: unknown): void; reject(e: Error): void }>();
	private readonly notificationHandlers = new Set<(method: string, params: unknown) => void>();
	private readonly requestHandlers = new Map<string, RequestHandler>();

	constructor(transport: Transport) {
		this.transport = transport;
		transport.onMessage((message) => void this.receive(message as Record<string, unknown>));
		transport.onClose(() => {
			this.closed = true;
			for (const p of this.pending.values()) p.reject(new Error("connection closed"));
			this.pending.clear();
		});
	}

	request<M extends ClientMethod>(method: M, params: ParamsOf<M>): Promise<ResultOf<M>> {
		if (this.closed) return Promise.reject(new Error("connection closed"));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve: (v) => resolve(v as ResultOf<M>), reject });
			this.transport.send({ id, method, params });
		});
	}

	notify(method: "initialized", params: Record<string, never>): void {
		this.transport.send({ method, params });
	}

	async initialize(name = "test"): Promise<ResultOf<"initialize">> {
		const result = await this.request("initialize", {
			clientInfo: { name, version: "0" },
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
		});
		this.notify("initialized", {});
		return result;
	}

	onNotification(handler: (method: string, params: unknown) => void): () => void {
		this.notificationHandlers.add(handler);
		return () => this.notificationHandlers.delete(handler);
	}

	onRequest<M extends ServerRequestMethod>(
		method: M,
		handler: (params: ServerRequestParams<M>) => Promise<ServerRequestResult<M>>,
	): void {
		this.requestHandlers.set(method, handler as RequestHandler);
	}

	/** Chunk responses remain dispatchable while referenced snapshots are being reconstructed. */
	async readPayload(ref: PayloadRef): Promise<unknown> {
		if (!Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0)
			throw new AppServerError("internal", "Invalid payload reference length");
		const chunks: Buffer[] = [];
		let offset = 0;
		for (;;) {
			const result = await this.request("payload/read", { id: ref.id, offset });
			if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result.data))
				throw new AppServerError("internal", "Payload chunk is not valid base64");
			const chunk = Buffer.from(result.data, "base64");
			if (chunk.length > 49_152 || offset + chunk.length > ref.byteLength)
				throw new AppServerError("internal", "Payload chunk exceeds its declared length");
			chunks.push(chunk);
			offset += chunk.length;
			if (result.eof) {
				if (offset !== ref.byteLength || result.nextOffset !== undefined)
					throw new AppServerError("internal", "Payload ended at an unexpected offset");
				break;
			}
			if (chunk.length === 0 || result.nextOffset !== offset)
				throw new AppServerError("internal", "Payload chunk made no progress");
		}
		try {
			return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, offset))) as unknown;
		} catch {
			throw new AppServerError("internal", "Payload is not complete UTF-8 JSON; read the thread again");
		}
	}

	async resolveTurn(value: WireTurn): Promise<Turn> {
		const turn: unknown = "payload" in value ? await this.readPayload(value.payload) : value;
		if (!turnValidator.Check(turn)) throw new AppServerError("internal", "Payload does not contain a valid turn");
		const result = turn as Turn;
		if (result.id !== value.id || result.threadId !== value.threadId || result.status !== value.status)
			throw new AppServerError("internal", "Turn payload does not match its reference");
		return result;
	}

	async resolveItem(value: WireItem): Promise<Item> {
		const item: unknown = value.type === "itemReference" ? await this.readPayload(value.payload) : value;
		if (!itemValidator.Check(item)) throw new AppServerError("internal", "Payload does not contain a valid item");
		const result = item as Item;
		if (result.id !== value.id || result.type !== (value.type === "itemReference" ? value.itemType : value.type))
			throw new AppServerError("internal", "Item payload does not match its reference");
		return result;
	}

	close(): void {
		this.transport.close();
	}

	private async receive(message: Record<string, unknown>): Promise<void> {
		const id = message.id as RequestId | undefined;
		const method = message.method as string | undefined;
		if (method !== undefined && id !== undefined) {
			const handler = this.requestHandlers.get(method);
			if (!handler) {
				this.transport.send({ id, error: { code: "methodNotFound", message: method } });
				return;
			}
			try {
				this.transport.send({ id, result: await handler(message.params) });
			} catch (error) {
				this.transport.send({ id, error: { code: "internal", message: String(error) } });
			}
			return;
		}
		if (method !== undefined) {
			for (const handler of this.notificationHandlers) handler(method, message.params);
			return;
		}
		if (id === undefined) return;
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		const error = message.error as { code: string; message: string; data?: unknown } | undefined;
		if (error) pending.reject(new AppServerError(error.code as AppServerError["code"], error.message, error.data));
		else pending.resolve(message.result);
	}
}
