/** New Git actions never replay a partial operation with different saved intent. */
import type * as React from "react";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { expect, test, vi } from "vitest";
import type { experimental_Operation, experimental_WorkspaceThread } from "@knightcodeai/cli/desktop";

const state = vi.hoisted(() => ({
	operation: undefined as experimental_Operation | undefined,
	run: vi.fn(async () => undefined),
	recover: vi.fn(async () => undefined),
}));
vi.mock("react", async (original) => ({
	...(await original<typeof React>()),
	useState: (initial: unknown) => [initial, () => {}],
}));
vi.mock("@knightcodeai/cli/desktop", () => ({
	experimental_workspaceServices: () => ({
		experimental_useBranchSuggestion: () => "test/branch",
		experimental_useGit: () => ({
			status: { branch: "main", ahead: 1 },
			operation: state.operation,
			operations: state.operation ? [state.operation] : [],
		}),
		experimental_git: () => ({ experimental_run: state.run, experimental_recover: state.recover }),
	}),
	experimental_controls: () => ({ experimental_Dialog: "section", experimental_Kbd: "kbd" }),
	experimental_icons: () => new Proxy({}, { get: () => "span" }),
	experimental_shellServices: () => ({ experimental_platform: "win32", experimental_matches: () => true }),
	experimental_controllers: () => ({ experimental_notify: () => {} }),
	experimental_Button: "button",
}));
import { CommitSheet, PullRequestSheet } from "../../src/renderer/builtins/workspace/dialogs.tsx";

type Props = {
	children?: ReactNode;
	label?: string;
	onClick?: () => void;
	disabled?: boolean;
	onKeyDown?: (event: { preventDefault(): void }) => void;
};
function find(node: ReactNode, predicate: (element: ReactElement<Props>) => boolean): ReactElement<Props> | undefined {
	for (const child of Children.toArray(node)) {
		if (!isValidElement<Props>(child)) continue;
		if (predicate(child)) return child;
		const result = find(child.props.children, predicate);
		if (result) return result;
	}
}
const thread = { id: "t", name: "test", cwd: "/repo", projectCwd: "/repo" } as experimental_WorkspaceThread;

test("Commit and its keyboard action do not retry a failed push", async () => {
	state.run.mockClear();
	state.recover.mockClear();
	state.operation = {
		id: "op",
		kind: "commitAndPush",
		target: { threadId: "t", cwd: "/repo", projectCwd: "/repo" },
		status: "partial",
		completed: ["commit"],
		outputs: {},
		recovery: "retry",
	};
	const sheet = CommitSheet({ thread, onClose() {} });
	find(sheet, (element) => element.props.label === "Commit")!.props.onClick!();
	find(sheet, (element) => element.type === "textarea")!.props.onKeyDown!({ preventDefault() {} });
	await Promise.resolve();
	expect(state.recover).not.toHaveBeenCalled();
	expect(state.run).not.toHaveBeenCalled();
	expect(find(sheet, (element) => element.props.label === "Commit")!.props.disabled).toBe(true);
});

test("Create draft PR does not retry a saved ready PR request", async () => {
	state.run.mockClear();
	state.recover.mockClear();
	state.operation = {
		id: "pr",
		kind: "pullRequest",
		target: { threadId: "t", cwd: "/repo", projectCwd: "/repo" },
		status: "partial",
		completed: ["push"],
		outputs: {},
		recovery: "retry",
	};
	const sheet = PullRequestSheet({ thread, onClose() {} });
	find(sheet, (element) => element.props.label === "Create draft PR")!.props.onClick!();
	await Promise.resolve();
	expect(state.recover).not.toHaveBeenCalled();
	expect(state.run).not.toHaveBeenCalled();
	expect(find(sheet, (element) => element.props.label === "Create draft PR")!.props.disabled).toBe(true);
});
