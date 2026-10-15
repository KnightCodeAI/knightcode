/**
 * The `knightcode app-server` child (desktop-shell.md section 5): spawn, handshake, restart with
 * backoff, quit. Main is its only client; windows reach it through the router.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join, resolve } from "node:path";
import type { Message, ResultOf } from "@knightcode/app-server-protocol";

export interface ServerCommand {
	command: string;
	args: string[];
}

/**
 * Packaged builds run only the bundled binary (S4). An unpackaged build runs the CLI from this
 * checkout under Bun, or the command in KNIGHTCODE_DESKTOP_SERVER.
 */
export function resolveServerCommand(packaged: boolean, appPath: string, resourcesPath: string): ServerCommand {
	if (packaged) {
		const exe = process.platform === "win32" ? "knightcode.exe" : "knightcode";
		return { command: join(resourcesPath, "knightcode", exe), args: ["app-server"] };
	}
	const override = process.env.KNIGHTCODE_DESKTOP_SERVER?.trim();
	if (override) {
		const [command, ...args] = override.split(/\s+/);
		return { command: command!, args: [...args, "app-server"] };
	}
	const cli = resolve(appPath, "../../packages/cli/src/bun/cli.ts");
	return { command: "bun", args: [cli, "app-server"] };
}

export type ServerState = "starting" | "ready" | "restarting" | "failed";
type InitializeResult = ResultOf<"initialize">;

const MAX_EXITS = 5;
const EXIT_WINDOW_MS = 120_000;
const HEALTHY_MS = 60_000;

export interface ServerConnectionOptions {
	command: ServerCommand;
	env: NodeJS.ProcessEnv;
	logsDir: string;
	clientVersion: string;
	onMessage: (message: Message) => void;
	onState: (state: ServerState, message?: string) => void;
	/** In-flight requests failed and subscriptions gone: the process exited unasked. */
	onExit: () => void;
}

export class ServerConnection {
	private readonly options: ServerConnectionOptions;
	private child: ChildProcessWithoutNullStreams | undefined;
	private buffer = "";
	private nextId = 0;
	private readonly own = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
	private exits: number[] = [];
	private delayMs = 500;
	private startedAt = 0;
	private stopping = false;
	private restartTimer: ReturnType<typeof setTimeout> | undefined;
	private log: WriteStream | undefined;
	initializeResult: InitializeResult | undefined;
	state: ServerState = "starting";

	constructor(options: ServerConnectionOptions) {
		this.options = options;
	}

	start(): void {
		this.setState(this.exits.length === 0 ? "starting" : "restarting");
		const { command, args } = this.options.command;
		mkdirSync(this.options.logsDir, { recursive: true });
		// ponytail: one appended log, no rotation yet; section 5.1 asks for 5 MiB x 5 files.
		this.log ??= createWriteStream(join(this.options.logsDir, "app-server.log"), { flags: "a" });
		const child = spawn(command, args, {
			env: { ...this.options.env, KNIGHTCODE_CLIENT: "desktop" },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child = child;
		this.buffer = "";
		this.startedAt = Date.now();
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.read(chunk));
		child.stderr.on("data", (chunk: Buffer) => this.log?.write(chunk));
		child.on("error", (error) => {
			this.log?.write(`spawn failed: ${error.message}\n`);
			this.exited(child);
		});
		child.on("exit", (code, signal) => {
			this.log?.write(`app-server exited: code ${code} signal ${signal}\n`);
			this.exited(child);
		});
		void this.handshake().catch((error: unknown) => {
			this.log?.write(`handshake failed: ${error instanceof Error ? error.message : String(error)}\n`);
			// A live child that refused the handshake would leave the state at starting; its exit restarts it.
			if (this.child === child) child.kill();
		});
	}

	private async handshake(): Promise<void> {
		const result = (await this.request("initialize", {
			clientInfo: { name: "knightcode-desktop", version: this.options.clientVersion },
			capabilities: {},
		})) as InitializeResult;
		this.initializeResult = result;
		this.send({ method: "initialized", params: {} });
		this.setState("ready");
	}

	private read(chunk: string): void {
		this.buffer += chunk;
		let newline = this.buffer.indexOf("\n");
		while (newline !== -1) {
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			newline = this.buffer.indexOf("\n");
			if (!line) continue;
			let message: Message;
			try {
				message = JSON.parse(line) as Message;
			} catch {
				this.log?.write(`unparsable line from app-server: ${line.slice(0, 200)}\n`);
				continue;
			}
			if ("id" in message && !("method" in message) && typeof message.id === "string" && this.own.has(message.id)) {
				const pending = this.own.get(message.id)!;
				this.own.delete(message.id);
				if ("error" in message) pending.reject(new Error(message.error.message));
				else pending.resolve(message.result);
				continue;
			}
			this.options.onMessage(message);
		}
	}

	send(message: Message): void {
		if (!this.child?.stdin.writable) return;
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	/** Main's own requests (`m:` ids); window requests go through the router. */
	request(method: string, params: unknown): Promise<unknown> {
		const id = `m:${this.nextId++}`;
		return new Promise((resolve, reject) => {
			this.own.set(id, { resolve, reject });
			this.send({ id, method, params } as Message);
		});
	}

	private exited(child: ChildProcessWithoutNullStreams): void {
		if (this.child !== child) return;
		this.child = undefined;
		this.initializeResult = undefined;
		for (const pending of this.own.values()) pending.reject(new Error("the app server exited"));
		this.own.clear();
		if (this.stopping) return;
		this.options.onExit();
		const now = Date.now();
		if (now - this.startedAt > HEALTHY_MS) this.delayMs = 500;
		this.exits = [...this.exits.filter((t) => now - t < EXIT_WINDOW_MS), now];
		if (this.exits.length >= MAX_EXITS) {
			this.setState("failed", `The app server exited ${MAX_EXITS} times in two minutes.`);
			return;
		}
		this.setState("restarting");
		const jitter = this.delayMs * (0.8 + Math.random() * 0.4);
		this.restartTimer = setTimeout(() => this.start(), jitter);
		this.delayMs = Math.min(this.delayMs * 2, 20_000);
	}

	/** After the user asked from the failed screen. */
	restart(): void {
		this.exits = [];
		this.delayMs = 500;
		clearTimeout(this.restartTimer);
		if (!this.child) this.start();
	}

	/** Close stdin; the server's own 10 s deadline bounds the wait, then a kill 2 s later (section 5.4). */
	async stop(): Promise<void> {
		this.stopping = true;
		clearTimeout(this.restartTimer);
		const child = this.child;
		if (!child) return;
		const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
		child.stdin.end();
		const timer = setTimeout(() => child.kill(), 12_000);
		await exited;
		clearTimeout(timer);
		this.log?.end();
	}

	private setState(state: ServerState, message?: string): void {
		this.state = state;
		this.options.onState(state, message);
	}
}
