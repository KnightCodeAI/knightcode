/** Select both providers: group existing threads by workspace and show their explicit navigation breadcrumb. */
import {
	defineDesktopExtension,
	experimental_Content as Content,
	experimental_SurfaceHost as Surface,
	experimental_ThreadRow as ThreadRow,
	experimental_useNavigation,
	experimental_useThreadList,
	type experimental_Thread,
} from "@knightcodeai/cli/desktop";

function WorkspaceThreads() {
	const { threads } = experimental_useThreadList();
	const groups = new Map<string, experimental_Thread[]>();
	for (const thread of threads) {
		const group = groups.get(thread.cwd);
		if (group) group.push(thread);
		else groups.set(thread.cwd, [thread]);
	}
	return (
		<aside aria-label="Workspace threads" className="workspace-sidebar">
			{[...groups].map(([cwd, group]) => (
				<section key={cwd}>
					<h2 title={cwd}>{cwd.replaceAll("\\", "/").split("/").at(-1) || cwd}</h2>
					{group.map((thread) => (
						<ThreadRow key={thread.id} threadId={thread.id} />
					))}
				</section>
			))}
			{threads.length === 0 ? <p>No workspace threads yet.</p> : null}
		</aside>
	);
}

function WorkspaceLayout() {
	const { view, sidebarOpen } = experimental_useNavigation();
	const { threads, projects } = experimental_useThreadList();
	const thread = view.kind === "thread" ? threads.find((entry) => entry.id === view.id) : undefined;
	const cwd = thread?.cwd ?? (view.kind === "new" ? view.cwd : undefined) ?? projects[0]?.path;
	return (
		<div className="workspace-layout">
			<Surface surface="navigation" />
			{sidebarOpen ? <Surface surface="threadList" /> : null}
			<main className="workspace-content">
				<header aria-label="Workspace breadcrumb" className="workspace-breadcrumb">
					<span>{cwd ?? "Choose a workspace"}</span>
					{thread ? (
						<>
							<span aria-hidden="true"> / </span>
							<strong>{thread.name || "Untitled"}</strong>
						</>
					) : null}
				</header>
				<div className="workspace-view">
					<Content />
				</div>
			</main>
		</div>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "layout", surface: "layout", experimental_render: WorkspaceLayout });
	app.experimental_registerProvider({ id: "threads", surface: "threadList", experimental_render: WorkspaceThreads });
});
