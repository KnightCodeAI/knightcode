/** Settings › General: permissions, window, composer and notification preferences. */
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

export function General() {
	const prefs = services().experimental_usePreferences();
	const mod = experimental_shellServices().experimental_isMac() ? "⌘" : "Ctrl";
	return (
		<>
			<Card title="Permissions">
				<Row
					title="Full access"
					detail="With full access, KnightCode runs commands and edits files without asking. Shows it in the composer's permissions menu."
				>
					<Switch
						label="Show Full access in the composer"
						checked={prefs.allowFullAccess}
						onChange={(v) => services().experimental_setPreference("allowFullAccess", v)}
					/>
				</Row>
			</Card>
			<Card title="General">
				<Row title="Confirm before closing a window" detail="Warn when the close shortcut would close the window">
					<SelectMenu
						label="Confirm before closing a window"
						value={prefs.confirmClose ?? "shortcut"}
						onChange={(v) => services().experimental_setPreference("confirmClose", v)}
						options={[
							{ value: "never", label: "Never" },
							{ value: "shortcut", label: "Close shortcut only" },
							{ value: "always", label: "Always" },
						]}
					/>
				</Row>
				<Row title="Automatically archive inactive threads" detail="Archive threads after a period of inactivity">
					<SelectMenu
						label="Automatically archive inactive threads"
						value={String(prefs.autoArchiveDays ?? 0)}
						onChange={(v) => services().experimental_setPreference("autoArchiveDays", Number(v))}
						options={[
							{ value: "0", label: "Never" },
							...[1, 7, 14, 30, 90].map((d) => ({ value: String(d), label: d === 1 ? "1 day" : `${d} days` })),
						]}
					/>
				</Row>
			</Card>
			<Card title="Composer">
				<Row title="Show context window usage">
					<Switch
						label="Show context window usage in the composer"
						checked={prefs.showContextUsage !== false}
						onChange={(v) => services().experimental_setPreference("showContextUsage", v)}
					/>
				</Row>
				<Row title="Send shortcut" detail="Choose when Enter sends a prompt or inserts a new line">
					<SelectMenu
						label="Send shortcut"
						value={prefs.sendKey}
						onChange={(v) => services().experimental_setPreference("sendKey", v)}
						options={[
							{ value: "enter", label: "Enter" },
							{ value: "modEnter", label: `${mod}+Enter` },
						]}
					/>
				</Row>
				<Row
					title="Follow-up behavior"
					detail={`Queue follow-ups while KnightCode runs or steer the current run. Press ${mod}+Enter to do the opposite for one message`}
				>
					<Segmented
						label="Follow-up behavior"
						value={prefs.whileRunning}
						onChange={(v) => services().experimental_setPreference("whileRunning", v)}
						options={[
							{ value: "queue", label: "Queue" },
							{ value: "steer", label: "Steer" },
						]}
					/>
				</Row>
			</Card>
			<Card title="Notifications">
				<Row title="Turn completion notifications" detail="Set when KnightCode alerts you that it's finished">
					<SelectMenu
						label="Turn completion notifications"
						value={prefs.turnNotifications ?? "unfocused"}
						onChange={(v) => services().experimental_setPreference("turnNotifications", v)}
						options={[
							{ value: "never", label: "Never" },
							{ value: "unfocused", label: "Only when unfocused" },
							{ value: "always", label: "Always" },
						]}
					/>
				</Row>
			</Card>
		</>
	);
}
