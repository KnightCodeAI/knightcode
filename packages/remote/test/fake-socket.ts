import type { RelayWebSocket } from "../src/host.ts";

/** In-memory stand-in for the relay socket. Tests drive it with emit() and read what was sent. */
export class FakeSocket implements RelayWebSocket {
	readyState = 1;
	readonly OPEN = 1;
	bufferedAmount = 0;
	sent: string[] = [];
	#listeners = new Map<string, Array<(event: unknown) => void>>();

	send(data: string): void {
		this.sent.push(data);
	}
	close(): void {
		this.readyState = 3;
		this.emit("close", { code: 1000, reason: "" });
	}
	addEventListener(type: string, listener: (event: never) => void): void {
		const existing = this.#listeners.get(type) ?? [];
		existing.push(listener as (event: unknown) => void);
		this.#listeners.set(type, existing);
	}
	removeEventListener(): void {}
	emit(type: string, event: unknown): void {
		for (const listener of this.#listeners.get(type) ?? []) listener(event);
	}
	/** Every frame sent so far, decoded. */
	frames(): Array<Record<string, unknown>> {
		return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
	}
}
