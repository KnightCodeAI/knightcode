import { fauxAssistantMessage, fauxText } from "@knightcode/ai";
import { realpathSync } from "node:fs";
import { startServer } from "../harness.ts";
import { makeRepo } from "./git-repo.ts";

export async function repoServer(files?: Record<string, string>, options?: Parameters<typeof startServer>[0]) {
	const server = await startServer(options);
	makeRepo(server.cwd, files);
	const a = await server.connect("desktop");
	return { ...server, root: realpathSync.native(server.cwd), a };
}
export type RepoServer = Awaited<ReturnType<typeof repoServer>>;

export async function say(s: RepoServer, threadId: string, text = "ok") {
	s.faux.setResponses([fauxAssistantMessage([fauxText(text)])]);
	await s.a.client.request("turn/start", { threadId, text: "hi" });
	await s.a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === threadId);
}

export async function worktreeThread(s: RepoServer, request: object = {}, cwd = s.cwd) {
	const { thread, warnings } = await s.a.client.request("thread/start", {
		cwd,
		workspace: { mode: "worktree", ...request },
	});
	if (thread.workspace.mode !== "worktree") throw new Error("expected a worktree thread");
	return { thread, workspace: thread.workspace, warnings };
}
