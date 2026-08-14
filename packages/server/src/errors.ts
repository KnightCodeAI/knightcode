import type { JsonValue, ProtocolErrorCode } from "@knightcode/protocol";

export type KnightServerOperationErrorCode = Extract<
	ProtocolErrorCode,
	"wrong_service" | "session_not_found" | "session_locked" | "server_busy" | "server_draining" | "invalid_request"
>;

export const INTERNAL_SERVER_ERROR_MESSAGE = "Internal server error";

/** A host or lifecycle error that can safely cross the protocol boundary. */
export class KnightServerError extends Error {
	readonly code: KnightServerOperationErrorCode;
	readonly details: JsonValue | undefined;

	constructor(code: KnightServerOperationErrorCode, message: string, details?: JsonValue) {
		super(message);
		this.name = "KnightServerError";
		this.code = code;
		this.details = details;
	}
}

export class WrongServiceError extends KnightServerError {
	constructor() {
		super("wrong_service", "Request was addressed to another service");
		this.name = "WrongServiceError";
	}
}

export class SessionLockedError extends KnightServerError {
	constructor(message = "Session is locked", details?: JsonValue) {
		super("session_locked", message, details);
		this.name = "SessionLockedError";
	}
}

export class SessionNotFoundError extends KnightServerError {
	constructor(message = "Session was not found", details?: JsonValue) {
		super("session_not_found", message, details);
		this.name = "SessionNotFoundError";
	}
}

export class ServerBusyError extends KnightServerError {
	constructor(message = "Server is busy", details?: JsonValue) {
		super("server_busy", message, details);
		this.name = "ServerBusyError";
	}
}

export class ServerDrainingError extends KnightServerError {
	constructor() {
		super("server_draining", "Server is draining");
		this.name = "ServerDrainingError";
	}
}

/** An unsafe failure whose cause is retained for reporting but never serialized. */
export class InternalServerError extends Error {
	constructor(cause: unknown) {
		super(INTERNAL_SERVER_ERROR_MESSAGE, { cause });
		this.name = "InternalServerError";
	}
}
