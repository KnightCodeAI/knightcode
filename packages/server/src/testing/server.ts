import { KnightServer } from "../server.ts";
import type { KnightServerHost, KnightServerOptions } from "../types.ts";
import { TestServerHost } from "./host.ts";

export interface TestServerOptions extends Omit<KnightServerOptions, "serviceId"> {
	host?: KnightServerHost;
	serviceId?: string;
}

export interface TestServer {
	server: KnightServer;
	host: KnightServerHost;
}

/** Create an unstarted KnightServer with deterministic defaults for transport conformance tests. */
export function createTestServer(options: TestServerOptions): TestServer {
	const host = options.host ?? new TestServerHost();
	return {
		server: new KnightServer(host, {
			listeners: options.listeners,
			maxFrameLength: options.maxFrameLength,
			handshakeTimeoutMs: options.handshakeTimeoutMs,
			serviceId: options.serviceId ?? "00000000000000000000000000000001",
			onError: options.onError,
		}),
		host,
	};
}
