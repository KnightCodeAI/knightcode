import { KnightServer } from "../server.ts";
import type { KnightServerOptions, KnightServerService } from "../types.ts";
import { TestServerService } from "./service.ts";

export interface TestServerOptions extends Omit<KnightServerOptions, "serviceId"> {
	service?: KnightServerService;
	serviceId?: string;
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
			serviceId: options.serviceId ?? "test-service",
			onError: options.onError,
		}),
		service,
	};
}
