/** Settings' local names for the public controls, icons and shared helpers, so each section reads as one page. */
import { type ComponentType, createElement, type ReactNode, useEffect, useState } from "react";
import {
	experimental_controllers,
	experimental_controls,
	type experimental_Controls,
	experimental_Icon,
	type experimental_IconName,
	type experimental_IconProps,
	experimental_pickerServices,
	experimental_settingsControls,
	type experimental_SettingsControls,
	experimental_settingsServices as services,
	experimental_shellServices,
} from "@knightcodeai/cli/desktop";

// Host controls are resolved at render time: built-in modules are evaluated before the host is installed. The cast
// keeps each control's declared props; the wrapper forwards them unchanged.
function hostControl<K extends keyof experimental_Controls>(key: K): experimental_Controls[K] {
	return ((props: object) =>
		createElement(experimental_controls()[key] as ComponentType<object>, props)) as unknown as experimental_Controls[K];
}
function settingsControl<K extends Exclude<keyof experimental_SettingsControls, "experimental_useConfigFile">>(
	key: K,
): experimental_SettingsControls[K] {
	return ((props: object) =>
		createElement(
			experimental_settingsControls()[key] as ComponentType<object>,
			props,
		)) as unknown as experimental_SettingsControls[K];
}

export const Row = settingsControl("experimental_Row");
export const Section = settingsControl("experimental_Section");
export const Box = settingsControl("experimental_Box");
export const Card = settingsControl("experimental_Card");
export const PageHeader = settingsControl("experimental_PageHeader");
export const PageBody = settingsControl("experimental_PageBody");
export const PageBar = settingsControl("experimental_PageBar");
export const SearchField = settingsControl("experimental_SearchField");
export const SizeField = settingsControl("experimental_SizeField");
export const DialogActions = settingsControl("experimental_DialogActions");
export const ModelList = settingsControl("experimental_ModelList");
export const ConfigFields = settingsControl("experimental_ConfigFields");

/** A select over string values; the shared control keeps the typed value at the call site. */
export function SelectMenu<T extends string>(props: {
	label: string;
	value: T | undefined;
	options: { value: T; label: string; description?: string }[];
	onChange(value: T): void;
}): ReactNode {
	return createElement(experimental_settingsControls().experimental_SelectMenu, {
		...props,
		onChange: (value: string) => props.onChange(value as T),
	});
}

/** A few values as a row of pills, keeping the typed value at the call site. */
export function Segmented<T extends string>(props: {
	label: string;
	value: T;
	options: { value: NoInfer<T>; label: string }[];
	onChange(value: NoInfer<T>): void;
}): ReactNode {
	return createElement(experimental_settingsControls().experimental_Segmented, {
		...props,
		onChange: (value: string) => props.onChange(value as T),
	});
}

export const IconButton = hostControl("experimental_IconButton");
export const Switch = hostControl("experimental_Switch");
export const Dialog = hostControl("experimental_Dialog");
export const ConfirmDialog = hostControl("experimental_ConfirmDialog");
export const Popover = hostControl("experimental_Popover");
export const Tooltip = hostControl("experimental_Tooltip");
export const NavRow = hostControl("experimental_NavRow");
export const DeleteThreadDialog = hostControl("experimental_DeleteThreadDialog");
export const Menu = hostControl("experimental_Menu");
export const MenuTrigger = hostControl("experimental_MenuTrigger");
export const MenuContent = hostControl("experimental_MenuContent");
export const MenuItem = hostControl("experimental_MenuItem");
export const MenuSeparator = hostControl("experimental_MenuSeparator");
export const MenuRadioGroup = hostControl("experimental_MenuRadioGroup");
export const MenuRadioItem = hostControl("experimental_MenuRadioItem");

