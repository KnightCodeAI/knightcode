/** Settings › Extensions & skills: resources per scope and the host-owned native extension list. */
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
type Resource = Requests["resource/list"]["result"]["resources"][number];
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

const RESOURCE_GROUPS: [Resource["type"], string][] = [
	["extensions", "Extensions"],
	["skills", "Skills"],
	["prompts", "Prompt templates"],
	["themes", "Themes"],
];

/** Where a resource comes from, as `knightcode config` groups them. */
function resourceOrigin(resource: Resource): string {
	const where = resource.origin === "package" ? resource.source : resource.path;
	return `${{ user: "User", project: "Project", temporary: "This session" }[resource.scope]} · ${where}`;
}

/**
 * Extensions and skills, as `knightcode config`: every extension, skill, prompt template and theme a thread in the
 * scope would find, each loaded or skipped by a pattern in the settings.json that names it.
 */
export function Extensions() {
	const NativeExtensions = services().experimental_NativeExtensions;
	const [cwd, setCwd] = useState<string>();
	const [trusted, setTrusted] = useProjectTrust(cwd);
	// Tagged with its scope, newest request only: another project's list never shows (or gets acted on) under this one.
	const [loaded, setLoaded] = useState<{ cwd: string | undefined; list: Requests["resource/list"]["result"] }>();
	const latest = useRef(0);
	const list = loaded && loaded.cwd === cwd ? loaded.list : undefined;
	const load = useCallback(() => {
		const request = ++latest.current;
		services()
			.experimental_request("resource/list", cwd === undefined ? {} : { cwd })
			.then((result) => {
				if (request === latest.current) setLoaded({ cwd, list: result });
			})
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	}, [cwd, trusted]);
	useEffect(load, [load]);
	const toggle = (resource: Resource, enabled: boolean) =>
		void services()
			.experimental_request("resource/set", {
				...(cwd === undefined ? {} : { cwd }),
				type: resource.type,
				path: resource.path,
				enabled,
			})
			.then(load)
			.catch((e: unknown) =>
				experimental_controllers().experimental_notify(services().experimental_errorText(e), "error"),
			);
	return (
		<>
			<ScopeCard
				cwd={cwd}
				onCwd={setCwd}
				trusted={trusted}
				onTrust={setTrusted}
				detail="Threads load these when they start or resume. A trusted project adds its own"
			/>
			<NativeExtensions cwd={cwd} />
			{RESOURCE_GROUPS.map(([type, title]) => {
				const rows = list?.resources.filter((r) => r.type === type) ?? [];
				return rows.length ? (
					<Card key={type} title={title}>
						{rows.map((resource) => (
							<Row key={resource.path} title={resource.name} detail={resourceOrigin(resource)}>
								{/* Resources from command-line flags last one session; there is nothing to save. */}
								{resource.scope === "temporary" ? null : (
									<Switch
										label={`Load ${resource.name}`}
										checked={resource.enabled}
										onChange={(on) => toggle(resource, on)}
									/>
								)}
							</Row>
						))}
					</Card>
				) : null;
			})}
		</>
	);
}
