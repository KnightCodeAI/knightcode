import type {
	Command,
	ModelMetadata,
	ModelRef,
	SessionMetadata,
	SessionPhase,
	SessionSnapshot,
	ThinkingLevel,
	TranscriptProgress,
} from "@knightcode/protocol";
import type { KnightServerError } from "./errors.ts";
import type { KnightServerListener } from "./listener.ts";

export interface KnightServerOptions {
	listeners: readonly KnightServerListener[];
	maxFrameLength?: number;
	handshakeTimeoutMs?: number;
	serverId?: string;
	onError?: (error: Error) => void;
}

export type MaybePromise<T> = T | Promise<T>;

export type PromptInput = Omit<Extract<Command, { command: "prompt" }>, "command" | "sessionId">;
export type SteerInput = Omit<Extract<Command, { command: "steer" }>, "command" | "sessionId">;

export interface CreateSessionOptions {
	/** A collision-resistant ID assigned by KnightServer. The service must persist this exact ID. */
	id: string;
	cwd?: string;
	name?: string;
	model?: ModelRef;
	thinkingLevel?: ThinkingLevel;
}

export type KnightSessionRuntimeEvent =
	| { type: "snapshot" }
	| { type: "progress"; progress: TranscriptProgress }
	| { type: "error"; error: KnightServerError };

/** One acquired durable session. Conflicting operations must reject rather than queue. */
export interface KnightSessionRuntime {
	snapshot(): MaybePromise<SessionSnapshot>;
	getPhase(): SessionPhase;
	prompt(input: PromptInput): Promise<void>;
	steer(input: SteerInput): Promise<void>;
	abort(): Promise<void>;
	setModel(model: ModelRef): Promise<void>;
	setThinking(thinkingLevel: ThinkingLevel): Promise<void>;
	subscribe(listener: (event: KnightSessionRuntimeEvent) => void): () => void;
	dispose(): Promise<void>;
}

/** Service boundary for durable sessions and exclusively acquired runtimes. */
export interface KnightServerService {
	listSessions(): Promise<SessionMetadata[]>;
	listModels(): Promise<ModelMetadata[]>;
	createSession(options: CreateSessionOptions): Promise<KnightSessionRuntime>;
	openSession(sessionId: string): Promise<KnightSessionRuntime>;
}

export type SessionRuntime = KnightSessionRuntime;
export type SessionRuntimeEvent = KnightSessionRuntimeEvent;
