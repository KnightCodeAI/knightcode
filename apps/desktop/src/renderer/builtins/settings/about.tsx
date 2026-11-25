/** Settings › About: versions, updates and logs. */
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

export function About() {
	const [info, setInfo] = useState<{ appVersion: string; serverVersion: string; platform: string; logsDir: string }>();
	useEffect(() => void services().experimental_appInfo().then(setInfo), []);
	return (
		<Card>
			<Row title="KnightCode desktop">
				<span className="text-sm text-secondary">{info?.appVersion}</span>
			</Row>
			<Row title="App server">
				<span className="text-sm text-secondary">{info?.serverVersion}</span>
			</Row>
			<Updates />
			<Row title="Logs" detail={info?.logsDir}>
				<Button
					variant="soft"
					toolbar
					onClick={() =>
						info && void experimental_shellServices().experimental_showInFolder(`${info.logsDir}/app-server.log`)
					}
				>
					Show logs
				</Button>
			</Row>
		</Card>
	);
}

/** Settings › About's updates row: where updating stands, and the one thing to do about it. */
function Updates() {
	const update = experimental_useUpdate();
	const detail =
		update.state === "unavailable"
			? experimental_shellServices().experimental_platform === "linux"
				? "Update KnightCode with the package manager you installed it with."
				: "Updates come with an installed build."
			: update.state === "checking"
				? "Checking for updates…"
				: update.state === "downloading"
					? "Downloading an update…"
					: update.state === "ready"
						? `KnightCode ${update.version ? `${update.version} ` : ""}is ready. It installs when KnightCode restarts.`
						: update.state === "available"
							? `KnightCode ${update.version} is available.`
							: update.error
								? `The last check failed: ${update.error}`
								: update.checkedAt
									? `Up to date. Checked ${new Date(update.checkedAt).toLocaleString()}.`
									: undefined;
	return (
		<Row title="Updates" detail={detail}>
			{update.state === "ready" ? (
				<Button variant="soft" toolbar onClick={() => experimental_shellServices().experimental_installUpdate()}>
					Restart to update
				</Button>
			) : update.state === "available" ? (
				<Button
					variant="soft"
					toolbar
					onClick={() => experimental_shellServices().experimental_openUpdatePage(update.url)}
				>
					Download
				</Button>
			) : update.state === "unavailable" ? null : (
				<Button
					variant="soft"
					toolbar
					disabled={update.state === "checking" || update.state === "downloading"}
					onClick={() => experimental_shellServices().experimental_checkForUpdates()}
				>
					Check for updates
				</Button>
			)}
		</Row>
	);
}
