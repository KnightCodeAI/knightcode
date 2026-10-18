/**
 * Settings (desktop-shell.md section 9.10). Desktop preferences live in desktop-state.json; the
 * default model and sign-ins go through the app server, so the terminal sees the same choices.
 */

import { Check, ExternalLink, KeyRound, LogIn, LogOut } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { Environment, LoginState, ResultOf } from "@knightcode/app-server-protocol";
import { DESKTOP_KEYBINDINGS } from "../../shared/keybindings.ts";
import { client } from "../client.ts";
import { basename } from "../format.ts";
import { isMac, matches } from "../keys.ts";
import {
	answerLogin,
	cancelLogin,
	errorText,
	logout,
	navigate,
	refreshAccounts,
	selectProjects,
	type SettingsPage,
	selectPreferences,
	setDefaultModel,
	setPreference,
	startLogin,
	toast,
	useStore,
} from "../store.ts";

const PAGES: { page: SettingsPage; label: string }[] = [
	{ page: "general", label: "General" },
	{ page: "appearance", label: "Appearance" },
	{ page: "models", label: "Models & accounts" },
	{ page: "approvals", label: "Approvals" },
	{ page: "worktrees", label: "Worktrees" },
	{ page: "shortcuts", label: "Keyboard shortcuts" },
	{ page: "about", label: "About" },
];

function Row({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-6 border-b border-line py-4 last:border-b-0">
			<div>
				<div>{title}</div>
				{detail ? <div className="text-[13px] text-muted">{detail}</div> : null}
			</div>
			<div className="shrink-0">{children}</div>
		</div>
	);
}

