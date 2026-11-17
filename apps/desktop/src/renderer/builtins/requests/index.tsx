/** Built-in request presenter; the host owns request order, reply mediation and recovery. */
import { defineDesktopExtension } from "@knightcodeai/cli/desktop";
import { ApprovalCard } from "./approval.tsx";
import { DialogCard, QuestionsCard } from "./dialog.tsx";
export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({
		id: "default",
		surface: "requests",
		experimental_render: ({ context }) => {
			const request = context.request;
			if (!request) return null;
			const threadId = request.params.threadId;
			return request.method === "item/toolCall/requestApproval" ? (
				<ApprovalCard threadId={threadId} approval={request} cwd={context.thread?.cwd ?? ""} />
			) : request.method === "ui/dialog" ? (
				<DialogCard threadId={threadId} dialog={request} />
			) : (
				<QuestionsCard threadId={threadId} request={request} />
			);
		},
	});
});
