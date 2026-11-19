/** Settings › MCP servers: mcp.json servers per scope. */
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

const EXPOSURES: {
	value: Requests["mcp/list"]["result"]["servers"][number]["exposure"];
	label: string;
	description: string;
}[] = [
	{ value: "codemode", label: "Codemode", description: "Called from codemode scripts" },
	{ value: "deferred", label: "On demand", description: "Declared once tool search loads them" },
	{ value: "direct", label: "Direct", description: "Declared to the model like any tool" },
	{ value: "hidden", label: "Hidden", description: "Registered but never reachable" },
];

/** Adds a server to the user's or the project's mcp.json, as `knightcode mcp add` does. */
function AddMcpServerDialog({
	cwd,
	onAdded,
	onClose,
}: {
	cwd: string | undefined;
	onAdded: () => void;
	onClose: () => void;
}) {
	const [name, setName] = useState("");
	const [kind, setKind] = useState<"stdio" | "http">("stdio");
	const [target, setTarget] = useState("");
	const [scope, setScope] = useState<"global" | "project">("global");
	const valid = /^[A-Za-z0-9_-]+$/.test(name) && target.trim() !== "";
	const add = () => {
		// ponytail: the command splits on spaces; arguments with spaces, env and headers are set in mcp.json.
		const [command, ...args] = target.trim().split(/\s+/);
		const config = kind === "http" ? { url: target.trim() } : { command, ...(args.length ? { args } : {}) };
		void services()
			.experimental_request("mcp/add", { scope, ...(scope === "project" ? { cwd } : {}), name, config })
			.then(() => {
				onAdded();
				onClose();
			})
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	};
	return (
		<Dialog title="Add MCP server" onClose={onClose}>
			<div className="flex flex-col items-start gap-3 pt-3">
				<input
					autoFocus
					aria-label="Server name"
					value={name}
					placeholder="Name (letters, digits, - and _)"
					onChange={(e) => setName(e.target.value)}
					className="kc-input"
				/>
				<Segmented
					label="Server type"
					value={kind}
					onChange={setKind}
					options={[
						{ value: "stdio", label: "Command" },
						{ value: "http", label: "URL" },
					]}
				/>
				<input
					aria-label={kind === "http" ? "Server URL" : "Server command"}
					value={target}
					spellCheck={false}
					placeholder={kind === "http" ? "https://example.com/mcp" : "npx -y @modelcontextprotocol/server-everything"}
					onChange={(e) => setTarget(e.target.value)}
					onKeyDown={(e) =>
						valid && experimental_shellServices().experimental_matches(e, "desktop.item.activate") && add()
					}
					className="kc-input font-code text-xs"
				/>
				{cwd ? (
					<Segmented
						label="Save to"
						value={scope}
						onChange={setScope}
						options={[
							{ value: "global", label: "User" },
							{ value: "project", label: "This project" },
						]}
					/>
				) : null}
			</div>
			<DialogActions>
				<Button color="secondary" size="lg" squircle className="px-4" onClick={onClose}>
					Cancel
				</Button>
				<Button variant="solid" size="lg" squircle className="px-4" disabled={!valid} onClick={add}>
					Add server
				</Button>
			</DialogActions>
		</Dialog>
	);
}

/**
 * MCP servers, as Codex's page: the servers of the user's mcp.json and, for a trusted project, its own, each turned on
 * or off and given an exposure where `/mcp` would save it. Sign-in and live status stay with `/mcp` in a thread.
 */
export function McpServers() {
	const [cwd, setCwd] = useState<string>();
	const [trusted, setTrusted] = useProjectTrust(cwd);
	// Tagged with its scope, newest request only: another project's list never shows (or gets acted on) under this one.
	const [loaded, setLoaded] = useState<{ cwd: string | undefined; list: Requests["mcp/list"]["result"] }>();
	const latest = useRef(0);
	const list = loaded && loaded.cwd === cwd ? loaded.list : undefined;
	const [adding, setAdding] = useState(false);
	const [removing, setRemoving] = useState<Requests["mcp/list"]["result"]["servers"][number]>();
	const load = useCallback(() => {
		const request = ++latest.current;
		services()
			.experimental_request("mcp/list", cwd === undefined ? {} : { cwd })
			.then((result) => {
				if (request === latest.current) setLoaded({ cwd, list: result });
			})
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	}, [cwd, trusted]);
	useEffect(load, [load]);
	const run = (request: Promise<unknown>) =>
		void request
			.then(load)
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	const where = cwd === undefined ? {} : { cwd };
	return (
		<>
			<ScopeCard
				cwd={cwd}
				onCwd={setCwd}
				trusted={trusted}
				onTrust={setTrusted}
				detail="A trusted project adds the servers of its .knightcode/mcp.json"
			/>
			<Card
				title="Servers"
				aside={
					<Button variant="soft" toolbar onClick={() => setAdding(true)}>
						<Plus size={16} /> Add server
					</Button>
				}
			>
				{list?.servers.length === 0 ? (
					<Row title="No MCP servers" detail="Add one here, or with knightcode mcp add" />
				) : null}
				{list?.servers.map((server) => (
					<Row
						key={server.name}
						title={
							<span className="flex items-center gap-2">
								{server.name}
								<span className="text-xs font-normal text-tertiary">
									{server.scope === "project" ? "Project" : server.override ? "User, changed by the project" : "User"}
								</span>
							</span>
						}
						detail={
							<>
								<span className="font-code">{server.target}</span>
								{server.description ? <span className="block">{server.description}</span> : null}
							</>
						}
					>
						<SelectMenu
							label={`Exposure of ${server.name}`}
							value={server.exposure}
							onChange={(exposure) =>
								run(services().experimental_request("mcp/update", { ...where, name: server.name, exposure }))
							}
							options={EXPOSURES}
						/>
						<Switch
							label={`Enable ${server.name}`}
							checked={server.enabled}
							onChange={(enabled) =>
								run(services().experimental_request("mcp/update", { ...where, name: server.name, enabled }))
							}
						/>
						<IconButton label={`Remove ${server.name}`} toolbar onClick={() => setRemoving(server)}>
							<Trash2 size={16} />
						</IconButton>
					</Row>
				))}
			</Card>
			{list?.errors.length ? (
				<Card title="Problems">
					{list.errors.map((error) => (
						<Row key={error} title={<span className="font-normal text-danger-text">{error}</span>} />
					))}
				</Card>
			) : null}
			<Card>
				<Row
					title="Sign-in and status"
					detail="Sign in to a server, reconnect it or see its tools with /mcp in a thread"
				/>
				<Row title="mcp.json" detail="Environment variables, headers and OAuth settings are set in the file">
					{list ? (
						<Button variant="soft" toolbar onClick={() => openFile(list.paths.global)}>
							<ExternalLink size={16} /> User file
						</Button>
					) : null}
					{list?.paths.project ? (
						<Button variant="soft" toolbar onClick={() => openFile(list.paths.project!)}>
							<ExternalLink size={16} /> Project file
						</Button>
					) : null}
				</Row>
			</Card>
			{adding ? (
				<AddMcpServerDialog cwd={trusted ? cwd : undefined} onAdded={load} onClose={() => setAdding(false)} />
			) : null}
			{removing ? (
				<ConfirmDialog
					title={`Remove ${removing.name}?`}
					description={`This deletes its entry from ${removing.source}.`}
					confirm="Remove"
					onConfirm={() =>
						run(services().experimental_request("mcp/remove", { ...where, scope: removing.scope, name: removing.name }))
					}
					onClose={() => setRemoving(undefined)}
				/>
			) : null}
		</>
	);
}