function icon(name: experimental_IconName) {
	return (props: Omit<experimental_IconProps, "name">) => createElement(experimental_Icon, { ...props, name });
}
export const Archive = icon("Archive");
export const Check = icon("Check");
export const ChevronDown = icon("ChevronDown");
export const ChevronRight = icon("ChevronRight");
export const Copy = icon("Copy");
export const Download = icon("Download");
export const ExternalLink = icon("ExternalLink");
export const Folder = icon("Folder");
export const Import = icon("Import");
export const KeyRound = icon("KeyRound");
export const ListFilter = icon("ListFilter");
export const LogIn = icon("LogIn");
export const LogOut = icon("LogOut");
export const MessageSquare = icon("MessageSquare");
export const MoreHorizontal = icon("MoreHorizontal");
export const Pencil = icon("Pencil");
export const Plus = icon("Plus");
export const RefreshCw = icon("RefreshCw");
export const Spinner = icon("Spinner");
export const SquarePen = icon("SquarePen");
export const Trash2 = icon("Trash2");

/** Reasoning levels as Codex names them. */
const LEVEL_NAMES: Record<string, string> = {
	off: "None",
	minimal: "Minimal",
	low: "Light",
	medium: "Medium",
	high: "High",
	xhigh: "Extra High",
	max: "Max",
};
export const levelName = (level: string) => LEVEL_NAMES[level] ?? level;

/** Opens a config file in the system's editor, as Codex's "Open config.toml". */
export const openFile = (path: string) => void services().experimental_openPath(path);

/** A page's tabs, as Codex's Worktrees page: 13px medium labels, the current one on the surface's darker fill. */
export function Tabs<T extends string>({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
}) {
	return (
		<div role="tablist" aria-label={label} className="flex gap-0.5">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="tab"
					aria-selected={o.value === value}
					onClick={() => onChange(o.value)}
					className="rounded-md px-2 py-1 text-sm font-medium text-secondary hover:text-ink aria-selected:bg-surface-secondary aria-selected:text-ink"
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

/** A project's trust decision, the one `/trust` and the first-thread banner record. */
export function useProjectTrust(cwd: string | undefined): [boolean | undefined, (trusted: boolean) => void] {
	const [trusted, setTrusted] = useState<boolean>();
	const fail = (e: unknown) =>
		experimental_controllers().experimental_notify(services().experimental_errorText(e), "error");
	useEffect(() => {
		setTrusted(undefined);
		if (cwd)
			void services()
				.experimental_request("project/trust/read", { cwd })
				.then((r) => setTrusted(r.trusted === true))
				.catch(fail);
	}, [cwd]);
	const set = (value: boolean) =>
		cwd &&
		void services()
			.experimental_request("project/trust/set", { cwd, trusted: value })
			.then(() => setTrusted(value))
			.catch(fail);
	return [trusted, set];
}

/**
 * Codex's config scope, the first card of a page that edits either the user's files or a project's: the scope (the
 * sidebar's projects), and for a project, whether it is trusted, which its own files need.
 */
export function ScopeCard({
	cwd,
	onCwd,
	trusted,
	onTrust,
	detail,
}: {
	cwd: string | undefined;
	onCwd: (cwd: string | undefined) => void;
	trusted: boolean | undefined;
	onTrust: (trusted: boolean) => void;
	detail: ReactNode;
}) {
	const projects = experimental_pickerServices().experimental_useProjects();
	return (
		<Card>
			<Row title="Scope" detail={detail}>
				<SelectMenu
					label="Scope"
					value={cwd ?? ""}
					onChange={(v) => onCwd(v || undefined)}
					options={[
						{ value: "", label: "User config" },
						...projects.map((p) => ({
							value: p.path,
							label: p.name ?? experimental_shellServices().experimental_basename(p.path),
						})),
					]}
				/>
			</Row>
			{cwd ? (
				<Row
					title="Trust this project"
					detail="A trusted project's own settings, extensions, skills and MCP servers load with it"
				>
					<Switch label="Trust this project" checked={trusted === true} onChange={onTrust} />
				</Row>
			) : null}
		</Card>
	);
}
