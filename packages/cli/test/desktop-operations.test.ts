import { describe, expect, it } from "vitest";
import { DesktopOperations } from "../src/app-server/desktop-operations.ts";
import { AppServerError } from "../src/app-server/errors.ts";

const target = { threadId: "thread", cwd: "/checkout", projectCwd: "/project" };
const commit = { kind: "commitAndPush" as const, message: "message", includeUnstaged: true };

describe("desktop operations", () => {
	it("publishes a confirmed commit before push finishes and retries only push", async () => {
		const operations = new DesktopOperations();
		let commits = 0;
		let pushes = 0;
		const firstPush = Promise.withResolvers<{ remote: string; branch: string }>();
		const startedPush = Promise.withResolvers<void>();
		const run = async (op: Parameters<Parameters<typeof operations.start>[2]>[0]) => {
			await op.step("commit", async () => ({ commit: String(++commits), message: "message" }));
			await op.step("push", () => {
				if (++pushes !== 1) return Promise.resolve({ remote: "origin", branch: "main" });
				startedPush.resolve();
				return firstPush.promise;
			});
		};
		const pending = operations.start(target, commit, run);
		await startedPush.promise;
		const running = operations.read(target.threadId);
		expect(running).toMatchObject({ status: "running", stage: "push", outputs: { commit: "1" } });
		expect(await operations.start(target, commit, run)).toMatchObject({ id: running?.id });
		expect(await operations.start({ ...target, threadId: "other" }, commit, run)).toMatchObject({ status: "refused" });
		firstPush.reject(new AppServerError("gitConflict", "push refused"));
		const partial = await pending;
		expect(partial).toMatchObject({ status: "partial", recovery: "retry", completed: ["commit"] });
		expect(await operations.retry(target, partial.id, run)).toMatchObject({
			accepted: true,
			operation: { status: "completed", completed: ["commit", "push"], outputs: { commit: "1", remote: "origin" } },
		});
		expect([commits, pushes]).toEqual([1, 2]);
	});

	it("never replays a write that did not produce a confirmed response", async () => {
		const operations = new DesktopOperations();
		let writes = 0;
		const run = async (op: Parameters<Parameters<typeof operations.start>[2]>[0]) => {
			await op.step("pr", async () => {
				writes++;
				throw new Error("connection lost");
			});
		};
		const action = { kind: "pullRequest" as const, commitFirst: false };
		const unknown = await operations.start(target, action, run);
		expect(unknown).toMatchObject({ status: "outcome-unknown", recovery: "reconcile" });
		expect(await operations.retry(target, unknown.id, run)).toEqual({ accepted: false, operation: unknown });
		expect(await operations.start(target, action, run)).toEqual(unknown);
		expect(writes).toBe(1);
	});

	it("does not replay a PR whose tool exited without confirming whether it created the PR", async () => {
		const operations = new DesktopOperations();
		const result = await operations.start(target, { kind: "pullRequest", commitFirst: false }, async (op) => {
			await op.step("push", async () => ({ branch: "main", remote: "origin" }));
			await op.step("pr", async () => {
				throw new AppServerError("internal", "gh response lost");
			});
		});
		expect(result).toMatchObject({ status: "outcome-unknown", recovery: "reconcile", completed: ["push"] });
	});

	it("marks a skipped no-change commit as checked so recovery never commits later edits", async () => {
		const operations = new DesktopOperations();
		let commits = 0;
		const run = async (op: Parameters<Parameters<typeof operations.start>[2]>[0]) => {
			await op.step("commit", async () => {
				commits++;
				return undefined;
			});
			await op.step("push", async () => {
				throw new AppServerError("gitConflict", "rejected");
			});
		};
		const action = { kind: "pullRequest" as const, commitFirst: true };
		const failed = await operations.start(target, action, run);
		await operations.retry(target, failed.id, run);
		expect(commits).toBe(1);
		expect(failed).toMatchObject({ status: "partial", completed: ["commit"] });
	});

	it("reports cancellation only before a write and does not discard admitted results", async () => {
		const operations = new DesktopOperations();
		const ready = Promise.withResolvers<void>();
		const pending = operations.start(target, commit, async (op) => {
			await ready.promise;
			await op.step("commit", async () => {
				throw new Error("must not write");
			});
		});
		const id = operations.read(target.threadId)!.id;
		expect(operations.cancel(target, id)).toBe(true);
		ready.resolve();
		expect(await pending).toMatchObject({ status: "cancelled", completed: [] });
	});

	it("retains a failed PR independently of a later commit action", async () => {
		const operations = new DesktopOperations();
		const pr = await operations.start(target, { kind: "pullRequest", commitFirst: false }, async (op) => {
			await op.step("push", async () => ({ branch: "main", remote: "origin" }));
			await op.step("pr", async () => {
				throw new AppServerError("toolMissing", "gh");
			});
		});
		const next = await operations.start(target, commit, async (op) => {
			await op.step("commit", async () => ({ commit: "sha" }));
		});
		expect(next).toMatchObject({ kind: "commitAndPush", status: "completed" });
		expect(operations.read(target.threadId, "pullRequest")).toEqual(pr);
	});

	it("does not accept a retry while another action holds the project", async () => {
		const operations = new DesktopOperations();
		const failed = await operations.start(target, commit, async (op) => {
			await op.step("commit", async () => ({ commit: "sha" }));
			await op.step("push", async () => {
				throw new AppServerError("gitConflict", "refused");
			});
		});
		const release = Promise.withResolvers<void>();
		const busy = operations.start({ ...target, threadId: "other" }, commit, async (op) => {
			await op.step("commit", () => release.promise.then(() => ({ commit: "other" })));
		});
		let pushes = 0;
		expect(
			await operations.retry(target, failed.id, async (op) => {
				await op.step("push", async () => {
					pushes++;
					return {};
				});
			}),
		).toEqual({ accepted: false, operation: failed });
		expect(pushes).toBe(0);
		release.resolve();
		await busy;
	});

	it("keeps pending steps bound to the original checkout", async () => {
		const operations = new DesktopOperations();
		const failed = await operations.start(target, commit, async (op) => {
			await op.step("commit", async () => ({ commit: "sha" }));
			await op.step("push", async () => {
				throw new AppServerError("gitConflict", "refused");
			});
		});
		await expect(
			operations.retry({ ...target, cwd: "/other" }, failed.id, async () => {
				throw new Error("must not run");
			}),
		).resolves.toEqual({ accepted: false });
	});
});
