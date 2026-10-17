import { randomUUID } from "node:crypto";
import type { TurnStartResult } from "@knightcode/app-server-protocol";
import { AppServerError } from "./errors.ts";
import type { LoadedThread } from "./loaded-thread.ts";

/** One start across command dispatch and session replacement. The first acceptance wins. */
export class StartRequest {
	readonly controller = new AbortController();
	readonly requestId: string;
	owner: LoadedThread;
	disposition?: TurnStartResult["status"];
	constructor(owner: LoadedThread, requestId?: string) {
		this.owner = owner;
		this.requestId = requestId ?? randomUUID();
	}
	record(disposition: TurnStartResult["status"]): void {
		this.disposition ??= disposition;
	}
	result(): TurnStartResult {
		if (!this.disposition)
			throw new AppServerError("internal", "Start request ended without an acceptance disposition");
		return { status: this.disposition, threadId: this.owner.id, requestId: this.requestId };
	}
}