function Segmented<T extends string>({
	value,
	options,
	onChange,
}: {
	value: T;
	options: { value: T; label: string }[];
	onChange: (v: T) => void;
}) {
	return (
		<div className="flex rounded-lg bg-hover p-0.5">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					onClick={() => onChange(o.value)}
					className={`rounded-md px-3 py-1 text-[13px] ${o.value === value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={value}
			onClick={() => onChange(!value)}
			className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-accent" : "bg-line-strong"}`}
		>
			<span
				className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${value ? "left-[18px]" : "left-0.5"}`}
			/>
		</button>
	);
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
	return (
		<section className="mb-6">
			{title ? <h3 className="mb-2 text-[13px] font-medium text-muted">{title}</h3> : null}
			<div className="rounded-xl border border-line bg-sidebar px-4">{children}</div>
		</section>
	);
}

function General() {
	const prefs = useStore(selectPreferences);
	const mod = isMac() ? "⌘" : "Ctrl";
	return (
		<Card>
			<Row title="Send with" detail="The other key adds a new line.">
				<Segmented
					value={prefs.sendKey}
					onChange={(v) => setPreference("sendKey", v)}
					options={[
						{ value: "enter", label: "Enter" },
						{ value: "modEnter", label: `${mod}+Enter` },
					]}
				/>
			</Row>
			<Row title="While a turn runs, Send" detail={`${mod}+Enter does the other.`}>
				<Segmented
					value={prefs.whileRunning}
					onChange={(v) => setPreference("whileRunning", v)}
					options={[
						{ value: "queue", label: "Queues" },
						{ value: "steer", label: "Steers" },
					]}
				/>
			</Row>
		</Card>
	);
}

function Appearance() {
	const prefs = useStore(selectPreferences);
	return (
		<Card>
			<Row title="Theme">
				<Segmented
					value={prefs.theme}
					onChange={(v) => setPreference("theme", v)}
					options={[
						{ value: "system", label: "System" },
						{ value: "light", label: "Light" },
						{ value: "dark", label: "Dark" },
					]}
				/>
			</Row>
		</Card>
	);
}

/** One sign-in flow: links and codes to act on, and the prompt the provider is waiting for. */
export function LoginFlow({ loginId, onDone }: { loginId: string; onDone: () => void }) {
	const login: LoginState | undefined = useStore((s) => s.logins[loginId]);
	const [value, setValue] = useState("");
	useEffect(() => {
		if (login?.status === "complete") onDone();
	}, [login?.status, onDone]);
	if (!login) return <div className="kc-pulse py-3 text-muted">Starting sign-in…</div>;
	const prompt = login.status === "pending" ? login.pendingPrompt : undefined;
	const submit = (answer: string) => {
		setValue("");
		if (prompt) void answerLogin(loginId, answer);
	};
	return (
		<div className="space-y-3 py-3">
			{login.events.map((event, i) => {
				const e = event as {
					type?: string;
					url?: string;
					instructions?: string;
					userCode?: string;
					verificationUri?: string;
					message?: string;
				};
				if (e.type === "auth_url" && e.url)
					return (
						<div key={i} className="space-y-1.5">
							{e.instructions ? <div className="text-muted">{e.instructions}</div> : null}
							<button
								type="button"
								onClick={() => void client.host("host/shell/openExternal", { url: e.url! })}
								className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
							>
								<ExternalLink size={14} /> Open the sign-in page
							</button>
						</div>
					);
				if (e.type === "device_code")
					return (
						<div key={i} className="space-y-1.5">
							<div className="text-muted">Enter this code at the sign-in page:</div>
							<div className="selectable font-code text-xl tracking-widest">{e.userCode}</div>
							{e.verificationUri ? (
								<button
									type="button"
									onClick={() => void client.host("host/shell/openExternal", { url: e.verificationUri! })}
									className="flex items-center gap-2 rounded-lg border border-line-strong px-3 py-1.5 hover:bg-hover"
								>
									<ExternalLink size={14} /> Open {e.verificationUri}
								</button>
							) : null}
						</div>
					);
				return e.message ? (
					<div key={i} className="text-muted">
						{e.message}
					</div>
				) : null;
			})}
			{prompt ? (
				<div className="space-y-2">
					<div>{prompt.prompt.message}</div>
					{prompt.prompt.options ? (
						<div className="space-y-1">
							{prompt.prompt.options.map((o) => (
								<button
									key={o.id}
									type="button"
									onClick={() => submit(o.id)}
									className="block w-full rounded-lg border border-line px-3 py-2 text-left hover:bg-hover"
								>
									<div>{o.label}</div>
									{o.description ? <div className="text-[13px] text-muted">{o.description}</div> : null}
								</button>
							))}
						</div>
					) : (
						<div className="flex gap-2">
							<input
								autoFocus
								type={prompt.prompt.type === "secret" ? "password" : "text"}
								value={value}
								placeholder={prompt.prompt.placeholder}
								onChange={(e) => setValue(e.target.value)}
								onKeyDown={(e) => matches(e, "desktop.composer.send") && submit(value)}
								className="flex-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5 outline-none focus:border-accent"
							/>
							<button
								type="button"
								onClick={() => submit(value)}
								className="rounded-lg bg-accent px-3 py-1.5 font-medium text-on-accent"
							>
								Continue
							</button>
						</div>
					)}
				</div>
			) : null}
			{login.status === "failed" ? (
				<div className="space-y-2">
					<div className="text-danger">{login.error}</div>
					<button type="button" onClick={onDone} className="text-muted underline">
						Dismiss
					</button>
				</div>
			) : null}
			{login.status === "pending" ? (
				<button type="button" onClick={() => void cancelLogin(loginId).then(onDone)} className="text-muted underline">
					Cancel
				</button>
			) : null}
		</div>
	);
}

function Models() {
	const accounts = useStore((s) => s.accounts);
	const models = useStore((s) => s.models);
	const defaultModel = useStore((s) => s.defaultModel);
	const [active, setActive] = useState<{ key: string; loginId?: string } | undefined>();
	useEffect(() => void refreshAccounts(), []);
	const signedIn = new Set(accounts?.accounts.map((a) => `${a.provider}:${a.type}`));
	return (
		<>
			<Card title="Default model">
				<Row title="New threads use" detail="Shared with the terminal (settings.json).">
					<select
						value={defaultModel ?? ""}
						onChange={(e) => {
							const model = models.find((m) => `${m.provider}/${m.id}` === e.target.value);
							if (model) void setDefaultModel(model);
						}}
						className="max-w-64 rounded-lg border border-line-strong bg-surface px-2 py-1.5 outline-none"
					>
						{defaultModel ? null : <option value="">Choose a model</option>}
						{models.map((m) => (
							<option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
								{m.providerName} · {m.name}
							</option>
						))}
					</select>
				</Row>
			</Card>
			<Card title="Accounts">
				{accounts?.accounts.length ? null : <div className="py-4 text-muted">Not signed in to any provider.</div>}
				{accounts?.accounts.map((a) => (
					<Row
						key={`${a.provider}:${a.type}`}
						title={a.providerName}
						detail={a.type === "oauth" ? (a.isSubscription ? "Subscription" : "Signed in") : "API key"}
					>
						<button
							type="button"
							onClick={() => void logout(a.provider)}
							className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-muted hover:bg-hover hover:text-ink"
						>
							<LogOut size={14} /> Sign out
						</button>
					</Row>
				))}
			</Card>
			<Card title="Add an account">
				{accounts?.loginOptions.map((o) => {
					const key = `${o.provider}:${o.type}`;
					const open = active?.key === key;
					return (
						<div key={key} className="border-b border-line last:border-b-0">
							<div className="flex items-center justify-between gap-6 py-3">
								<div>
									<div>{o.providerName}</div>
									<div className="text-[13px] text-muted">{o.label}</div>
								</div>
								{signedIn.has(key) ? (
									<span className="flex items-center gap-1 text-[13px] text-success">
										<Check size={14} /> Signed in
									</span>
								) : open ? null : (
									<button
										type="button"
										onClick={() => {
											setActive({ key });
											void startLogin(o.provider, o.type).then((loginId) =>
												loginId ? setActive({ key, loginId }) : setActive(undefined),
											);
										}}
										className="flex items-center gap-1.5 rounded-lg border border-line-strong px-2.5 py-1 hover:bg-hover"
									>
										{o.type === "api_key" ? <KeyRound size={14} /> : <LogIn size={14} />}{" "}
										{o.type === "api_key" ? "Add key" : "Sign in"}
									</button>
								)}
							</div>
							{open && active.loginId ? (
								<LoginFlow loginId={active.loginId} onDone={() => setActive(undefined)} />
							) : null}
						</div>
					);
				})}
			</Card>
		</>
	);
}

function Approvals() {
	const prefs = useStore(selectPreferences);
	return (
		<Card>
			<Row title="Offer Full access" detail="Lets a thread run commands and edit files without asking.">
				<Toggle value={prefs.allowFullAccess} onChange={(v) => setPreference("allowFullAccess", v)} />
			</Row>
		</Card>
	);
}

type WorktreeSettings = { autoDelete?: boolean; keep?: number; fetchBeforeCreate?: boolean; branchPrefix?: string };
type WorktreeRow = ResultOf<"worktree/list">["worktrees"][number];

/** Worktree settings (settings.json, shared with the terminal), each project's environments, and the managed worktrees. */
function Worktrees() {
	const projects = useStore(selectProjects);
	const [settings, setSettings] = useState<WorktreeSettings>({});
	const [worktrees, setWorktrees] = useState<WorktreeRow[]>([]);
	const [project, setProject] = useState(projects[0]?.path);
	const [environments, setEnvironments] = useState<Environment[]>([]);
	const [trusted, setTrusted] = useState(true);
	const reload = () => {
		void client
			.request("config/read", {})
			.then((r) => setSettings(((r.settings as { worktrees?: WorktreeSettings }).worktrees ?? {}) as WorktreeSettings));
		void client.request("worktree/list", {}).then((r) => setWorktrees(r.worktrees.filter((w) => !w.deleted)));
	};
	useEffect(reload, []);
	useEffect(() => {
		if (!project) return;
		void client
			.request("environment/list", { cwd: project })
			.then((r) => {
				setEnvironments(r.environments);
				setTrusted(r.trusted);
			})
			.catch((e: unknown) => toast(errorText(e)));
	}, [project]);
	const write = (key: keyof WorktreeSettings, value: unknown) =>
		void client
			.request("config/write", { scope: "global", key: `worktrees.${key}`, value })
			.then(() => setSettings((s) => ({ ...s, [key]: value })))
			.catch((e: unknown) => toast(errorText(e)));
	const saveEnvironments = (next: Environment[]) => {
		setEnvironments(next);
		if (project)
			void client
				.request("environment/save", { cwd: project, environments: next.filter((e) => e.name.trim()) })
				.catch((e: unknown) => toast(errorText(e)));
	};
	const field = "rounded-lg border border-line-strong bg-surface px-2 py-1.5 outline-none focus:border-accent";
	return (
		<>
			<Card title="Worktrees">
				<Row title="Branch prefix" detail="Branches made for a worktree's changes start with this.">
					<input
						defaultValue={settings.branchPrefix ?? "kc/"}
						key={settings.branchPrefix}
						onBlur={(e) => e.target.value !== (settings.branchPrefix ?? "kc/") && write("branchPrefix", e.target.value)}
						className={`w-32 ${field}`}
					/>
				</Row>
				<Row
					title="Delete worktrees automatically"
					detail="Archiving a thread deletes its worktree; a snapshot is kept."
				>
					<Toggle value={settings.autoDelete ?? true} onChange={(v) => write("autoDelete", v)} />
				</Row>
				<Row title="Worktrees to keep" detail="The least recently used past this many are deleted.">
					<input
						type="number"
						min={1}
						defaultValue={settings.keep ?? 15}
						key={settings.keep}
						onBlur={(e) => {
							const n = Math.floor(Number(e.target.value));
							if (n >= 1 && n !== (settings.keep ?? 15)) write("keep", n);
						}}
						className={`w-20 ${field}`}
					/>
				</Row>
				<Row title="Fetch before creating" detail="Fetch the base branch's remote before each new worktree.">
					<Toggle value={settings.fetchBeforeCreate ?? false} onChange={(v) => write("fetchBeforeCreate", v)} />
				</Row>
			</Card>
			<Card title="Local environments">
				<Row
					title="Project"
					detail={trusted ? "Setup runs in each new worktree." : "Trust this project to run its setup scripts."}
				>
					<select value={project ?? ""} onChange={(e) => setProject(e.target.value)} className={`max-w-64 ${field}`}>
						{projects.map((p) => (
							<option key={p.path} value={p.path}>
								{basename(p.path)}
							</option>
						))}
					</select>
				</Row>
				{environments.map((env, i) => (
					<div key={i} className="space-y-2 border-b border-line py-4">
						<div className="flex gap-2">
							<input
								defaultValue={env.name}
								placeholder="Name"
								onBlur={(e) =>
									saveEnvironments(environments.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
								}
								className={`flex-1 ${field}`}
							/>
							<button
								type="button"
								onClick={() => saveEnvironments(environments.filter((_, j) => j !== i))}
								className="rounded-lg px-2.5 py-1 text-muted hover:bg-hover hover:text-ink"
							>
								Remove
							</button>
						</div>
						<textarea
							defaultValue={env.setup?.default ?? ""}
							placeholder="Setup script (runs in the new worktree)"
							onBlur={(e) =>
								saveEnvironments(
									environments.map((x, j) => (j === i ? { ...x, setup: { ...x.setup, default: e.target.value } } : x)),
								)
							}
							className={`h-20 w-full resize-y font-code text-[12px] ${field}`}
						/>
					</div>
				))}
				<div className="py-3">
					<button
						type="button"
						disabled={!project}
						onClick={() => setEnvironments([...environments, { name: "" }])}
						className="rounded-lg border border-line-strong px-2.5 py-1 hover:bg-hover"
					>
						Add environment
					</button>
				</div>
			</Card>
			<Card title="Managed worktrees">
				{worktrees.length ? null : <div className="py-4 text-muted">No worktrees.</div>}
				{worktrees.map((w) => (
					<Row
						key={w.path}
						title={`${basename(w.projectCwd)} · ${w.branch ?? w.head?.slice(0, 7) ?? "detached"}`}
						detail={w.path}
					>
						<button
							type="button"
							onClick={() =>
								void client
									.request("worktree/delete", { path: w.path })
									.then(reload)
									.catch((e: unknown) => toast(errorText(e)))
							}
							className="rounded-lg px-2.5 py-1 text-muted hover:bg-hover hover:text-ink"
						>
							Delete
						</button>
					</Row>
				))}
			</Card>
		</>
	);
}

function Shortcuts() {
	const mod = isMac() ? "⌘" : "Ctrl";
	const show = (keys: string) =>
		keys
			.split("+")
			.map((k) =>
				k === "mod"
					? mod
					: k === "arrowleft"
						? "←"
						: k === "arrowright"
							? "→"
							: k === "arrowup"
								? "↑"
								: k === "arrowdown"
									? "↓"
									: k.length === 1
										? k.toUpperCase()
										: k[0]!.toUpperCase() + k.slice(1),
			)
			.join("+");
	return (
		<Card>
			{Object.entries(DESKTOP_KEYBINDINGS).map(([id, binding]) => (
				<Row key={id} title={binding.description}>
					<span className="flex gap-1.5">
						{binding.defaultKeys.map((k) => (
							<kbd
								key={k}
								className="rounded-md border border-line-strong bg-surface px-1.5 py-0.5 font-ui text-[12px] text-muted"
							>
								{show(k)}
							</kbd>
						))}
					</span>
				</Row>
			))}
		</Card>
	);
}

function About() {
	const [info, setInfo] = useState<{ appVersion: string; serverVersion: string; platform: string; logsDir: string }>();
	useEffect(() => void client.host("host/app/info", {}).then(setInfo), []);
	return (
		<Card>
			<Row title="KnightCode desktop">
				<span className="text-muted">{info?.appVersion}</span>
			</Row>
			<Row title="App server">
				<span className="text-muted">{info?.serverVersion}</span>
			</Row>
			<Row title="Logs" detail={info?.logsDir}>
				<button
					type="button"
					onClick={() =>
						info && void client.host("host/shell/showInFolder", { path: `${info.logsDir}/app-server.log` })
					}
					className="rounded-lg border border-line-strong px-2.5 py-1 hover:bg-hover"
				>
					Show logs
				</button>
			</Row>
		</Card>
	);
}

export function Settings({ page }: { page: SettingsPage }) {
	const body = {
		general: <General />,
		appearance: <Appearance />,
		models: <Models />,
		approvals: <Approvals />,
		worktrees: <Worktrees />,
		shortcuts: <Shortcuts />,
		about: <About />,
	}[page];
	return (
		<div className="flex h-full min-w-0 flex-1">
			<nav className="w-56 shrink-0 border-r border-line p-3">
				<div className="px-2.5 pt-1 pb-3 text-[17px] font-semibold">Settings</div>
				{PAGES.map((p) => (
					<button
						key={p.page}
						type="button"
						onClick={() => navigate({ kind: "settings", page: p.page })}
						className={`flex h-[34px] w-full items-center rounded-lg px-2.5 ${p.page === page ? "bg-selected" : "text-muted hover:bg-hover hover:text-ink"}`}
					>
						{p.label}
					</button>
				))}
			</nav>
			<div className="min-w-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-2xl px-8 py-8">
					<h2 className="mb-6 text-xl font-semibold">{PAGES.find((p) => p.page === page)?.label}</h2>
					{body}
				</div>
			</div>
		</div>
	);
}
