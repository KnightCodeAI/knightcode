import { KnightServer } from "../server.ts";
import type { KnightServerHost, KnightServerOptions } from "../types.ts";
import { TestServerHost } from "./host.ts";

export interface TestServerOptions extends Omit<KnightServerOptions, "serverId"> {
	host?: KnightServerHost;
	serverId?: string;
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
			serverId: options.serverId ?? "00000000-0000-4000-8000-000000000001",
			onError: options.onError,
		}),
		host,
	};
}
