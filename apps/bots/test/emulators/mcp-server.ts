// A small remote MCP server for tests (Streamable HTTP, JSON responses), standing in for an app's official server.
// It needs a bearer token, as hosted servers do, and offers two issue tools.
import { createServer, type IncomingMessage, type Server } from "node:http";

export const MCP_TEST_TOKEN = "mcp-test-token";

const TOOLS = [
	{
		name: "list_issues",
		description: "List open issues in a repository.",
		inputSchema: { type: "object", properties: { repo: { type: "string" } }, required: ["repo"] },
		annotations: { readOnlyHint: true },
	},
	{
		name: "create_issue",
		description: "Open an issue.",
		inputSchema: {
			type: "object",
			properties: { repo: { type: "string" }, title: { type: "string" } },
			required: ["repo", "title"],
		},
		annotations: { readOnlyHint: false, destructiveHint: false },
	},
];

const read = (request: IncomingMessage) =>
	new Promise<string>((resolve) => {
		let body = "";
		request.on("data", (chunk) => (body += chunk));
		request.on("end", () => resolve(body));
	});

function answer(message: { id?: number | string; method: string; params?: Record<string, unknown> }) {
	switch (message.method) {
		case "initialize":
			return {
				protocolVersion: (message.params?.protocolVersion as string) ?? "2025-06-18",
				capabilities: { tools: {} },
				serverInfo: { name: "test-issues", version: "1.0.0" },
			};
		case "tools/list":
			return { tools: TOOLS };
		case "tools/call": {
			const args = (message.params?.arguments ?? {}) as Record<string, string>;
			if (message.params?.name === "list_issues")
				return { content: [{ type: "text", text: JSON.stringify([{ number: 1, title: `First issue in ${args.repo}` }]) }] };
			return { content: [{ type: "text", text: `Opened "${args.title}" in ${args.repo}` }] };
		}
		case "ping":
			return {};
		default:
			return undefined;
	}
}

export async function startMcpServer(): Promise<{ url: string; close(): Promise<void> }> {
	const server: Server = createServer(async (request, response) => {
		if (request.headers.authorization !== `Bearer ${MCP_TEST_TOKEN}`) {
			response.writeHead(401, { "www-authenticate": 'Bearer realm="test"' }).end();
			return;
		}
		if (request.method !== "POST") {
			response.writeHead(405).end();
			return;
		}
		const message = JSON.parse(await read(request)) as { id?: number | string; method: string; params?: Record<string, unknown> };
		if (message.id === undefined) {
			response.writeHead(202).end();
			return;
		}
		const result = answer(message);
		const body =
			result === undefined
				? { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } }
				: { jsonrpc: "2.0", id: message.id, result };
		response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "test-session" }).end(JSON.stringify(body));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address() as { port: number };
	return {
		url: `http://127.0.0.1:${address.port}/mcp`,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
