import { fauxAssistantMessage, fauxText } from "@knightcode/ai";
import { afterEach, expect, test, vi } from "vitest";
import { readTurns } from "../../src/app-server/transcript.ts";
import { BACKGROUND_SHELL_MESSAGE_TYPE } from "../../src/core/background-shells.ts";
import type { SessionEntry } from "../../src/core/session-manager.ts";
import { OutputAccumulator } from "../../src/core/tools/output-accumulator.ts";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(async () => {
	await cleanupServers();
});

let n = 0;
const entry = (fields: Record<string, unknown>): SessionEntry =>
	({ id: `e${n++}`, parentId: null, timestamp: "2026-10-25T00:00:00.000Z", ...fields }) as SessionEntry;

/** A running command handed to a thread's manager, as the bash tool hands one over; `exit` ends it. */
function runningCommand(cwd: string, command: string) {
	let exit!: (code: number) => void;
	const abort = new AbortController();
	const done = new Promise<{ exitCode: number | null }>((resolve, reject) => {
		exit = (exitCode) => resolve({ exitCode });
		abort.signal.addEventListener("abort", () => reject(new Error("aborted")));
	});
	return {
		execution: { toolName: "bash", command, cwd, output: new OutputAccumulator(), done, abort },
		exit: (code: number) => exit(code),
	};
}

test("read back, a backgrounded shell call names its command and a notice carries the ended commands", () => {
	const entries = [
		entry({ type: "message", message: { role: "user", content: [{ type: "text", text: "go" }], timestamp: 0 } }),
		entry({
			type: "message",
			message: {
				role: "assistant",
				content: [
					{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "npm run dev", run_in_background: true } },
				],
				stopReason: "toolUse",
				timestamp: 0,
			},
		}),
		entry({
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: "c1",
				toolName: "bash",
				content: [{ type: "text", text: "Command running in background with ID: ab12cd34." }],
				details: { background: { taskId: "ab12cd34", movedByUser: false } },
				isError: false,
				timestamp: 0,
			},
		}),
		entry({
			type: "custom_message",
			customType: BACKGROUND_SHELL_MESSAGE_TYPE,
			content: "<task-notification>…</task-notification>",
			display: true,
			details: {
				notices: [
					{
						id: "ab12cd34",
						toolName: "bash",
						command: "npm run dev",
						status: "failed",
						exitCode: 1,
						summary: "",
						outputPath: "",
						outputTail: "boom",
					},
					// Session files can hold anything: a notice without a command is left out.
					{ id: "zz", status: "completed" },
				],
			},
		}),
	];
	const [turn] = readTurns("t", entries);
	expect(turn!.items.find((i) => i.type === "toolCall")).toMatchObject({ backgroundShellId: "ab12cd34" });
	expect(turn!.items.find((i) => i.type === "extensionMessage")).toMatchObject({
		extension: BACKGROUND_SHELL_MESSAGE_TYPE,
		backgroundShells: [{ id: "ab12cd34", command: "npm run dev", status: "failed", exitCode: 1, outputTail: "boom" }],
	});
});

test("a thread lists its background commands, sends each change, reads their output and stops them", async () => {
	const { cwd, faux, threads, connect } = await startServer();
	const a = await connect();
	const { thread } = await a.client.request("thread/start", { cwd });
	const manager = threads.get(thread.id).session.backgroundShells;
	expect(await a.client.request("thread/backgroundShells/list", { threadId: thread.id })).toEqual({ shells: [] });

	const dev = runningCommand(cwd, "npm run dev");
	const shell = manager.adopt(dev.execution);
	shell.append(Buffer.from("\x1b[32mready\x1b[0m on :3000\n"));
	const started = await a.waitFor("thread/backgroundShells/updated");
	expect(started).toMatchObject({
		threadId: thread.id,
		shells: [{ id: shell.id, command: "npm run dev", status: "running" }],
	});
	expect((await a.client.request("thread/backgroundShells/list", { threadId: thread.id })).shells).toEqual(
		started.shells,
	);
	// Terminal escapes stay, for a terminal view to draw.
	expect(await a.client.request("thread/backgroundShells/output", { threadId: thread.id, id: shell.id })).toEqual({
		output: "\x1b[32mready\x1b[0m on :3000\n",
	});

	// Stopped by the user, the command is reported to the model without starting a run.
	expect(await a.client.request("thread/backgroundShells/stop", { threadId: thread.id, id: shell.id })).toEqual({
		stopped: true,
	});
	await a.waitFor("thread/backgroundShells/updated", (p) =>
		(p.shells as { status: string }[]).some((s) => s.status === "stopped"),
	);
	expect(await a.client.request("thread/backgroundShells/stop", { threadId: thread.id, id: shell.id })).toEqual({
		stopped: false,
	});
	await expect(
		a.client.request("thread/backgroundShells/output", { threadId: thread.id, id: "missing" }),
	).rejects.toMatchObject({ code: "invalidParams" });

	// One that fails on its own starts a run, whose notice item carries the command.
	faux.setResponses([fauxAssistantMessage([fauxText("The build failed.")])]);
	const build = runningCommand(cwd, "npm run build");
	manager.adopt(build.execution);
	build.exit(2);
	const notice = await a.waitFor("item/completed", (p) => (p.item as { type: string }).type === "extensionMessage");
	expect(notice.item).toMatchObject({
		extension: BACKGROUND_SHELL_MESSAGE_TYPE,
		backgroundShells: [{ command: "npm run build", status: "failed", exitCode: 2 }],
	});
	await a.waitFor("turn/completed");
	// It opens the run it started, in place of a message of the user's, live and read back.
	const turns = await a.readTurns(thread.id);
	expect(notice).toMatchObject({ turnId: turns.at(-1)!.id, index: 0 });
	expect(turns.at(-1)!.items.map((i) => i.type)).toEqual(["extensionMessage", "agentMessage"]);
	await vi.waitFor(() => expect(manager.runningCount()).toBe(0));
});
