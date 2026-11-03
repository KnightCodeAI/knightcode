// "Let bots use this computer" (spec section 14): off by default, confirmed in a native dialog, revocable at any time.
// The app keeps one outbound WebSocket to the cloud (no inbound ports) carrying knightcode-env frames for the bots'
// commands and files, egress proxy frames for home routing, and passkey requests. In every approval mode a bot asks
// before its first command in a session and before it first uses each app; "Allow on this computer" covers the rest
// until removed. Windows has no filesystem sandbox here: the setting says bots act with the user's full access.

import { exec } from "node:child_process";

export const ACCESS_WARNING =
	"Bots will run commands and read and write files on this computer with your full access. There is no sandbox. You can turn this off at any time.";

/** The local decision for one command or app use. */
export class LocalComputerPolicy {
	#sessionsAllowed = new Set<string>();
	#appsAllowed = new Set<string>();
	#everywhere = false;

	/** "ask" the first time in a session and for each new app; "run" once allowed. */
	decide(input: { botId: string; session: string; app?: string }): "ask" | "run" {
		if (this.#everywhere) return "run";
		if (!this.#sessionsAllowed.has(`${input.botId}:${input.session}`)) return "ask";
		if (input.app && !this.#appsAllowed.has(`${input.botId}:${input.app}`)) return "ask";
		return "run";
	}

	/** The user's answer: allow this session (and app), or "Allow on this computer" for everything until removed. */
	allow(input: { botId: string; session: string; app?: string; onThisComputer?: boolean }): void {
		if (input.onThisComputer) this.#everywhere = true;
		this.#sessionsAllowed.add(`${input.botId}:${input.session}`);
		if (input.app) this.#appsAllowed.add(`${input.botId}:${input.app}`);
	}

	/** Removes "Allow on this computer" and every allowance. */
	reset(): void {
		this.#everywhere = false;
		this.#sessionsAllowed.clear();
		this.#appsAllowed.clear();
	}
}

export type ExecAnswer = "allow" | "allow-on-this-computer" | "deny";

/**
 * Answers one command frame from the cloud: asks the owner when the policy says so (native dialog), then runs it.
 * Every command is reported back, so the bot's activity records it.
 */
export async function handleExec(
	frame: { id: string; botId: string; session: string; command: string },
	policy: LocalComputerPolicy,
	deps: {
		ask(input: { botId: string; command: string }): Promise<ExecAnswer>;
		run(command: string): Promise<{ output: string; exitCode: number }>;
	},
): Promise<LinkFrame> {
	if (policy.decide(frame) === "ask") {
		const answer = await deps.ask(frame);
		if (answer === "deny") return { kind: "exec-result", id: frame.id, refused: true };
		policy.allow({ ...frame, onThisComputer: answer === "allow-on-this-computer" });
	}
	try {
		return { kind: "exec-result", id: frame.id, ...(await deps.run(frame.command)) };
	} catch (error) {
		return { kind: "exec-result", id: frame.id, error: error instanceof Error ? error.message : String(error) };
	}
}

/** One frame on the link, in either direction. */
export type LinkFrame =
	| { kind: "auth"; ticket: string }
	| { kind: "exec"; id: string; botId: string; session: string; command: string }
	| { kind: "exec-result"; id: string; output?: string; exitCode?: number; refused?: boolean; error?: string }
	| { kind: "env"; session: string; data: string }
	| { kind: "env-close"; session: string }
	| { kind: "proxy-open"; id: string; host: string; port: number }
	| { kind: "proxy-data"; id: string; data: string }
	| { kind: "proxy-close"; id: string; reason?: string }
	| { kind: "passkey"; id: string; options: unknown }
	| { kind: "passkey-result"; id: string; result?: unknown; error?: string };

export interface LinkSettings {
	enabled: boolean;
}

export interface LinkDeps {
	settings: { read(): LinkSettings; write(settings: LinkSettings): void };
	/** The native confirmation; true when the user confirms. */
	confirm(message: string): Promise<boolean>;
	/** Opens the outbound socket with a fresh ticket; closing it is how access is revoked. */
	open(): Promise<{ close(): void }>;
}

/** The setting and the socket that goes with it. */
export class ComputerLink {
	readonly #deps: LinkDeps;
	#socket: { close(): void } | undefined;

	constructor(deps: LinkDeps) {
		this.#deps = deps;
	}

	get enabled(): boolean {
		return this.#deps.settings.read().enabled === true;
	}

	/** Turns access on after the native confirmation; false when the user declines. */
	async enable(): Promise<boolean> {
		if (!(await this.#deps.confirm(ACCESS_WARNING))) return false;
		this.#deps.settings.write({ enabled: true });
		this.#socket = await this.#deps.open();
		return true;
	}

	/** Turns access off locally at once: the socket closes, so the cloud sees the computer offline. */
	disable(): void {
		this.#deps.settings.write({ enabled: false });
		this.#socket?.close();
		this.#socket = undefined;
	}

	/** At app start: reconnects only when the user had turned access on. */
	async start(): Promise<void> {
		if (this.enabled && !this.#socket) this.#socket = await this.#deps.open();
	}
}

/** The socket the link needs: the platform WebSocket's shape. */
export interface LinkSocket {
	send(data: string): void;
	close(): void;
	addEventListener(type: "open" | "close", listener: () => void): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/**
 * Opens the outbound link to the account's user object: authenticates with a socket ticket in the first frame, then
 * answers each command through the local policy (asking the owner first when it says so). Other frame kinds (files,
 * home routing, passkeys) are not handled here.
 */
export async function connectComputerLink(input: {
	origin: string;
	accountId: string;
	ticket(): Promise<string>;
	policy: LocalComputerPolicy;
	ask(input: { botId: string; command: string }): Promise<ExecAnswer>;
	run(command: string): Promise<{ output: string; exitCode: number }>;
	socket?: (url: string) => LinkSocket;
}): Promise<{ close(): void }> {
	const url = `${input.origin.replace(/^http/, "ws")}/api/desktop/${encodeURIComponent(input.accountId)}/link`;
	// The ticket first: a socket opened before its listener is attached would never send the auth frame.
	const ticket = await input.ticket();
	const socket = (input.socket ?? ((target) => new WebSocket(target) as unknown as LinkSocket))(url);
	socket.addEventListener("open", () => socket.send(JSON.stringify({ kind: "auth", ticket } satisfies LinkFrame)));
	socket.addEventListener("message", (event) => {
		let frame: LinkFrame;
		try {
			frame = JSON.parse(String(event.data)) as LinkFrame;
		} catch {
			return;
		}
		if (frame.kind !== "exec") return;
		void handleExec(frame, input.policy, input).then((result) => socket.send(JSON.stringify(result)));
	});
	return { close: () => socket.close() };
}

/** Runs one command in the user's own shell, from their home folder; output is stdout then stderr. */
export function runInShell(
	command: string,
	options: { cwd: string; timeoutMs?: number },
): Promise<{ output: string; exitCode: number }> {
	return new Promise((resolve) => {
		exec(
			command,
			{ cwd: options.cwd, timeout: options.timeoutMs ?? 10 * 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
			(error, stdout, stderr) => {
				const code =
					error && typeof (error as { code?: unknown }).code === "number"
						? (error as { code: number }).code
						: error
							? 1
							: 0;
				resolve({ output: `${stdout}${stderr}`, exitCode: code });
			},
		);
	});
}
