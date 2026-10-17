import type { Message } from "@knightcode/app-server-protocol";

/** One connection's message channel. Received messages are unvalidated; `AppServer` checks them. */
export interface Transport {
	send(message: Message): void;
	onMessage(handler: (message: unknown) => void): void;
	/** The peer will send nothing more (stdin EOF). Output stays open until close() (§5.6). */
	onInputEnd(handler: () => void): void;
	onClose(handler: () => void): void;
	/** "drain" (default) delivers what was already sent, then closes; "abort" drops it (§5.9). */
	close(mode?: "drain" | "abort"): void;
}
