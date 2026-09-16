import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Route = (req: IncomingMessage, res: ServerResponse) => void;

export interface FixtureServer {
	url: string;
	hits: () => number;
	close: () => Promise<void>;
}

/** A local HTTP server on 127.0.0.1; unknown paths answer 404. */
export async function startServer(routes: Record<string, Route>): Promise<FixtureServer> {
	let count = 0;
	const server = createServer((req, res) => {
		count++;
		const route = routes[new URL(req.url ?? "/", "http://fixture").pathname];
		if (route) {
			route(req, res);
		} else {
			res.writeHead(404, { "content-type": "text/plain" });
			res.end("not found");
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `http://127.0.0.1:${port}`,
		hits: () => count,
		// Aborted downloads leave keep-alive sockets open; drop them so close() does not hang.
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

export function html(body: string, head = ""): string {
	return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}
