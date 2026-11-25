/** Settings › Archived threads: search, filters and the archive grouped by project. */
import {
	type experimental_ArchiveFilter as ArchiveFilter,
	experimental_appearance,
	experimental_Button as Button,
	experimental_controllers,
	experimental_controls,
	experimental_icons,
	experimental_pickerServices,
	experimental_settingsControls,
	experimental_settingsServices as services,
	experimental_shellServices,
	experimental_useThreadList,
	experimental_useUpdate,
	type experimental_SettingsRequests as Requests,
} from "@knightcodeai/cli/desktop";
type Thread = Requests["thread/list"]["result"]["threads"][number];
import { Fragment, type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
	Archive,
	Box,
	Card,
	Check,
	ChevronDown,
	ChevronRight,
	ConfigFields,
	ConfirmDialog,
	Copy,
	DeleteThreadDialog,
	Dialog,
	DialogActions,
	Download,
	ExternalLink,
	Folder,
	IconButton,
	Import,
	KeyRound,
	levelName,
	ListFilter,
	LogIn,
	LogOut,
	Menu,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuTrigger,
	MessageSquare,
	ModelList,
	MoreHorizontal,
	NavRow,
	openFile,
	PageBar,
	PageBody,
	PageHeader,
	Pencil,
	Plus,
	Popover,
	RefreshCw,
	Row,
	ScopeCard,
	SearchField,
	Section,
	Segmented,
	SelectMenu,
	SizeField,
	Spinner,
	SquarePen,
	Switch,
	Tabs,
	Tooltip,
	Trash2,
	useProjectTrust,
} from "./ui.tsx";

/** A filter in a page's bar (Codex's): a select-style button with an icon and the current choice, opening its groups. */
function FilterMenu({
	label,
	icon,
	text,
	className = "",
	groups,
}: {
	label: string;
	icon: ReactNode;
	text: string;
	className?: string;
	groups: {
		value: string;
		onChange: (value: string) => void;
		options: { value: string; label: string; icon?: ReactNode }[];
	}[];
}) {
	return (
		<Menu>
			<MenuTrigger>
				<Button variant="field" toolbar aria-label={label} className={`justify-between px-3 ${className}`}>
					<span className="flex min-w-0 items-center gap-1.5">
						{icon}
						<span className="truncate">{text}</span>
					</span>
					<ChevronDown size={14} className="text-tertiary" />
				</Button>
			</MenuTrigger>
			<MenuContent align="end">
				{groups.map((group, i) => (
					<Fragment key={i}>
						{i > 0 ? <MenuSeparator /> : null}
						<MenuRadioGroup value={group.value} onValueChange={group.onChange}>
							{group.options.map((o) => (
								<MenuRadioItem key={o.value} value={o.value} icon={o.icon}>
									{o.label}
								</MenuRadioItem>
							))}
						</MenuRadioGroup>
					</Fragment>
				))}
			</MenuContent>
		</Menu>
	);
}

const KINDS: { value: ArchiveFilter["kind"]; label: string }[] = [
	{ value: "all", label: "All threads" },
	{ value: "local", label: "Local" },
	{ value: "worktree", label: "Worktree" },
];
const SORTS: { value: ArchiveFilter["sort"]; label: string }[] = [
	{ value: "updated", label: "Updated" },
	{ value: "created", label: "Created" },
	{ value: "name", label: "Alphabetical" },
];

/**
 * Archived threads, as Codex's Archived chats: Delete all beside the title; search, a kind-and-order filter and a
 * project filter in the bar; the threads grouped by project, each with Delete and Unarchive.
 */
