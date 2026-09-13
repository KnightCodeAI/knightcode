/**
 * Engine HTTP server.
 *
 * Binds loopback on an ephemeral port. Every route except `/health` requires the
 * launch token the IDE generates and passes to the engine at spawn: any process
 * on the machine can reach a loopback port, and the token is what stops one
 * spending the user's subscription. The Host check is defence against DNS
 * rebinding, where a hostile page resolves a name to 127.0.0.1 and talks to us
 * from the browser.
 */

import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface EngineRoute {
	method: string;
	path: string;
	/** When true, `path` matches as a prefix and the handler reads the remainder from `url`. */
	prefix?: boolean;
	handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> | void;
}

export interface EngineServer {
	port: number;
	close(): Promise<void>;
}

export interface StartEngineServerOptions {
	token: string;
	routes: readonly EngineRoute[];
	host?: string;
	/** `0` or absent: ephemeral. A pinned port that cannot be bound rejects. */
	port?: number;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
	res.end(payload);
}

/**
 * Constant-time compare over a fixed width, so a wrong token of a different
 * length costs the same as a wrong token of the same length.
 */
function tokenMatches(presented: string, expected: string): boolean {
	const a = Buffer.from(presented, "utf8");
	const b = Buffer.from(expected, "utf8");
	const width = Math.max(a.length, b.length);
	const padded = (source: Buffer) => {
		const out = Buffer.alloc(width);
		source.copy(out);
		return out;
	};
	const equalBytes = timingSafeEqual(padded(a), padded(b));
	return equalBytes && a.length === b.length;
}

function hostIsLoopback(header: string | undefined): boolean {
	if (!header) return false;
	const withoutPort = header.startsWith("[") ? header.slice(0, header.indexOf("]") + 1) : header.split(":")[0];
	return LOOPBACK_HOSTS.has(withoutPort);
}

function bearerToken(header: string | undefined): string | undefined {
	if (!header) return undefined;
	const separator = header.indexOf(" ");
	if (separator < 0) return undefined;
	if (header.slice(0, separator).toLowerCase() !== "bearer") return undefined;
	const value = header.slice(separator + 1).trim();
	return value.length > 0 ? value : undefined;
}

export function startEngineServer(options: StartEngineServerOptions): Promise<EngineServer> {
	const host = options.host ?? "127.0.0.1";

	async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = new URL(req.url ?? "/", `http://${host}`);

		// The IDE polls /health before it can prove anything, so it is the one
		// unauthenticated route. It reveals only that the engine is listening.
		if (req.method === "GET" && url.pathname === "/health") {
			sendJson(res, 200, { status: "ok" });
			return;
		}

		if (!hostIsLoopback(req.headers.host)) {
			sendJson(res, 403, { error: "forbidden" });
			return;
		}

		const presented = bearerToken(req.headers.authorization);
		if (presented === undefined || !tokenMatches(presented, options.token)) {
			sendJson(res, 401, { error: "unauthorized" });
			return;
		}

		const route = options.routes.find(
			(entry) =>
				entry.method === req.method &&
				(entry.prefix ? url.pathname.startsWith(`${entry.path}/`) : entry.path === url.pathname),
		);
		if (!route) {
			sendJson(res, 404, { error: "not_found" });
			return;
		}

		await route.handle(req, res, url);
	}

	const server: Server = createServer((req, res) => {
		dispatch(req, res).catch((error: unknown) => {
			if (res.headersSent) res.end();
			else sendJson(res, 500, { error: "internal", message: error instanceof Error ? error.message : String(error) });
		});
	});

	return new Promise((resolve, reject) => {
		const onError = (error: Error) => reject(error);
		server.once("error", onError);
		server.listen(options.port ?? 0, host, () => {
			server.off("error", onError);
			const address = server.address() as AddressInfo;
			resolve({
				port: address.port,
				close: () =>
					new Promise<void>((done, fail) => {
						server.close((error) => (error ? fail(error) : done()));
					}),
			});
		});
	});
}
