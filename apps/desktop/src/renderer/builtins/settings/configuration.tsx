/** Settings › Configuration and Tools: settings.json fields, scope and trust, tools.json tools. */
import {
	type experimental_ConfigFile as ConfigFile,
	type experimental_SettingsField as SettingsField,
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

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

const CONFIGURATION: [string, SettingsField[]][] = [
	[
		"Model",
		[
			{
				key: "defaultThinkingLevel",
				title: "Default reasoning",
				detail: "Where new threads start, unless a model has its own level below",
				kind: "select",
				options: THINKING_LEVELS.map((level) => [level, levelName(level)]),
				fallback: "medium",
			},
		],
	],
	[
		"Context",
		[
			{
				key: "compaction.enabled",
				title: "Auto-compact",
				detail: "Summarize earlier conversation when a thread nears the model's context window",
				kind: "switch",
			},
			{
				key: "compaction.reserveTokens",
				title: "Reserved tokens",
				detail: "Room kept for the prompt and the response; compaction starts when less is left",
				kind: "number",
				min: 0,
				max: 1_000_000,
				unit: "tokens",
			},
			{
				key: "compaction.keepRecentTokens",
				title: "Recent tokens kept",
				detail: "The latest conversation kept word for word after compacting",
				kind: "number",
				min: 0,
				max: 1_000_000,
				unit: "tokens",
			},
		],
	],
	[
		"Messages",
		[
			{
				key: "steeringMode",
				title: "Steering",
				detail: "Messages steered into a running turn reach it one per response, or all at once",
				kind: "select",
				options: [
					["one-at-a-time", "One at a time"],
					["all", "All at once"],
				],
			},
			{
				key: "enableSkillCommands",
				title: "Skill commands",
				detail: "Offer each skill as /skill:name",
				kind: "switch",
			},
		],
	],
	[
		"Images",
		[
			{
				key: "images.autoResize",
				title: "Resize large images",
				detail: "Scale images to at most 2000 by 2000 pixels before sending them",
				kind: "switch",
			},
			{
				key: "images.blockImages",
				title: "Block images",
				detail: "Never send images to model providers",
				kind: "switch",
			},
		],
	],
	[
		"Network",
		[
			{
				key: "transport",
				title: "Transport",
				detail: "For providers that can stream more than one way",
				kind: "select",
				options: [
					["auto", "Auto"],
					["sse", "Server-sent events"],
					["websocket", "WebSocket"],
					["websocket-cached", "Cached WebSocket"],
				],
			},
			{
				key: "httpIdleTimeoutMs",
				title: "HTTP idle timeout",
				detail: "The longest a response may pause; turn it off for local models that think for minutes",
				kind: "select",
				options: [
					[30_000, "30 seconds"],
					[60_000, "1 minute"],
					[120_000, "2 minutes"],
					[300_000, "5 minutes"],
					[0, "Off"],
				],
				fallback: 300_000,
			},
			{
				key: "cacheWarming",
				title: "Cache warming",
				detail: "Keep the provider's prompt cache warm; each refresh costs money",
				userOnly: true,
				kind: "select",
				options: [
					["off", "Off"],
					["streaming", "While a turn runs"],
					["idle", "Also between turns"],
				],
			},
		],
	],
	[
		"Projects",
		[
			{
				key: "defaultProjectTrust",
				title: "Trust new projects",
				detail: "For a project with its own extensions, skills or settings and no saved decision",
				userOnly: true,
				kind: "select",
				options: [
					["ask", "Ask"],
					["always", "Always"],
					["never", "Never"],
				],
			},
		],
	],
	[
		"Updates and privacy",
		[
			{
				key: "autoUpdate",
				title: "Automatic updates",
				detail: "Download updates to the knightcode command line automatically",
				userOnly: true,
				kind: "switch",
				fallback: true,
			},
			{
				key: "enableInstallTelemetry",
				title: "Install telemetry",
				detail: "Send an anonymous version ping after an update",
				kind: "switch",
			},
			{
				key: "warnings.anthropicExtraUsage",
				title: "Anthropic extra usage warning",
				detail: "Warn when a Claude subscription sign-in may be billed as paid extra usage",
				kind: "switch",
			},
		],
	],
];

/** Per-model reasoning overrides (`modelThinkingLevels`, keyed provider/model), added from the model list. */
function ModelReasoning({ file }: { file: ConfigFile }) {
	const models = experimental_pickerServices().experimental_useModels();
	const levels = ((file.read.settings as { modelThinkingLevels?: Record<string, string> }).modelThinkingLevels ??
		{}) as Record<string, string>;
	const fallback = String((file.read.settings as { defaultThinkingLevel?: string }).defaultThinkingLevel ?? "medium");
	const write = (next: Record<string, string>) =>
		file.write("modelThinkingLevels", Object.keys(next).length ? next : null);
	return (
		<Card
			title="Reasoning per model"
			aside={
				<Popover
					side="bottom"
					align="end"
					trigger={(open) => (
						<Button variant="soft" toolbar aria-expanded={open}>
							<Plus size={16} /> Add model
						</Button>
					)}
				>
					{(close) => (
						<ModelList
							model={undefined}
							onModel={(m) => {
								close();
								const level = (m.thinkingLevels as string[]).includes(fallback)
									? fallback
									: (m.thinkingLevels[0] ?? "off");
								write({ ...levels, [`${m.provider}/${m.id}`]: level });
							}}
						/>
					)}
				</Popover>
			}
		>
			{Object.keys(levels).length === 0 ? (
				<Row title="No models of their own" detail="Every model starts at the default reasoning" />
			) : null}
			{Object.entries(levels).map(([key, level]) => {
				const model = models.find((m) => `${m.provider}/${m.id}` === key);
				return (
					<Row key={key} title={model ? `${model.providerName} · ${model.name}` : key}>
						<SelectMenu
							label={`Reasoning for ${key}`}
							value={level}
							onChange={(v) => write({ ...levels, [key]: v })}
							options={(model?.thinkingLevels ?? THINKING_LEVELS).map((l) => ({ value: l, label: levelName(l) }))}
						/>
						<IconButton
							label={`Remove ${key}`}
							toolbar
							onClick={() => write(Object.fromEntries(Object.entries(levels).filter(([k]) => k !== key)))}
						>
							<Trash2 size={16} />
						</IconButton>
					</Row>
				);
			})}
		</Card>
	);
}
/**
 * Configuration, as Codex's page of that name: the agent's settings from settings.json, the user's or a trusted
 * project's (which overrides the user's key by key); what has no row here is one click away in the file.
 */
export function Configuration() {
	const [cwd, setCwd] = useState<string>();
	const [trusted, setTrusted] = useProjectTrust(cwd);
	const file = experimental_settingsControls().experimental_useConfigFile(cwd, trusted);
	const scope = cwd === undefined ? "global" : "project";
	const path = file?.read.paths[scope];
	const editable = file !== undefined && file.cwd === cwd && (cwd === undefined || trusted === true);
	return (
		<>
			<ScopeCard
				cwd={cwd}
				onCwd={setCwd}
				trusted={trusted}
				onTrust={setTrusted}
				detail={
					cwd === undefined
						? "Shared with knightcode in a terminal"
						: "A project's settings override the user's, key by key"
				}
			/>
			{editable ? (
				<>
					<ConfigFields sections={CONFIGURATION} file={file} />
					{cwd === undefined ? <ModelReasoning file={file} /> : null}
					<Card title="Other settings">
						<Row
							title="settings.json"
							detail={file.read.versions[scope] === "none" ? `${path} (created by the first change here)` : path}
						>
							<Button
								variant="soft"
								toolbar
								disabled={!path || file.read.versions[scope] === "none"}
								onClick={() => path && openFile(path)}
							>
								<ExternalLink size={16} /> Open
							</Button>
						</Row>
					</Card>
				</>
			) : cwd !== undefined && trusted === false ? (
				<div className="text-secondary">Trust this project to give it settings of its own.</div>
			) : null}
		</>
	);
}

/** The KnightCode tools of `/tools`, as people know them. */
const TOOL_INFO: Record<string, [title: string, detail: string]> = {
	webfetch: ["Web fetch", "Read a web page as markdown or text"],
	websearch: ["Web search", "Search the web for titles, links and snippets"],
	ask_user: ["Ask user", "Let KnightCode ask you questions with choices"],
	scratchpad: ["Scratchpad", "Notes KnightCode keeps for a thread and gets back after compaction"],
	"classifier-gate": [
		"Classifier gate",
		"A classifier model screens shell and file-editing calls; risky ones need your approval",
	],
};

const CODEMODE: [string, SettingsField[]][] = [
	[
		"Codemode",
		[
			{
				key: "codemode.mode",
				title: "Mode",
				detail: "On: tools stay callable directly and from scripts. Only: tools are reached through scripts alone",
				kind: "select",
				options: [
					["on", "On"],
					["only", "Only"],
				],
			},
			{
				key: "codemode.inlineBudget",
				title: "Inline budget",
				detail: "Tokens codemode may spend describing script-callable tools in its own description",
				kind: "number",
				min: 0,
				max: 1_000_000,
				unit: "tokens",
			},
		],
	],
];

/**
 * Tools: the KnightCode tools `/tools` turns on and off (tools.json, with their own settings), the default tool set
 * of new threads (`defaultTools`), and codemode.
 */
export function Tools() {
	const [knightcode, setKnightcode] = useState<Requests["tool/settings/read"]["result"]>();
	const [engine, setEngine] = useState<Requests["tool/list"]["result"]>();
	const file = experimental_settingsControls().experimental_useConfigFile(undefined);
	const [key, setKey] = useState("");
	const load = useCallback(() => {
		const failed = (e: unknown) =>
			experimental_controllers().experimental_notify(services().experimental_errorText(e), "error");
		void services().experimental_request("tool/settings/read", {}).then(setKnightcode).catch(failed);
		void services().experimental_request("tool/list", {}).then(setEngine).catch(failed);
	}, []);
	useEffect(load, [load]);
	const writeTool = (name: string, settingKey: string, value: string | boolean | null) =>
		void services()
			.experimental_request("tool/settings/write", { name, key: settingKey, value })
			.then(load)
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	const own = new Set(knightcode?.tools.map((t) => t.name));
	const defaults = new Set(engine?.defaultTools);
	const setDefaults = (value: string[] | null) => void file?.write("defaultTools", value).then(load);
	return (
		<>
			<Card title="KnightCode tools">
				{knightcode?.tools.map((tool) => {
					const [title, detail] = TOOL_INFO[tool.name] ?? [tool.name, ""];
					const setting = (name: string) => tool.settings[name];
					return (
						<Fragment key={tool.name}>
							<Row title={title} detail={detail}>
								<Switch
									label={`Enable ${title}`}
									checked={tool.enabled}
									onChange={(on) => writeTool(tool.name, "enabled", on)}
								/>
							</Row>
							{tool.name === "websearch" && tool.enabled ? (
								<>
									<Row title="Search provider" detail="DuckDuckGo needs no key but may limit you; Brave needs one">
										<SelectMenu
											label="Search provider"
											value={setting("provider") === "brave" ? "brave" : "duckduckgo"}
											onChange={(v) => writeTool(tool.name, "provider", v)}
											options={[
												{ value: "duckduckgo", label: "DuckDuckGo" },
												{ value: "brave", label: "Brave Search" },
											]}
										/>
									</Row>
									<Row
										title="Brave API key"
										detail={
											setting("braveApiKey")
												? `Saved (${setting("braveApiKey")}); BRAVE_API_KEY is also read`
												: "Free at brave.com/search/api; BRAVE_API_KEY is also read"
										}
									>
										<input
											type="password"
											aria-label="Brave API key"
											value={key}
											placeholder={setting("braveApiKey") ? "Replace key" : "Paste key"}
											onChange={(e) => setKey(e.target.value)}
											onKeyDown={(e) => {
												if (
													!experimental_shellServices().experimental_matches(e, "desktop.item.activate") ||
													!key.trim()
												)
													return;
												writeTool(tool.name, "braveApiKey", key.trim());
												setKey("");
											}}
											className="kc-input h-7 w-48 border-line-strong px-2"
										/>
										{setting("braveApiKey") ? (
											<IconButton
												label="Remove the key"
												toolbar
												onClick={() => writeTool(tool.name, "braveApiKey", null)}
											>
												<Trash2 size={16} />
											</IconButton>
										) : null}
									</Row>
								</>
							) : null}
							{tool.name === "classifier-gate" && tool.enabled ? (
								<Row title="Classifier model" detail="Sign in to OpenRouter for Jev">
									<SelectMenu
										label="Classifier model"
										value={typeof setting("model") === "string" ? String(setting("model")) : undefined}
										onChange={(v) => writeTool(tool.name, "model", v)}
										options={(knightcode?.classifiers ?? []).map((m) => ({
											value: `${m.provider}/${m.id}`,
											label: m.name,
											description: `${m.provider}/${m.id}`,
										}))}
									/>
								</Row>
							) : null}
						</Fragment>
					);
				})}
			</Card>
			<Card
				title="Default tools"
				aside={
					file?.read.origins.defaultTools === "global" ? (
						<Button color="secondary" toolbar onClick={() => setDefaults(null)}>
							Reset
						</Button>
					) : null
				}
			>
				<Row
					title="Tools new threads start with"
					detail="Extensions and threads can turn tools on and off as they run"
				/>
				{engine?.tools
					.filter((tool) => !own.has(tool.name))
					.map((tool) => (
						<Row
							key={tool.name}
							title={<span className="font-code">{tool.name}</span>}
							detail={<span className="line-clamp-2">{tool.description}</span>}
						>
							{tool.source === "builtin" ? null : <span className="text-xs text-tertiary">{tool.source}</span>}
							<Switch
								label={`Start threads with ${tool.name}`}
								checked={defaults.has(tool.name)}
								onChange={(on) =>
									setDefaults(on ? [...defaults, tool.name] : [...defaults].filter((n) => n !== tool.name))
								}
							/>
						</Row>
					))}
			</Card>
			{file ? <ConfigFields sections={CODEMODE} file={file} /> : null}
		</>
	);
}