export function Archived({ title, children }: { title: string; children?: ReactNode }) {
	const projects = experimental_pickerServices().experimental_useProjects();
	const [threads, setThreads] = useState<Thread[] | undefined>();
	const [filter, setFilter] = useState<ArchiveFilter>({ query: "", kind: "all", sort: "updated", project: "all" });
	const [deleting, setDeleting] = useState<Thread | "all">();
	const load = useCallback(() => {
		services()
			.experimental_listArchived()
			.then(setThreads)
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	}, []);
	// Archiving elsewhere (the sidebar, another window) changes the live list; reread then.
	// Ids only: a status or name change replaces the list, and must not reread the whole archive.
	const live = services().experimental_useLiveThreadIds();
	useEffect(load, [load, live]);
	const change = (patch: Partial<ArchiveFilter>) => setFilter((f) => ({ ...f, ...patch }));
	const groups = services().experimental_filterArchived(threads ?? [], filter, projects);
	const projectText =
		filter.project === "all"
			? "All projects"
			: filter.project === "none"
				? services().experimental_noProject
				: experimental_shellServices().experimental_basename(filter.project);
	return (
		<>
			<PageHeader
				title={title}
				actions={
					threads?.length ? (
						<Button
							variant="soft"
							color="danger"
							size="lg"
							toolbar
							className="text-sm"
							onClick={() => setDeleting("all")}
						>
							<Trash2 size={16} /> Delete all
						</Button>
					) : null
				}
			/>
			<PageBody>
				<PageBar>
					<div className="flex items-center gap-2">
						<div className="min-w-0 flex-1">
							<SearchField
								page
								value={filter.query}
								onChange={(query) => change({ query })}
								placeholder="Search archived threads"
							/>
						</div>
						<FilterMenu
							label="Filter archived threads"
							icon={<ListFilter size={16} />}
							text={KINDS.find((k) => k.value === filter.kind)!.label}
							className="w-36"
							groups={[
								{ value: filter.kind, onChange: (v) => change({ kind: v as ArchiveFilter["kind"] }), options: KINDS },
								{ value: filter.sort, onChange: (v) => change({ sort: v as ArchiveFilter["sort"] }), options: SORTS },
							]}
						/>
						<FilterMenu
							label="Filter archived threads by project"
							icon={<Folder size={16} />}
							text={projectText}
							className="w-44"
							groups={[
								{
									value: filter.project,
									onChange: (v) => change({ project: v }),
									options: [{ value: "all", label: "All projects" }],
								},
								{
									value: filter.project,
									onChange: (v) => change({ project: v }),
									options: [
										...projects.map((p) => ({
											value: p.path,
											label: p.name ?? experimental_shellServices().experimental_basename(p.path),
											icon: <Folder size={16} />,
										})),
										{ value: "none", label: services().experimental_noProject, icon: <MessageSquare size={16} /> },
									],
								},
							]}
						/>
					</div>
				</PageBar>
				{threads === undefined ? <div className="kc-pulse text-tertiary">Loading…</div> : null}
				{threads?.length === 0 ? <div className="text-secondary">No archived threads.</div> : null}
				{threads !== undefined && threads.length > 0 && groups.length === 0 ? (
					<div className="text-secondary">No archived threads match.</div>
				) : null}
				{groups.map(([name, list]) => (
					<Card
						key={name}
						title={
							<span className="flex items-center gap-2">
								<Folder size={16} />
								{name}
							</span>
						}
						aside={
							<span className="text-sm text-secondary">
								{list.length} {list.length === 1 ? "thread" : "threads"}
							</span>
						}
					>
						{list.map((t) => (
							<Row
								key={t.id}
								title={t.name || "Untitled"}
								detail={new Date(t.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
							>
								<IconButton label="Delete archived thread" toolbar onClick={() => setDeleting(t)}>
									<Trash2 size={16} />
								</IconButton>
								<Button variant="soft" toolbar onClick={() => void services().experimental_unarchive(t.id).then(load)}>
									Unarchive
								</Button>
							</Row>
						))}
					</Card>
				))}
				{children}
			</PageBody>
			{deleting === "all" ? (
				<ConfirmDialog
					title="Delete all archived threads?"
					description="This permanently deletes every archived thread."
					confirm="Delete"
					onConfirm={() =>
						void (async () => {
							for (const t of threads ?? []) await services().experimental_deleteThread(t.id);
							load();
						})()
					}
					onClose={() => setDeleting(undefined)}
				/>
			) : deleting ? (
				<DeleteThreadDialog thread={deleting} onDeleted={load} onClose={() => setDeleting(undefined)} />
			) : null}
		</>
	);
}
