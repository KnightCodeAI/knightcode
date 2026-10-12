import type { ErrorCode } from "@knightcode/app-server-protocol";

/** A failure the client can act on; becomes a response error with this code. */
export class AppServerError extends Error {
	readonly code: ErrorCode;
	readonly data?: unknown;

	constructor(code: ErrorCode, message: string, data?: unknown) {
		super(message);
		this.name = "AppServerError";
		this.code = code;
		this.data = data;
	}
}

/** The connection a server request went to closed before answering. */
export class SubscriberGone extends Error {
	constructor() {
		super("the client disconnected");
		this.name = "SubscriberGone";
	}
}
