/**
 * Runs the ACP adapter over stdio.
 *
 * stdout is the protocol channel and nothing else may write to it. Anything
 * an extension logs goes to stderr, which the editor shows in its agent
 * log. Without `--connect` the adapter starts an engine in-process, as the
 * standalone binary would, and talks to it over loopback; with it, the
 * adapter attaches to the engine the IDE already runs, with the launch
 * token from `KNIGHTCODE_ENGINE_TOKEN` — never from argv, where any process
 * on the machine could read it.
 */

import { randomBytes } from "node:crypto";
import { ndJsonStream, type Stream } from "@agentclientprotocol/sdk";
import { VERSION } from "../../config.ts";
import { createEngineContext } from "../context.ts";
import { bypassProxyForLoopback } from "../proxy.ts";
import { engineRoutes } from "../routes.ts";
import { startEngineServer } from "../server.ts";
import { createSessionRegistry } from "../sessions.ts";
import { createAcpAgent } from "./agent.ts";
import { createEngineClient } from "./engine-client.ts";

export interface RunAcpOptions {
	connect?: string;
	token?: string;
	version?: string;
}

export function parseAcpArgs(argv: readonly string[]): RunAcpOptions {
	const options: RunAcpOptions = { token: process.env.KNIGHTCODE_ENGINE_TOKEN };
	for (let index = 0; index < argv.length; index++) {
		if (argv[index] === "--connect") options.connect = argv[++index];
	}
	return options;
}

function stdioStream(): Stream {
	const output = new WritableStream<Uint8Array>({
		write: (chunk) =>
			new Promise<void>((resolve, reject) => {
				process.stdout.write(chunk, (error) => (error ? reject(error) : resolve()));
			}),
	});
	const input = new ReadableStream<Uint8Array>({
		start(controller) {
			process.stdin.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
			process.stdin.on("end", () => controller.close());
			process.stdin.on("error", (error) => controller.error(error));
		},
	});
	return ndJsonStream(output, input);
}

export async function runAcp(argv: readonly string[]): Promise<void> {
	const options = parseAcpArgs(argv);

	// A stray console.log from an extension would corrupt the JSON-RPC stream.
	console.log = console.error.bind(console);
	console.info = console.error.bind(console);
	console.debug = console.error.bind(console);
	bypassProxyForLoopback();

	let baseUrl = options.connect;
	let token = options.token;
	let stopEngine: () => Promise<void> = async () => {};
	if (baseUrl === undefined) {
		token = randomBytes(24).toString("hex");
		const ctx = await createEngineContext({ allowModelNetwork: true });
		const sessions = createSessionRegistry(ctx);
		const server = await startEngineServer({ token, routes: engineRoutes(ctx, sessions) });
		baseUrl = `http://127.0.0.1:${server.port}`;
		stopEngine = async () => {
			await sessions.closeAll();
			await server.close();
		};
	} else if (!token) {
		throw new Error("KNIGHTCODE_ENGINE_TOKEN must be set when connecting to a running engine");
	}

	const engine = createEngineClient({ baseUrl, token });
	const connection = createAcpAgent(engine, { version: options.version ?? VERSION }).connect(stdioStream());
	const stop = () => connection.close();
	process.stdin.once("end", stop);
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	process.stdin.resume();
	await connection.closed;
	await stopEngine();
}
