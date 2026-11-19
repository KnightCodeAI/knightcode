/**
 * Built-in Settings: the page shell, its sidebar column and every built-in section, on the public SDK only. Pages
 * are laid out as Codex's (measured 2026-10-19): a 768px column with a 28px title and sections of cards. Desktop
 * preferences live in desktop-state.json; agent settings go through the app server, so the terminal sees the same.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import {
	defineDesktopExtension,
	experimental_controls,
	experimental_Icon as Icon,
	type experimental_IconName,
	experimental_controllers,
	experimental_settingsControls,
	experimental_SettingsSections as SettingsSections,
	type experimental_SettingsPage as SettingsPage,
	experimental_useNavigation,
} from "@knightcodeai/cli/desktop";
import { About } from "./about.tsx";
import { Appearance } from "./appearance.tsx";
import { Archived } from "./archived.tsx";
import { Configuration, Tools } from "./configuration.tsx";
import { General } from "./general.tsx";
import { McpServers } from "./mcp.tsx";
import { Models } from "./models.tsx";
import { Plugins } from "./plugins.tsx";
import { Extensions } from "./resources.tsx";
import { Shortcuts } from "./shortcuts.tsx";
import { Worktrees } from "./worktrees.tsx";

/** The pages in the order and groups the sidebar column lists them. */
export const SETTINGS_PAGES: { page: SettingsPage; label: string; icon: experimental_IconName; group: string }[] = [
	{ page: "general", label: "General", icon: "Settings", group: "Personal" },
	{ page: "appearance", label: "Appearance", icon: "Sun", group: "Personal" },
	{ page: "models", label: "Models & accounts", icon: "CircleUserRound", group: "Personal" },
	{ page: "archived", label: "Archived threads", icon: "Archive", group: "Personal" },
	{ page: "shortcuts", label: "Keyboard shortcuts", icon: "Keyboard", group: "Personal" },
	{ page: "about", label: "About", icon: "Info", group: "Personal" },
	{ page: "configuration", label: "Configuration", icon: "Code", group: "Coding" },
	{ page: "tools", label: "Tools", icon: "Wrench", group: "Coding" },
	{ page: "mcp", label: "MCP servers", icon: "Globe", group: "Coding" },
	{ page: "extensions", label: "Extensions & skills", icon: "Layers", group: "Coding" },
	{ page: "plugins", label: "Plugins", icon: "Plug", group: "Coding" },
	{ page: "worktrees", label: "Worktrees", icon: "GitBranch", group: "Coding" },
];

/** The settings pages, in the sidebar's column while Settings is open. */
function SettingsNav() {
	const view = experimental_useNavigation().view;
	const page = view.kind === "settings" ? view.page : undefined;
	const { experimental_SidebarFrame: SidebarFrame, experimental_SearchField: SearchField } =
		experimental_settingsControls();
	const { experimental_NavRow: NavRow } = experimental_controls();
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const shown = SETTINGS_PAGES.filter((p) => p.label.toLowerCase().includes(q));
	return (
		<SidebarFrame label="Settings">
			<div className="flex shrink-0 flex-col px-2 pb-2">
				<div className="flex h-[52px] items-center ps-2">
					<h1 className="text-[18px] leading-6 font-semibold">Settings</h1>
				</div>
				<SearchField value={query} onChange={setQuery} placeholder="Search" />
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pt-1 pb-2">
				{[...new Set(shown.map((p) => p.group))].map((group) => (
					<div key={group} className="flex flex-col gap-1">
						<div className="flex h-[30px] items-center ps-2 pe-1.5 text-base font-medium text-tertiary">{group}</div>
						<div className="flex flex-col gap-px">
							{shown
								.filter((p) => p.group === group)
								.map((p) => (
									<NavRow
										key={p.page}
										icon={<Icon name={p.icon} size={16} />}
										label={p.label}
										current={p.page === page}
										className="text-ink"
										onActivate={() => experimental_controllers().experimental_showSettings(p.page)}
									/>
								))}
						</div>
					</div>
				))}
			</div>
		</SidebarFrame>
	);
}

/** One page: its title over its sections; Archived threads draws its own header for Delete all. */
function SettingsPageShell() {
	const view = experimental_useNavigation().view;
	if (view.kind !== "settings") return null;
	const { page } = view;
	const { experimental_PageHeader: PageHeader, experimental_PageBody: PageBody } = experimental_settingsControls();
	const title = SETTINGS_PAGES.find((p) => p.page === page)?.label ?? "";
	return (
		<div className="min-w-0 flex-1 overflow-y-auto">
			{page === "archived" ? (
				<Archived title={title}>
					<SettingsSections page={page} />
				</Archived>
			) : (
				<>
					<PageHeader title={title} />
					<PageBody>
						<SettingsSections page={page} />
					</PageBody>
				</>
			)}
		</div>
	);
}

/** A whole-page built-in body registers as that page's first section. */
const BODIES: [SettingsPage, () => ReactNode][] = [
	["general", General],
	["appearance", Appearance],
	["models", Models],
	["shortcuts", Shortcuts],
	["configuration", Configuration],
	["tools", Tools],
	["mcp", McpServers],
	["extensions", Extensions],
	["plugins", Plugins],
	["worktrees", Worktrees],
	["about", About],
];

export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "default", surface: "settings", experimental_render: SettingsPageShell });
	app.experimental_registerProvider({ id: "nav", surface: "settingsNav", experimental_render: SettingsNav });
	for (const [page, Body] of BODIES)
		app.experimental_registerSettingsSection({ id: page, page, order: -1000, experimental_render: () => <Body /> });
});
