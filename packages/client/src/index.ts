export { KnightClient } from "./client.ts";
export {
	KnightClientDisposedError,
	KnightDisconnectedError,
	KnightServerError,
	KnightSessionDetachedError,
	KnightSessionOwnershipError,
} from "./errors.ts";
export type { AcquireSessionOptions, KnightSessionHandle, SessionLease, SessionLeaseMode } from "./session-handle.ts";
export type { ByteTransport, ByteTransportFactory, ByteTransportHandlers } from "./transport.ts";
export type {
	ConnectionState,
	ConnectionStateChange,
	CreateSessionOptions,
	ListenerErrorHandler,
	KnightClientOptions,
	Unsubscribe,
} from "./types.ts";
