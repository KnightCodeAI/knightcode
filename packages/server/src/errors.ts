import type { ProtocolErrorCode } from "@knightcode/protocol";

type KnightServerOperationErrorCode = Extract<
	ProtocolErrorCode,
	"wrong_service" | "session_not_found" | "server_draining"
>;

export const INTERNAL_SERVER_ERROR_MESSAGE = "Internal server error";

/** A host or lifecycle error that can safely cross the protocol boundary. */
export class KnightServerError extends Error {
	readonly code: KnightServerOperationErrorCode;

	constructor(code: KnightServerOperationErrorCode, message: string) {
		super(message);
		this.name = "KnightServerError";
		this.code = code;
	}
}

export class WrongServiceError extends KnightServerError {
	constructor() {
		super("wrong_service", "Request was addressed to another service");
		this.name = "WrongServiceError";
	}
}

export class SessionNotFoundError extends KnightServerError {
	constructor(message = "Session was not found") {
		super("session_not_found", message);
		this.name = "SessionNotFoundError";
	}
}

export class ServerDrainingError extends KnightServerError {
	constructor() {
		super("server_draining", "Server is draining");
		this.name = "ServerDrainingError";
	}
}
