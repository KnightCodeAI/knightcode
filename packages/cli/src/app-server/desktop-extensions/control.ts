/** Authenticated loopback authoring controls for the desktop's already-running app server. */
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { DesktopExtensionRequests, type ResultOf } from "@knightcode/app-server-protocol";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { DesktopExtensionManager } from "./manager.ts";

const Token = Type.String({ pattern: "^[a-f0-9]{64}$" });
const Endpoint = Compile(
	Type.Object(
		{
			port: Type.Integer({ minimum: 1, maximum: 65535 }),
			token: Token,
			pid: Type.Integer({ minimum: 1 }),
		},
		{ additionalProperties: false },
	),
);
const Request = Compile(
	Type.Object(
		{
			token: Token,
			action: Type.Union([Type.Literal("status"), Type.Literal("reload")]),
			cwd: Type.Optional(Type.String({ maxLength: 4096 })),
		},
		{ additionalProperties: false },
	),
);
const Reply = Compile(
	Type.Union([
		Type.Object({ result: DesktopExtensionRequests["desktopExtension/list"].result }, { additionalProperties: false }),
		Type.Object({ error: Type.String() }, { additionalProperties: false }),
	]),
);
export interface DesktopControlStatus {
	servers: (ResultOf<"desktopExtension/list"> & { pid: number })[];
	unavailable: string[];
}

/** Publish a token-protected endpoint; closing removes only this instance's discovery file and sockets. */
export async function startDesktopControl(
	agentDir: string,
	manager: DesktopExtensionManager,
	reload: () => void,
): Promise<() => void> {
	const token = randomBytes(32).toString("hex");
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.on("error", () => {});
		socket.setTimeout(5000, () => socket.destroy());
		socket.setEncoding("utf8");
		let body = "";
		const receive = (chunk: string) => {
			body += chunk;
			if (body.length > 65536) {
				socket.destroy();
				return;
			}
			const end = body.indexOf("\n");
			if (end < 0) return;
			socket.off("data", receive);
			void (async () => {
				// A local TCP peer is still an untrusted wire-input boundary; browser HTTP is not this protocol.
				const request: unknown = JSON.parse(body.slice(0, end));
				if (!Request.Check(request) || request.token !== token)
					throw new Error("Unauthorized desktop control request.");
				if (request.action === "reload") reload();
				socket.end(JSON.stringify({ result: await manager.list(request.cwd) }) + "\n");
			})().catch((error: unknown) =>
				socket.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n"),
			);
		};
		socket.on("data", receive);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			resolve();
		});
	});
	const address = server.address();
	// node:net returns AddressInfo for an IP listener, never a pipe address.
	if (!address || typeof address === "string") throw new Error("Desktop control failed to bind.");
	const directory = join(agentDir, "desktop-control");
	const file = join(directory, `${process.pid}-${randomUUID()}.json`);
	try {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		writeFileSync(file, JSON.stringify({ port: address.port, token, pid: process.pid }), { mode: 0o600, flag: "wx" });
	} catch (error) {
		server.close();
		throw error;
	}
	server.unref();
	return () => {
		server.close();
		for (const socket of sockets) socket.destroy();
		rmSync(file, { force: true });
	};
}

/** Contact existing servers only; direct TCP cannot send a local bearer token through HTTP proxies. */
export async function desktopControls(
	agentDir: string,
	action: "status" | "reload",
	cwd: string,
): Promise<DesktopControlStatus> {
	const directory = join(agentDir, "desktop-control");
	const result: DesktopControlStatus = { servers: [], unavailable: [] };
	for (const file of existsSync(directory)
		? readdirSync(directory)
				.filter((file) => file.endsWith(".json"))
				.sort()
		: []) {
		try {
			// Discovery files and replies remain untrusted filesystem/wire input.
			const endpoint: unknown = JSON.parse(readFileSync(join(directory, file), "utf8"));
			if (!Endpoint.Check(endpoint)) throw new Error("Invalid desktop control record");
			const value = await new Promise<unknown>((resolve, reject) => {
				const socket = createConnection({ host: "127.0.0.1", port: endpoint.port });
				socket.setTimeout(5000, () => socket.destroy(new Error("Desktop control timed out")));
				socket.setEncoding("utf8");
				socket.on("error", reject);
				socket.on("end", () => reject(new Error("Desktop control closed without a reply")));
				socket.on("connect", () => socket.write(JSON.stringify({ token: endpoint.token, action, cwd }) + "\n"));
				let body = "";
				socket.on("data", (chunk: string) => {
					body += chunk;
					if (body.length > 32 * 1024 * 1024) {
						socket.destroy(new Error("Desktop status exceeds 32 MiB"));
						return;
					}
					const end = body.indexOf("\n");
					if (end < 0) return;
					socket.destroy();
					try {
						resolve(JSON.parse(body.slice(0, end)));
					} catch (error) {
						reject(error);
					}
				});
			});
			if (!Reply.Check(value)) throw new Error("Invalid desktop control response");
			if ("error" in value) throw new Error(value.error);
			result.servers.push({ pid: endpoint.pid, ...value.result });
		} catch (error) {
			result.unavailable.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (!result.servers.length)
		throw new Error(
			`No running desktop is reachable. Start KnightCode Desktop with this agent directory.${result.unavailable.length ? `\n${result.unavailable.join("\n")}` : ""}`,
		);
	return result;
}
