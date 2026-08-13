import type { JsonValue, ProtocolError, ProtocolErrorCode } from "@knightcode/protocol";

export class KnightServerError extends Error {
	readonly code: ProtocolErrorCode;
	readonly details: JsonValue | undefined;

	constructor(error: ProtocolError) {
		super(error.message);
		this.name = "KnightServerError";
		this.code = error.code;
		this.details = error.details;
	}
}

export class KnightDisconnectedError extends Error {
	constructor(message = "Pi client is disconnected") {
		super(message);
		this.name = "KnightDisconnectedError";
	}
}

export class KnightClientDisposedError extends Error {
	constructor() {
		super("Pi client is disposed");
		this.name = "KnightClientDisposedError";
	}
}

export function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

export function toDisconnectedError(error: unknown): KnightDisconnectedError {
	const cause = toError(error);
	return cause instanceof KnightDisconnectedError ? cause : new KnightDisconnectedError(cause.message);
}
