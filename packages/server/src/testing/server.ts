import { KnightServer } from "../server.ts";
import type { KnightServerOptions, KnightServerService } from "../types.ts";
import { TestServerService } from "./service.ts";

export interface TestServerOptions extends KnightServerOptions {
	service?: KnightServerService;
}

export interface TestServer {
	server: KnightServer;
	service: KnightServerService;
}

/** Create an unstarted KnightServer with deterministic defaults for transport conformance tests. */
export function createTestServer(options: TestServerOptions): TestServer {
	const service = options.service ?? new TestServerService();
	return {
		server: new KnightServer(service, {
			listeners: options.listeners,
			maxFrameLength: options.maxFrameLength,
			handshakeTimeoutMs: options.handshakeTimeoutMs,
			serverId: options.serverId,
			onError: options.onError,
		}),
		service,
	};
}
