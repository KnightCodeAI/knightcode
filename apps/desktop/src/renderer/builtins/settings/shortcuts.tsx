/** Settings › Keyboard shortcuts: each binding's combinations, recorded in place. */
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

/** Codex's key chip: 20px, 10px corners, 12px, the text colour at 6.5%. */
const KeyChip = ({ keys }: { keys: string }) => (
	<kbd className="rounded-md bg-ink/[0.065] px-2 py-1 font-ui text-xs leading-3 text-secondary">
		{services().experimental_keyLabel(keys)}
	</kbd>
);

/**
 * Recording a shortcut, as Codex's: a 144px field reading "Press shortcut" with the focus ring, and Cancel. The next
 * key press (not a lone modifier) is the shortcut; Escape cancels. Keys stop here, so no other shortcut runs.
 */
function ShortcutCapture({
	label,
	onKeys,
	onCancel,
}: {
	label: string;
	onKeys: (keys: string) => void;
	onCancel: () => void;
}) {
	return (
		<span className="flex items-center gap-2">
			<input
				autoFocus
				readOnly
				aria-label={`Shortcut capture for ${label}`}
				value="Press shortcut"
				onKeyDown={(e) => {
					e.preventDefault();
					e.stopPropagation();
					if (experimental_shellServices().experimental_matches(e, "desktop.picker.dismiss")) return onCancel();
					const keys = services().experimental_comboFromEvent(e);
					if (keys) onKeys(keys);
				}}
				onBlur={onCancel}
				className="kc-input h-7 w-36 cursor-default border-[var(--kc-focus)] px-2 text-sm"
			/>
			<Button color="secondary" toolbar onMouseDown={(e) => e.preventDefault()} onClick={onCancel}>
				Cancel
			</Button>
		</span>
	);
}

/**
 * One shortcut's row, as Codex's: each of its key combinations as a chip with Change, and Clear at the row's end;
 * "Unassigned" with Change when it has none; Reset when it differs from the default.
 */
function ShortcutRow({ id }: { id: string }) {
	const binding = services()
		.experimental_keybindings()
		.find((entry) => entry.id === id)!;
	// Read through the store so the row redraws when the rebinding changes.
	const rebound = services().experimental_usePreferences().keybindings?.[id];
	const keys = rebound ?? binding.defaultKeys;
	/** The combination being recorded: an index into keys, or keys.length for a new one. */
	const [recording, setRecording] = useState<number>();
	const save = (next: string[]) => {
		setRecording(undefined);
		services().experimental_setKeybinding(id, next);
	};
	const slots = keys.length ? keys.map((k, i) => ({ keys: k, i })) : [{ keys: undefined, i: 0 }];
	return (
		<Row title={binding.description}>
			<span className="flex min-w-96 flex-col">
				{slots.map(({ keys: combo, i }) => (
					<span key={i} role="group" className="flex h-8 items-center justify-between gap-2">
						<span className="flex items-center gap-1">
							{recording === i ? (
								<ShortcutCapture
									label={binding.description}
									onCancel={() => setRecording(undefined)}
									onKeys={(k) => save([...keys.slice(0, i), k, ...keys.slice(i + 1)])}
								/>
							) : (
								<>
									{combo ? <KeyChip keys={combo} /> : <span className="text-sm text-secondary">Unassigned</span>}
									<IconButton
										label={`Change shortcut for ${binding.description}`}
										toolbar
										onClick={() => setRecording(i)}
									>
										<Pencil size={16} />
									</IconButton>
								</>
							)}
						</span>
						<span className="flex items-center gap-1">
							{rebound && i === 0 ? (
								<Button color="secondary" toolbar onClick={() => save([...binding.defaultKeys])}>
									Reset
								</Button>
							) : null}
							{combo ? (
								<IconButton
									label={`Clear shortcut for ${binding.description}`}
									toolbar
									onClick={() => save(keys.filter((_, j) => j !== i))}
								>
									<Trash2 size={16} />
								</IconButton>
							) : null}
						</span>
					</span>
				))}
			</span>
		</Row>
	);
}

export function Shortcuts() {
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	return (
		<>
			<PageBar>
				<SearchField page value={query} onChange={setQuery} placeholder="Search keyboard shortcuts" />
			</PageBar>
			<Card>
				{services()
					.experimental_keybindings()
					.map((entry) => entry.id)
					.filter((id) =>
						services()
							.experimental_keybindings()
							.find((entry) => entry.id === id)!
							.description.toLowerCase()
							.includes(q),
					)
					.map((id) => (
						<ShortcutRow key={id} id={id} />
					))}
			</Card>
		</>
	);
}
