// Connects to a running computer's bridge with the real @knightcode/env client, as the Worker does, and prints what
// the daemon's `hello` reports. Usage (from apps/bots): bun computer/test/bridge-check.ts <bridge URL> <token> <bot user>
import { Connection, webSocketTransport } from "@knightcode/env";

const [base, token, user] = process.argv.slice(2);
if (!base || !token || !user) throw new Error("usage: bridge-check.ts <bridge URL> <token> <bot user>");

const connection = new Connection({
	transport: () => {
		// Bun's WebSocket takes headers, as the Worker's fetch upgrade does.
		const socket = new WebSocket(`${base.replace(/^http/, "ws")}/env?user=${user}`, {
			headers: { "x-bridge-token": token },
		} as unknown as string[]);
		return webSocketTransport(socket as unknown as Parameters<typeof webSocketTransport>[0]);
	},
});
const timer = setTimeout(() => {
	console.error("no hello within 30 s");
	process.exit(1);
}, 30_000);
const info = await connection.info();
clearTimeout(timer);
console.log(JSON.stringify({ protocol: info.protocol, version: info.version }));
connection.close();
process.exit(0);
