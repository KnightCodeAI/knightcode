// KnightCode Bots in the desktop app (spec section 15): signing in once through the system browser, keeping the
// session in the OS keychain, and handing the renderer short-lived tickets. The browser, once signed in, sends the app
// a one-time code by its knightcode://bots-signin link; the app trades it for a desktop session of its own.
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ComputerLink,
	connectComputerLink,
	type ExecAnswer,
	LocalComputerPolicy,
	runInShell,
} from "./computer-link.ts";
import { BotsSession, type Keychain } from "./session.ts";

export const BOTS_ORIGIN = process.env.KNIGHTCODE_BOTS_ORIGIN ?? "https://bots.knightcode.dev";
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;

export interface BotsStatus {
	signedIn: boolean;
	accountId?: string;
	origin: string;
}

export class DesktopBots {
	readonly #session: BotsSession;
	readonly #accountFile: string;
	readonly #dir: string;
	readonly #openExternal: (url: string) => Promise<void>;
	readonly #fetch: typeof fetch;
	#pending: { state: string; resolve: (status: BotsStatus) => void; reject: (error: Error) => void } | undefined;

	constructor(input: {
		dir: string;
		keychain: Keychain;
		openExternal: (url: string) => Promise<void>;
		fetch?: typeof fetch;
	}) {
		this.#fetch = input.fetch ?? fetch;
		this.#session = new BotsSession({
			path: join(input.dir, "bots-session"),
			keychain: input.keychain,
			origin: BOTS_ORIGIN,
			fetch: this.#fetch,
		});
		this.#accountFile = join(input.dir, "bots-account");
		this.#dir = input.dir;
		this.#openExternal = input.openExternal;
	}

	status(): BotsStatus {
		// Development: the renderer's in-memory fake instead of the real service.
		if (process.env.KNIGHTCODE_BOTS_FAKE === "1") return { signedIn: true, origin: "fake" };
		const accountId =
			this.#session.signedIn && existsSync(this.#accountFile) ? readFileSync(this.#accountFile, "utf8") : undefined;
		return { signedIn: accountId !== undefined, ...(accountId ? { accountId } : {}), origin: BOTS_ORIGIN };
	}

	/** Opens the sign-in in the browser; resolves when its link comes back (or rejects after ten minutes). */
	signIn(): Promise<BotsStatus> {
		this.#pending?.reject(new Error("a newer sign-in started"));
		const state = randomBytes(24).toString("base64url");
		const done = new Promise<BotsStatus>((resolve, reject) => {
			this.#pending = { state, resolve, reject };
			setTimeout(() => {
				if (this.#pending?.state !== state) return;
				this.#pending = undefined;
				reject(new Error("the sign-in was not finished"));
			}, SIGN_IN_TIMEOUT_MS).unref?.();
		});
		void this.#openExternal(`${BOTS_ORIGIN}/auth/desktop?state=${state}`);
		return done;
	}

	/** The browser's link back (knightcode://bots-signin?code=…&state=…): trades the code for a session. */
	async complete(link: string): Promise<void> {
		const url = new URL(link);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		const pending = this.#pending;
		// Only the sign-in this app started: another page cannot sign the app in to someone else's account.
		if (!pending || !code || state !== pending.state) return;
		this.#pending = undefined;
		try {
			const response = await this.#fetch(`${BOTS_ORIGIN}/auth/desktop/exchange`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ code, state }),
			});
			if (!response.ok) throw new Error(`KnightCode Bots answered ${response.status}`);
			const { token, accountId } = (await response.json()) as { token: string; accountId: string };
			this.#session.save(token);
			writeFileSync(this.#accountFile, accountId, { mode: 0o600 });
			pending.resolve(this.status());
		} catch (error) {
			pending.reject(error instanceof Error ? error : new Error(String(error)));
		}
	}

	ticket(scope: "socket" | "screen" | "api") {
		return this.#session.ticket(scope);
	}

	/**
	 * "Let bots use this computer" (spec section 14): off until the user confirms the native warning; the link opens
	 * while it is on and the app is signed in. Commands run in the user's shell from `home`, asking first per session.
	 */
	computerLink(deps: {
		confirm(message: string): Promise<boolean>;
		ask(input: { botId: string; command: string }): Promise<ExecAnswer>;
		home: string;
	}): ComputerLink {
		const file = join(this.#dir, "bots-computer.json");
		const policy = new LocalComputerPolicy();
		this.#computer = new ComputerLink({
			settings: {
				read: () =>
					existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { enabled: boolean }) : { enabled: false },
				write: (settings) => {
					writeFileSync(file, JSON.stringify(settings), { mode: 0o600 });
					if (!settings.enabled) policy.reset();
				},
			},
			confirm: deps.confirm,
			open: async () => {
				const { accountId } = this.status();
				if (!accountId) throw new Error("Sign in to KnightCode Bots first.");
				return connectComputerLink({
					origin: BOTS_ORIGIN,
					accountId,
					ticket: async () => (await this.ticket("socket")).ticket,
					policy,
					ask: deps.ask,
					run: (command) => runInShell(command, { cwd: deps.home }),
				});
			},
		});
		return this.#computer;
	}
	#computer: ComputerLink | undefined;

	signOut(): void {
		// Signed out, bots can no longer reach this computer.
		if (this.#computer?.enabled) this.#computer.disable();
		this.#session.signOut();
		rmSync(this.#accountFile, { force: true });
	}
}

export const isBotsSignInLink = (url: string) => url.startsWith("knightcode://bots-signin");
