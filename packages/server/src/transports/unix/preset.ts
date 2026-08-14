import { KnightServer } from "../../server.ts";
import type { KnightServerHost } from "../../types.ts";
import { createUnixListener } from "./listener.ts";
import type { UnixServerOptions } from "./types.ts";

/** Compose KnightServer with one Unix-domain socket listener. */
export function createUnixServer(host: KnightServerHost, options: UnixServerOptions): KnightServer {
	const listener = createUnixListener({
		path: options.path,
		mode: options.mode,
		maxFrameLength: options.maxFrameLength,
		maxPendingBytes: options.maxPendingBytes,
		gracefulCloseTimeoutMs: options.gracefulCloseTimeoutMs,
		onError: options.onError,
	});
	return new KnightServer(host, {
		listeners: [listener],
		maxFrameLength: options.maxFrameLength,
		handshakeTimeoutMs: options.handshakeTimeoutMs,
		serviceId: options.serviceId,
		onError: options.onError,
	});
}
