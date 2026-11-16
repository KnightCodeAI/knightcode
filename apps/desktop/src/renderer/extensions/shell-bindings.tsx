/** Public structural read models and shared controls, backed by existing host state and services. */
import type {
	experimental_Controls,
	experimental_ShellServices,
	experimental_NavigationState,
	experimental_ThreadListState,
} from "@knightcodeai/cli/desktop";
import { useSyncExternalStore } from "react";
import { client } from "../client.ts";
import { SIDEBAR_WIDTH, WINDOW_CHROME } from "../../shared/host-protocol.ts";
import { DESKTOP_KEYBINDINGS, type KeybindingId } from "../../shared/keybindings.ts";
import { IconButton } from "../components/button.tsx";
import { showContextMenu } from "../components/context-menu.ts";
import { ConfirmDialog } from "../components/dialog.tsx";
import { Composer } from "../components/composer.tsx";
import { ProjectPicker } from "../components/composer-pickers.tsx";
import * as menu from "../components/menu.tsx";
import { NavRow } from "../components/nav-row.tsx";
import { HoverCard } from "../components/popover.tsx";
import { RenameThreadDialog, DeleteThreadDialog, threadActions } from "../components/thread-actions.tsx";
import { Tooltip } from "../components/tooltip.tsx";
import { followDrag } from "../drag.ts";
import { basename, samePath, messageTime } from "../format.ts";
import { bindingLabel, isMac, matches } from "../keys.ts";
import { sidebarModel, threadSlots, selectRows } from "../sidebar-model.ts";
import {
	archiveThreads,
	checkForUpdates,
	errorText,
	installUpdate,
	openUpdatePage,
	selectProjects,
	selectUnread,
	setFinding,
	setPaletteOpen,
	setSidebarOption,
	setSidebarWidth,
	sidebarOptionsOf,
	toast,
	toggleProject,
	toggleSection,
	useStore,
} from "../store.ts";
import { HomeSetup } from "./home-support.tsx";
import { desktopExtensions } from "./runtime.ts";
import { startupLayout } from "./startup.ts";

const EMPTY: string[] = [];

/** Read only navigation state; unrelated transcript deltas do not become public snapshots. */
export function useNavigation(): experimental_NavigationState {
	const view = useStore((s) => s.view);
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const history = useStore((s) => s.history);
	return { view, sidebarOpen, canGoBack: history.index > 0, canGoForward: history.index < history.stack.length - 1 };
}

/** Read the list's supported domain data and presentation settings, not arbitrary store selectors. */
export function useThreadList(): experimental_ThreadListState {
	const threads = useStore((s) => s.threads);
	const projects = useStore(selectProjects);
	const pins = useStore((s) => s.desktop?.pinnedThreads ?? EMPTY);
	const unread = useStore(selectUnread);
	const folded = useStore((s) => s.desktop?.sidebar.collapsedSections ?? EMPTY);
	const organize = useStore((s) => sidebarOptionsOf(s).organize);
	const sort = useStore((s) => sidebarOptionsOf(s).sort);
	const width = useStore((s) => s.desktop?.sidebar.width ?? SIDEBAR_WIDTH.default);
	return { threads, projects, pins, unread, folded, organize, sort, width };
}

export const controls: experimental_Controls = {
	experimental_IconButton: IconButton,
	experimental_Menu: menu.Menu,
	experimental_MenuTrigger: menu.MenuTrigger,
	experimental_MenuContent: menu.MenuContent,
	experimental_MenuItem: menu.MenuItem,
	experimental_MenuSub: menu.MenuSub,
	experimental_MenuSeparator: menu.MenuSeparator,
	experimental_MenuRadioGroup: menu.MenuRadioGroup,
	experimental_MenuRadioItem: menu.MenuRadioItem,
	experimental_HoverCard: HoverCard,
	experimental_Tooltip: Tooltip,
	experimental_ConfirmDialog: ConfirmDialog,
	experimental_NavRow: NavRow,
	experimental_RenameThreadDialog: RenameThreadDialog,
	experimental_DeleteThreadDialog: DeleteThreadDialog,
	experimental_HomeComposer: ({ cwd, onChange }) => <Composer project={{ cwd, onChange }} />,
	experimental_ProjectPicker: ProjectPicker,
	experimental_HomeSetup: HomeSetup,
};

export const shellServices: experimental_ShellServices = {
	experimental_platform: window.knightcode?.platform ?? "unknown",
	experimental_titleBarHeight: WINDOW_CHROME.titleBarHeight,
	experimental_sidebarWidth: SIDEBAR_WIDTH,
	experimental_basename: basename,
	experimental_samePath: samePath,
	experimental_messageTime: messageTime,
	experimental_isMac: isMac,
	experimental_bindingLabel: (id) => (id in DESKTOP_KEYBINDINGS ? bindingLabel(id as KeybindingId) : ""),
	experimental_matches: (event, id) => id in DESKTOP_KEYBINDINGS && matches(event, id as KeybindingId),
	experimental_followDrag: followDrag,
	experimental_showContextMenu: (items) =>
		showContextMenu(
			items.map((item) => {
				const leaf = (entry: { label: string; run(): void; disabled?: boolean; binding?: string } | "-") => {
					if (entry === "-") return entry;
					const { binding, ...rest } = entry;
					// Public binding IDs are resolved against the configured host vocabulary.
					return {
						...rest,
						...(binding && binding in DESKTOP_KEYBINDINGS ? { binding: binding as KeybindingId } : {}),
					};
				};
				return item !== "-" && "items" in item ? { label: item.label, items: item.items.map(leaf) } : leaf(item);
			}),
		),
	experimental_showInFolder: async (path) => {
		try {
			await client.host("host/shell/showInFolder", { path });
			return true;
		} catch (error) {
			toast(errorText(error), "error");
			return false;
		}
	},
	experimental_profile: async (action) => {
		if (action === "read") return client.host("host/profile/read", {});
		if (action === "signIn") return client.host("host/profile/signIn", {});
		await client.host("host/profile/signOut", {});
		return { signedIn: false };
	},
	experimental_openDocumentation: async () => {
		try {
			await client.host("host/shell/openExternal", { url: "https://knightcode.dev/docs" });
			return true;
		} catch (error) {
			toast(errorText(error), "error");
			return false;
		}
	},
	experimental_checkForUpdates: checkForUpdates,
	experimental_installUpdate: installUpdate,
	experimental_openUpdatePage: openUpdatePage,
	experimental_setPaletteOpen: setPaletteOpen,
	experimental_setFinding: setFinding,
	experimental_toggleSection: toggleSection,
	experimental_toggleProject: toggleProject,
	experimental_setSidebarWidth: setSidebarWidth,
	experimental_setSidebarOption: setSidebarOption,
	experimental_archiveThreads: archiveThreads,
	experimental_threadMenu: threadActions,
	experimental_sidebarModel: sidebarModel,
	experimental_threadSlots: threadSlots,
	experimental_selectRows: selectRows,
	experimental_useHiddenNavigation: () => {
		useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
		const cached = useSyncExternalStore(startupLayout.subscribe, startupLayout.getSnapshot);
		return [
			...new Set([
				...desktopExtensions.hiddenNavigation().map((entry) => entry.target),
				...cached.hidden.map((entry) => entry.target),
			]),
		];
	},
	experimental_usePages: () => {
		useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
		return desktopExtensions
			.pages({ sidebarOpen: true })
			.map((entry) => ({ id: entry.id, label: entry.contribution.label, hidden: entry.contribution.hidden }));
	},
};
