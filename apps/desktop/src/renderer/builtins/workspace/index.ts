import { defineDesktopExtension, experimental_panelServices } from "@knightcodeai/cli/desktop";
import { createElement } from "react";

export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({
		id: "terminal",
		surface: "terminal",
		experimental_render: ({ context }) =>
			context.workspace
				? createElement(experimental_panelServices().experimental_TerminalHost, { target: context.workspace })
				: null,
	});
	for (const surface of ["code", "diff"] as const)
		app.experimental_registerProvider({
			id: surface,
			surface,
			experimental_render: () => createElement(experimental_panelServices().experimental_EditorHost),
		});
});
