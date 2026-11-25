/** An unanswered start must not rewrite a finished write when the app server dies. */
import type { ResultOf } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
import { DesktopOperationJournal } from "../../src/main/desktop-operation-journal.ts";

const target = { threadId: "t", cwd: "/repo", projectCwd: "/repo" };
const done: ResultOf<"desktopOperation/start">["operation"] = {
	id: "done",
	kind: "push",
	target,
	status: "completed",
	completed: ["push"],
	recovery: "none",
	outputs: { remote: "origin" },
};

test("one completion cannot settle two same-kind starts", () => {
	const journal = new DesktopOperationJournal();
	journal.track("first", "desktopOperation/start", { target, action: { kind: "push" } });
	journal.track("second", "desktopOperation/start", { target, action: { kind: "push" } });
	journal.observe("t", [{ ...done, attemptId: "first" }]);
	journal.lost();
	expect(journal.read("t", [])).toEqual([expect.objectContaining({ id: "unknown:second" })]);
});

test("a crash before observing a start retains a fence", () => {
	const journal = new DesktopOperationJournal();
	journal.track("start", "desktopOperation/start", { target, action: { kind: "push" } });
	journal.lost();
	expect(journal.unknownAt(target)).toMatchObject({ id: "unknown:start", kind: "push", recovery: "reconcile" });
});

test("a crash before observing a retry retains its own fence", () => {
	const journal = new DesktopOperationJournal();
	journal.observe("t", [done]);
	journal.track("retry", "desktopOperation/recover", { target, id: "not-listed", action: "retry" });
	journal.lost();
	const operation = journal.unknownAt(target);
	expect(operation).toMatchObject({ id: "unknown:retry", status: "outcome-unknown", recovery: "reconcile" });
	expect(journal.intercept("desktopOperation/start", { target })).toEqual({ operation });
});

test.each(["start", "retry"])("the final completed observation settles a pending %s before the reply", (action) => {
	const journal = new DesktopOperationJournal();
	if (action === "start") journal.track("req", "desktopOperation/start", { target, action: { kind: "push" } });
	else {
		journal.observe("t", [{ ...done, status: "partial", recovery: "retry" }]);
		journal.track("req", "desktopOperation/recover", { target, id: done.id, action: "retry" });
	}
	journal.observe("t", [{ ...done, attemptId: "req" }]);
	journal.lost();
	expect(journal.read("t", [])).toEqual([]);
});

test("a pending start after a completed write becomes its own unknown, not that write", () => {
	const journal = new DesktopOperationJournal();
	journal.observe("t", [
		{
			id: "done",
			kind: "push",
			target,
			status: "completed",
			completed: ["push"],
			recovery: "none",
			outputs: { remote: "origin" },
		},
	]);
	journal.track("req-1", "desktopOperation/start", { target, action: { kind: "push" } });
	journal.lost();
	const retained = journal.read("t", []);
	expect(retained).toEqual([expect.objectContaining({ id: "unknown:req-1", status: "outcome-unknown", kind: "push" })]);
	expect(retained.some((operation) => operation.id === "done")).toBe(false);
});
