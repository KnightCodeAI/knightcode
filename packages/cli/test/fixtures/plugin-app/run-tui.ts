import { ProcessTerminal } from "@knightcode/tui";
import { SessionClient } from "./client.ts";
import { createCodingAgentPlugins } from "./plugins.ts";
import { TcpClientTransport } from "./transport.ts";
import { MinimalCodingAgentTui } from "./tui/app.ts";

async function main(): Promise<void> {
	const host = process.argv[2] ?? "127.0.0.1";
	const port = Number(process.argv[3] ?? "7777");
	const transport = await TcpClientTransport.connect({ host, port, clientId: "tui" });
	const client = new SessionClient(transport);
	await client.ready;
	const app = new MinimalCodingAgentTui(
		new ProcessTerminal(),
		client,
		createCodingAgentPlugins(async () => []),
	);
	const stop = () => app.stop();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		app.start();
		await app.done;
	} finally {
		// start() puts the terminal in raw mode, so a throw after it must still restore the
		// terminal and drop the signal handlers instead of leaving the process wedged.
		app.stop();
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
	}
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
	process.exitCode = 1;
});
