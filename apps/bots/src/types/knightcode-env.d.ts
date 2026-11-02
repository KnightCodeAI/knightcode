// The part of @knightcode/env the Worker uses, for its typecheck only. The package's own source is written against
// Node's Buffer, which the Workers type set does not describe, so tsconfig.check.json (the typecheck only) maps the
// import here. At run time and in the deployed bundle the real module loads (nodejs_compat); test/computer.test.ts
// loads it in the Workers pool.
import type { ExecutionEnv } from "@knightcode/durable/env";

export interface Transport {
	send(frame: Uint8Array): void;
	onFrame(listener: (frame: Uint8Array) => void): void;
	onClose(listener: (reason: string, details?: { code?: string }) => void): void;
	close(): void;
	established?(): void;
	diagnostics?(): string;
	lastActivity?(): number;
}

export interface WebSocketLike {
	binaryType?: string;
	readonly readyState?: number;
	send(data: Uint8Array): void;
	close(code?: number, reason?: string): void;
	addEventListener(type: "open", listener: () => void): void;
	addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
	addEventListener(type: "close", listener: (event: { code?: number; reason?: string }) => void): void;
	addEventListener(type: "error", listener: (event: unknown) => void): void;
}

export declare const MAX_FRAME: number;
export declare function webSocketTransport(socket: WebSocketLike): Transport;

export declare class Connection {
	constructor(options: { transport: () => Transport | Promise<Transport>; onLog?: (text: string) => void });
	close(): void;
}

export declare class RemoteExecutionEnv implements ExecutionEnv {
	constructor(options: { connection: Connection; id: string; cwd: string; shellPath?: string; shellEnv?: Record<string, string> });
}
export interface RemoteExecutionEnv extends ExecutionEnv {}
