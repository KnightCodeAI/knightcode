/** Point desktop.frontend at this file to verify that failed setup publishes nothing. */
import { defineDesktopExtension } from "@knightcodeai/cli/desktop";
export default defineDesktopExtension((app) => {
	app.experimental_registerCommand({ id: "partial", label: () => "Must never publish", experimental_run: () => {} });
	throw new Error("Example activation failure");
});
