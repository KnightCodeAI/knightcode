// Realtime frames between a client and the Worker over one WebSocket, plus the socket shape both ends use.
import { assertValidOp, type Op } from "@knightcode/chord/delta";
import { type Static, type TProperties, Type } from "typebox";
import {
	ApprovalSchema,
	BotSchema,
	ComputerStateSchema,
	ConversationViewSchema,
	GroupSchema,
	InboxItemSchema,
} from "./entities.ts";
import { ProtocolError, parse } from "./validate.ts";

/** The part of a WebSocket both the browser and the fake backend provide. The root config has no DOM types. */
export interface WebSocketLike {
	readonly readyState: number;
	send(data: string): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: "open" | "close" | "error", listener: () => void): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	removeEventListener(type: "open" | "close" | "error", listener: () => void): void;
	removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

const Id = Type.String({ minLength: 1 });

/** A frame about one thread: exactly one of `botId` (a bot's chat) or `groupId` (a group chat). */
const threaded = <T extends string, P extends TProperties>(type: T, properties: P) =>
	Type.Union([
		Type.Object({ type: Type.Literal(type), botId: Id, ...properties }, { additionalProperties: false }),
		Type.Object({ type: Type.Literal(type), groupId: Id, ...properties }, { additionalProperties: false }),
	]);

const plain = <T extends string, P extends TProperties>(type: T, properties: P) =>
	Type.Object({ type: Type.Literal(type), ...properties }, { additionalProperties: false });

export const ClientFrameSchema = Type.Union([
	/** The first frame on every socket: a short-lived ticket. */
	plain("auth", { ticket: Type.String() }),
	/** `since` resumes from a version the client already holds, so a dropped stream continues without gaps. */
	threaded("subscribe", { since: Type.Optional(Type.Number()) }),
	threaded("unsubscribe", {}),
	/** Sent while a run is going, it steers that run. */
	threaded("submit", {
		text: Type.String({ maxLength: 100_000 }),
		requestId: Id,
		attachments: Type.Optional(Type.Array(Id)),
		replyTo: Type.Optional(Id),
		quote: Type.Optional(Type.String()),
	}),
	threaded("stop", {}),
	/** Answers a question card. */
	threaded("answer", { entryId: Id, requestId: Id, value: Type.String() }),
]);
export type ClientFrame = Static<typeof ClientFrameSchema>;

// Ops are checked structurally by Chord after the schema accepts the frame.
const OpsSchema = Type.Array(Type.Unsafe<Op>(Type.Array(Type.Unknown(), { minItems: 1 })));

export const ServerEventSchema = Type.Union([
	Type.Object({ kind: Type.Literal("bot"), bot: BotSchema }),
	Type.Object({ kind: Type.Literal("bot-removed"), botId: Id }),
	Type.Object({ kind: Type.Literal("group"), group: GroupSchema }),
	Type.Object({ kind: Type.Literal("inbox"), item: InboxItemSchema }),
	Type.Object({ kind: Type.Literal("approval"), approval: ApprovalSchema }),
	Type.Object({ kind: Type.Literal("computer"), state: ComputerStateSchema }),
]);
export type ServerEvent = Static<typeof ServerEventSchema>;

export const ServerFrameSchema = Type.Union([
	plain("ready", { accountId: Id }),
	/** A full snapshot of a thread at `version`. */
	threaded("view", { version: Type.Number(), view: ConversationViewSchema }),
	/** Chord delta ops that move the thread from `version - 1` to `version`. */
	threaded("ops", { version: Type.Number(), ops: OpsSchema }),
	plain("event", { event: ServerEventSchema }),
	plain("error", { code: Type.String(), message: Type.String(), requestId: Type.Optional(Id) }),
]);
export type ServerFrame = Static<typeof ServerFrameSchema>;

export type Frame = ClientFrame | ServerFrame;
const FrameSchema = Type.Union([ClientFrameSchema, ServerFrameSchema]);

/** Serializes a frame for the wire. */
export function encodeFrame(frame: Frame): string {
	return JSON.stringify(frame);
}

/** Parses and checks one wire frame from either side; throws `ProtocolError` on anything else. */
export function decodeFrame(text: string): Frame {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new ProtocolError("", "frame is not valid JSON");
	}
	const frame = parse(FrameSchema, value);
	if (frame.type === "ops")
		frame.ops.forEach((op, index) => {
			try {
				assertValidOp(op);
			} catch (error) {
				throw new ProtocolError(`/ops/${index}`, error instanceof Error ? error.message : "invalid op");
			}
		});
	return frame;
}
