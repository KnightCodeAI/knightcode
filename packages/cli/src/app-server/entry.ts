/**
 * `knightcode app-server`: the protocol over stdio (§5.1).
 *
 * stdout carries only protocol lines; everything else goes to stderr. The
 * process exits when stdin closes, after unloading every thread so each lock
 * is released and each extension sees session_shutdown, or after a deadline.
 */

import { parseArgs as parseNodeArgs } from "node:util";
import { ENV_SESSION_DIR, expandTildePath, getAgentDir, VERSION } from "../config.ts";
import { flushRawStdout, takeOverStdout, writeRawStdoutReporting } from "../core/output-guard.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import { normalizePath, resolvePath } from "../utils/paths.ts";
import { accountHandlers } from "./accounts.ts";
import { configureHandlers } from "./configure.ts";
import { type AppServerContext, createAppServerContext } from "./context.ts";
import { modelHandlers } from "./models.ts";
import { pluginHandlers } from "./plugins.ts";
import { AppServer, type Handlers } from "./server.ts";
import { createStdioTransport } from "./stdio.ts";
import { ThreadManager } from "./threads.ts";

/** A turn that ignores abort must not keep the process alive after its client is gone (§5.6). */
const SHUTDOWN_DEADLINE_MS = 10_000;

export function appServerHandlers(ctx: AppServerContext, threads: ThreadManager): Handlers {
	return {
		...threads.handlers(),
		...accountHandlers(ctx),
		...modelHandlers(ctx),
		...configureHandlers(ctx),
		...pluginHandlers(ctx),
	};
}

export async function runAppServer(args: string[]): Promise<void> {
	takeOverStdout();
	// A failed stdout write (EPIPE) is reported through its write callback (writeRawStdoutReporting). The stream
	// also emits it as an error event, which Node would throw as an uncaught exception without a listener.
	process.stdout.on("error", () => {});
	let values: { extension?: string[]; "session-dir"?: string; help?: boolean };
	try {
		({ values } = parseNodeArgs({
			args,
			options: {
				extension: { type: "string", short: "e", multiple: true },
				"session-dir": { type: "string" },
				help: { type: "boolean", short: "h" },
			},
			strict: true,
		}));
	} catch (error) {
		process.stderr.write(`knightcode app-server: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	}
	if (values.help) {
		process.stderr.write(
			"Usage: knightcode app-server [-e <extension>]... [--session-dir <dir>]\n\n" +
				"  -e, --extension <path>   Load a trusted extension in every thread (repeatable)\n" +
				"  --session-dir <dir>      Override session storage and lookup directory\n" +
				"  -h, --help               Show this help on stderr\n\n" +
				"stdout is protocol-only NDJSON. Send initialize then initialized; stdin EOF shuts down the server.\n",
		);
		return;
	}
	const agentDir = getAgentDir();
	const envSessionDir = process.env[ENV_SESSION_DIR];
	const sessionDir =
		(values["session-dir"] ? normalizePath(values["session-dir"]) : undefined) ??
		(envSessionDir ? expandTildePath(envSessionDir) : undefined) ??
		SettingsManager.create(process.cwd(), agentDir, { projectTrusted: false }).getSessionDir();
	const ctx = await createAppServerContext({ agentDir, sessionDir });
	const threads = new ThreadManager(ctx, { extensionPaths: (values.extension ?? []).map((path) => resolvePath(path)) });
	const transport = createStdioTransport(process.stdin, writeRawStdoutReporting);
	// Output closes after the connection answered everything it accepted (Task 7), or on abort.
	const outputClosed = new Promise<void>((resolve) => transport.onClose(resolve));
	let exiting = false;
	const exit = async () => {
		if (exiting) return;
		exiting = true;
		// Hard deadline from the moment shutdown begins. Not unref'd: it must fire even while a stuck turn or
		// a pending asynchronous stdout write is all that keeps the event loop alive. A synchronous write that
		// blocks the loop stops every timer, this one included; stdout writes must therefore be asynchronous
		// (see the unread-stdout test note), never a reason for a second exit path.
		setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS);
		// Reserve the final second for small error responses to accepted, non-cooperative work.
		// Handler completion after this point cannot send a second reply or run a late commit.
		setTimeout(() => connection.settleUnfinishedRequests(), SHUTDOWN_DEADLINE_MS - 1_000);
		// No new work; requests already accepted still get their answers (§5.6).
		connection.endInput();
		ctx.dispose();
		// Unloading cancels starts in preflight and fails loads with shuttingDown, so every accepted request settles.
		await threads.closeAll();
		await outputClosed;
		// After EPIPE there is nobody to flush to; shutdown already ran, so a flush failure changes nothing.
		await flushRawStdout().catch(() => {});
		process.exit(0);
	};
	const connection = new AppServer({
		transport,
		mode: "desktop",
		version: VERSION,
		handlers: appServerHandlers(ctx, threads),
		onInitialized: (c) => ctx.connections.add(c),
		// EOF: the desktop app closed its end or crashed. Its subscriptions go, and shutdown starts.
		onInputEnd: (c) => {
			threads.disconnect(c);
			void exit();
		},
		onClose: (c) => {
			ctx.connections.delete(c);
			threads.disconnect(c);
			void exit();
		},
	});
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.once(signal, () => void exit());
	}
}
