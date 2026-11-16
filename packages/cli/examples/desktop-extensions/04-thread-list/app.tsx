/** Alternate thread list: shared rows retain menus, dialogs, unread/status and keyboard activation. */
import {
	defineDesktopExtension,
	experimental_ThreadRow as ThreadRow,
	experimental_useThreadList,
} from "@knightcodeai/cli/desktop";

function ThreadList() {
	const { threads } = experimental_useThreadList();
	return (
		<aside aria-label="Alternate threads" className="thread-list-example">
			<h2>All threads</h2>
			{threads.map((thread) => (
				<ThreadRow key={thread.id} threadId={thread.id} />
			))}
			{threads.length === 0 ? <p>No threads yet.</p> : null}
		</aside>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "list", surface: "threadList", experimental_render: ThreadList });
});
