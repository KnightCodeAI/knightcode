/** Settings › Worktrees: worktree settings, managed worktrees and local environments. */
import {
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
type Environment = Requests["environment/list"]["result"]["environments"][number];
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

type WorktreeSettings = { autoDelete?: boolean; keep?: number; fetchBeforeCreate?: boolean; branchPrefix?: string };
type WorktreeRow = Requests["worktree/list"]["result"]["worktrees"][number];

/**
 * Worktrees, as Codex's page: General (settings.json, shared with the terminal, then the managed worktrees by project,
 * each with the threads that used it) and Environments (each project's setup scripts).
 */
export function Worktrees() {
	const [tab, setTab] = useState<"general" | "environments">("general");
	return (
		<>
			<PageBar>
				<Tabs
					label="Worktrees settings"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "general", label: "General" },
						{ value: "environments", label: "Environments" },
					]}
				/>
			</PageBar>
			{tab === "general" ? <WorktreeGeneral /> : <Environments />}
		</>
	);
}

function WorktreeGeneral() {
	const threads = experimental_useThreadList().threads;
	const [settings, setSettings] = useState<WorktreeSettings>({});
	const [worktrees, setWorktrees] = useState<WorktreeRow[]>([]);
	const reload = () => {
		void services()
			.experimental_request("config/read", {})
			.then((r) => setSettings(((r.settings as { worktrees?: WorktreeSettings }).worktrees ?? {}) as WorktreeSettings));
		void services()
			.experimental_request("worktree/list", {})
			.then((r) => setWorktrees(r.worktrees.filter((w) => !w.deleted)));
	};
	useEffect(reload, []);
	const write = (key: keyof WorktreeSettings, value: unknown) =>
		void services()
			.experimental_request("config/write", { scope: "global", key: `worktrees.${key}`, value })
			.then(() => setSettings((s) => ({ ...s, [key]: value })))
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	const byProject = new Map<string, WorktreeRow[]>();
	for (const w of worktrees) byProject.set(w.projectCwd, [...(byProject.get(w.projectCwd) ?? []), w]);
	return (
		<>
			<Card>
				<Row title="Branch prefix" detail="Branches made for a worktree's changes start with this">
					<input
						aria-label="Branch prefix"
						defaultValue={settings.branchPrefix ?? "kc/"}
						key={settings.branchPrefix}
						onBlur={(e) => e.target.value !== (settings.branchPrefix ?? "kc/") && write("branchPrefix", e.target.value)}
						className="kc-input w-72 border-line-strong"
					/>
				</Row>
				<Row
					title="Always fetch upstream before creating worktrees"
					detail="Fetch the base branch's remote before each new worktree"
				>
					<Switch
						label="Always fetch upstream before creating worktrees"
						checked={settings.fetchBeforeCreate ?? false}
						onChange={(v) => write("fetchBeforeCreate", v)}
					/>
				</Row>
				<Row
					title="Automatically delete old worktrees"
					detail="Archiving a thread deletes its worktree, and the oldest past the limit are pruned; a snapshot is kept"
				>
					<Switch
						label="Automatically delete old worktrees"
						checked={settings.autoDelete ?? true}
						onChange={(v) => write("autoDelete", v)}
					/>
				</Row>
				<Row title="Auto-delete limit" detail="Number of managed worktrees to keep before older ones are pruned">
					<input
						type="number"
						min={1}
						aria-label="Auto-delete limit"
						defaultValue={settings.keep ?? 15}
						key={settings.keep}
						onBlur={(e) => {
							const n = Math.floor(Number(e.target.value));
							if (n >= 1 && n !== (settings.keep ?? 15)) write("keep", n);
						}}
						className="kc-input h-7 w-24 border-line-strong px-2"
					/>
				</Row>
			</Card>
			{[...byProject].map(([projectCwd, list]) => (
				<Card
					key={projectCwd}
					title={<span className="text-sm">{projectCwd}</span>}
					aside={
						<IconButton label="Refresh" toolbar onClick={reload}>
							<RefreshCw size={16} />
						</IconButton>
					}
				>
					{list.map((w) => {
						const used = w.threadIds.map((id) => threads.find((t) => t.id === id)).filter((t) => t !== undefined);
						return (
							<div key={w.path} className="flex flex-col gap-2 p-3 not-last:border-b not-last:border-line">
								<div className="flex items-start justify-between gap-3">
									<div className="flex min-w-0 flex-col">
										<div className="text-sm font-medium">{w.branch ?? w.head?.slice(0, 7) ?? "Detached"}</div>
										<div className="selectable text-xs [overflow-wrap:anywhere] text-secondary">{w.path}</div>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										{/* The server files a thread started inside a managed worktree under its project. */}
										<Button
											variant="soft"
											toolbar
											onClick={() => experimental_controllers().experimental_showNew(w.path)}
										>
											<SquarePen size={16} /> New thread in this worktree
										</Button>
										<Button
											variant="soft"
											color="danger"
											toolbar
											onClick={() =>
												void services()
													.experimental_request("worktree/delete", { path: w.path })
													.then(reload)
													.catch((e: unknown) =>
														experimental_controllers().experimental_notify(
															services().experimental_errorText(e),
															"error",
														),
													)
											}
										>
											Delete
										</Button>
									</div>
								</div>
								{used.length ? (
									<div className="flex flex-col gap-1">
										<div className="text-xs text-secondary">Known threads</div>
										{used.map((t) => (
											<NavRow
												key={t.id}
												label={t.name || "Untitled"}
												className="text-sm"
												onActivate={() => void experimental_controllers().experimental_openThread(t.id)}
											/>
										))}
									</div>
								) : null}
							</div>
						);
					})}
				</Card>
			))}
		</>
	);
}

