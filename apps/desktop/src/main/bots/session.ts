// The desktop's KnightCode Bots session (spec section 15): the main process holds the long-lived session, encrypted
// with the OS keychain through Electron's safeStorage, and gives the renderer short-lived, scoped connection tickets over
// IPC. The renderer talks to bots.knightcode.dev directly with a ticket; nothing goes through the local app server.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface Keychain {
	isEncryptionAvailable(): boolean;
	encryptString(text: string): Buffer;
	decryptString(data: Buffer): string;
}

export class BotsSession {
	readonly #path: string;
	readonly #keychain: Keychain;
	readonly #origin: string;
	readonly #fetch: typeof fetch;

	constructor(input: { path: string; keychain: Keychain; origin?: string; fetch?: typeof fetch }) {
		this.#path = input.path;
		this.#keychain = input.keychain;
		this.#origin = input.origin ?? "https://bots.knightcode.dev";
		this.#fetch = input.fetch ?? fetch;
	}

	/** Keeps the session token, encrypted; refused when the OS keychain is unavailable (never stored in the clear). */
	save(token: string): void {
		if (!this.#keychain.isEncryptionAvailable())
			throw new Error("The system keychain is not available, so the session is not kept.");
		mkdirSync(dirname(this.#path), { recursive: true });
		writeFileSync(this.#path, this.#keychain.encryptString(token), { mode: 0o600 });
	}

	#token(): string | undefined {
		if (!existsSync(this.#path)) return undefined;
		try {
			return this.#keychain.decryptString(readFileSync(this.#path));
		} catch {
			return undefined;
		}
	}

	get signedIn(): boolean {
		return this.#token() !== undefined;
	}

	signOut(): void {
		rmSync(this.#path, { force: true });
	}

	/** A short-lived ticket for the renderer or the computer link (the ticket IPC handler calls this). */
	async ticket(scope: "socket" | "screen" | "api"): Promise<{ ticket: string; expiresAt: number }> {
		const token = this.#token();
		if (!token) throw new Error("Not signed in to KnightCode Bots.");
		const response = await this.#fetch(`${this.#origin}/api/tickets`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
			body: JSON.stringify({ scope }),
		});
		if (response.status === 401) {
			this.signOut();
			throw new Error("The KnightCode Bots session ended; sign in again.");
		}
		if (!response.ok) throw new Error(`KnightCode Bots answered ${response.status}`);
		return (await response.json()) as { ticket: string; expiresAt: number };
	}
}
