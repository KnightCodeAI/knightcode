/** Typed desktop intents over the existing store; no controller owns a second state container. */
import type { experimental_Controllers } from "@knightcodeai/cli/desktop";
import { client } from "../client.ts";
import { desktopExtensions } from "./runtime.ts";
import {
	addProject,
	archive,
	dismissToast,
	errorText,
	getState,
	goBack,
	navigate,
	newTerminal,
	openThread,
	pinThread,
	removeProject,
	rename,
	selectProjects,
	setSidebarOpen,
	showNew,
	toast,
	toggleTerminal,
} from "../store.ts";

/** Stable window-local facade. Explicit IDs never resolve through a later selected thread. */
export const controllers: experimental_Controllers = {
	experimental_showNew: showNew,
	experimental_runCommand: (id, context) => {
		const entry = desktopExtensions.commands(context).find((command) => command.id === id);
		if (!entry) return false;
		desktopExtensions.runCommand(entry, context);
		return true;
	},
	experimental_addProject: addProject,
	experimental_setSidebarOpen: setSidebarOpen,
	experimental_showSettings: (page) => navigate({ kind: "settings", page }),
	experimental_goBack: (delta) => {
		const { history } = getState();
		if (!history.stack[history.index + delta]) return false;
		goBack(delta);
		return true;
	},
	experimental_openPage: (id) => {
		const page = desktopExtensions.pages({ sidebarOpen: getState().sidebarOpen }).find((entry) => entry.id === id);
		if (!page || (page.activation && !page.activation.admitted())) return false;
		navigate({ kind: "page", id });
		return true;
	},
	experimental_openThread: async (id) => {
		if (!getState().threads.some((t) => t.id === id)) return false;
		await openThread(id);
		return !getState().opening[id] && !!getState().held[id];
	},
	experimental_removeProject: (path) => {
		if (!selectProjects(getState()).some((p) => p.path === path)) return false;
		removeProject(path);
		return true;
	},
	experimental_pinThread: (id, pinned) => {
		if (!getState().threads.some((t) => t.id === id)) return false;
		pinThread(id, pinned);
		return true;
	},
	experimental_renameThread: async (id, name) => {
		if (!getState().threads.some((t) => t.id === id) || !name.trim()) return false;
		return rename(id, name.trim());
	},
	experimental_archiveThread: async (id) => {
		if (!getState().threads.some((t) => t.id === id)) return false;
		return archive(id);
	},
	experimental_windowCommand: async (command) => {
		try {
			await client.host("host/app/command", { command });
			return true;
		} catch (error) {
			toast(errorText(error), "error");
			return false;
		}
	},
	experimental_toggleTerminal: ({ id, cwd }) => toggleTerminal(id, cwd),
	experimental_newTerminal: ({ id, cwd }) => newTerminal(id, cwd),
	experimental_notify: toast,
	experimental_dismissToast: dismissToast,
};