/** Each project's local environments: a name and a setup script that runs in every new worktree. */
function Environments() {
	const projects = experimental_pickerServices().experimental_useProjects();
	const [project, setProject] = useState(projects[0]?.path);
	// Rows carry a stable key: the inputs are uncontrolled, so an index key would show a removed row's text in the next.
	const [rows, setRows] = useState<{ key: number; env: Environment }[]>([]);
	const nextKey = useRef(0);
	const keyed = (env: Environment) => ({ key: nextKey.current++, env });
	const [trusted, setTrusted] = useState(true);
	// The project whose rows are showing: nothing saves until they loaded, so one project's scripts never land in another.
	const [loadedFor, setLoadedFor] = useState<string>();
	useEffect(() => {
		setRows([]);
		setLoadedFor(undefined);
		if (!project) return;
		let current = true;
		void services()
			.experimental_request("environment/list", { cwd: project })
			.then((r) => {
				if (!current) return;
				setRows(r.environments.map(keyed));
				setTrusted(r.trusted);
				setLoadedFor(project);
			})
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
		return () => {
			current = false;
		};
	}, [project]);
	const save = (next: { key: number; env: Environment }[]) => {
		if (!project || loadedFor !== project) return;
		setRows(next);
		if (project)
			void services()
				.experimental_request("environment/save", {
					cwd: project,
					environments: next.map((r) => r.env).filter((e) => e.name.trim()),
				})
				.catch((e: unknown) =>
					experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
				);
	};
	return (
		<Card
			title="Local environments"
			aside={
				<Button
					variant="soft"
					toolbar
					disabled={!project || loadedFor !== project}
					onClick={() => setRows([...rows, keyed({ name: "" })])}
				>
					<Plus size={16} /> Add environment
				</Button>
			}
		>
			<Row
				title="Project"
				detail={trusted ? "Setup runs in each new worktree" : "Trust this project to run its setup scripts"}
			>
				<SelectMenu
					label="Project"
					value={project}
					onChange={setProject}
					options={projects.map((p) => ({
						value: p.path,
						label: experimental_shellServices().experimental_basename(p.path),
					}))}
				/>
			</Row>
			{rows.map(({ key, env }, i) => (
				<div
					key={key}
					className="relative flex flex-col gap-2 px-4 py-3 not-last:after:absolute not-last:after:inset-x-4 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-line"
				>
					<div className="flex gap-2">
						<input
							aria-label="Environment name"
							defaultValue={env.name}
							placeholder="Name"
							onBlur={(e) =>
								save(rows.map((x, j) => (j === i ? { key: x.key, env: { ...x.env, name: e.target.value } } : x)))
							}
							className="kc-input h-7 flex-1 border-line-strong px-2"
						/>
						<Button variant="soft" color="danger" toolbar onClick={() => save(rows.filter((_, j) => j !== i))}>
							Remove
						</Button>
					</div>
					<textarea
						aria-label="Setup script"
						defaultValue={env.setup?.default ?? ""}
						placeholder="Setup script (runs in the new worktree)"
						onBlur={(e) =>
							save(
								rows.map((x, j) =>
									j === i ? { key: x.key, env: { ...x.env, setup: { ...x.env.setup, default: e.target.value } } } : x,
								),
							)
						}
						className="kc-input h-20 resize-y py-2 font-code text-xs leading-4 border-line-strong"
					/>
				</div>
			))}
		</Card>
	);
}
