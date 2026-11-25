/** The palette's quick actions, declared through the public desktop API. */
import { defineDesktopExtension, experimental_controllers } from "@knightcodeai/cli/desktop";

export default defineDesktopExtension((app) => {
	app.experimental_registerCommand({
		id: "new",
		label: () => "New thread",
		icon: "SquarePen",
		binding: "desktop.thread.new",
		experimental_run: () => experimental_controllers().experimental_showNew(),
	});
	app.experimental_registerCommand({
		id: "folder",
		label: () => "Open folder",
		icon: "FolderOpen",
		binding: "desktop.project.open",
		experimental_run: async () => {
			await experimental_controllers().experimental_addProject();
		},
	});
	app.experimental_registerCommand({
		id: "sidebar",
		label: (context) => (context.sidebarOpen ? "Hide sidebar" : "Show sidebar"),
		icon: "PanelLeft",
		binding: "desktop.sidebar.toggle",
		experimental_run: (context) => experimental_controllers().experimental_setSidebarOpen(!context.sidebarOpen),
	});
	app.experimental_registerCommand({
		id: "terminal",
		label: () => "Toggle terminal",
		icon: "SquareTerminal",
		binding: "desktop.terminal.toggle",
		experimental_available: (context) => !!context.thread,
		experimental_run: (context) => {
			if (context.thread) experimental_controllers().experimental_toggleTerminal(context.thread);
		},
	});
	app.experimental_registerCommand({
		id: "newTerminal",
		label: () => "New terminal",
		icon: "SquareTerminal",
		binding: "desktop.terminal.new",
		experimental_available: (context) => !!context.thread,
		experimental_run: async (context) => {
			if (context.thread) await experimental_controllers().experimental_newTerminal(context.thread);
		},
	});
	app.experimental_registerCommand({
		id: "settings",
		label: () => "Settings",
		icon: "Settings",
		binding: "desktop.settings",
		experimental_run: () => experimental_controllers().experimental_showSettings("general"),
	});
	app.experimental_registerCommand({
		id: "shortcuts",
		label: () => "Keyboard shortcuts",
		icon: "Keyboard",
		binding: "desktop.shortcuts",
		experimental_run: () => experimental_controllers().experimental_showSettings("shortcuts"),
	});
});
