// Remote MCP servers in the cloud (spec section 9): Streamable HTTP through the guarded fetch, so the server's address,
// its redirects and its OAuth endpoints are all checked, and the user's token only reaches the server's own origin.
import { type CallToolResult, McpClient, StreamableHttpTransport, type Tool } from "@knightcode/mcp";
import { type FetchPolicy, guardedFetcher } from "./guarded-fetch.ts";

export interface McpConnection {
	url: string;
	/** The user's token for this server (from its OAuth flow or an API key), sent only to its origin. */
	token?: string;
	headers?: Record<string, string>;
}

/** A connected client; close it when done. Calls time out after 60 s. */
export async function connectMcp(connection: McpConnection, policy: FetchPolicy): Promise<McpClient> {
	const client = new McpClient({ name: "knightcode-bots", version: "0.1.0", requestTimeoutMs: 60_000 });
	const transport = new StreamableHttpTransport({
		url: connection.url,
		headers: { ...connection.headers, ...(connection.token ? { authorization: `Bearer ${connection.token}` } : {}) },
		fetch: guardedFetcher(policy),
		// Bots call tools and read the answers; a standing server stream would hold the object open.
		openGetStream: false,
	});
	await client.connect(transport);
	return client;
}

/** The server's tools, connecting and closing around the call. */
export async function listMcpTools(connection: McpConnection, policy: FetchPolicy): Promise<Tool[]> {
	const client = await connectMcp(connection, policy);
	try {
		return await client.listTools();
	} finally {
		await client.close();
	}
}

export async function callMcpTool(
	connection: McpConnection,
	policy: FetchPolicy,
	name: string,
	args: Record<string, unknown>,
): Promise<CallToolResult> {
	const client = await connectMcp(connection, policy);
	try {
		return await client.callTool(name, args);
	} finally {
		await client.close();
	}
}
