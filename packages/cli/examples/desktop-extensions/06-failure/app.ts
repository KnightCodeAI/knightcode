/** Select this provider explicitly to exercise render failure and built-in fallback. */
import { defineDesktopExtension, experimental_controllers } from "@knightcodeai/cli/desktop";
export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({
		id: "broken",
		surface: "feedback",
		experimental_render: () => {
			throw new Error("Example provider render failure");
		},
	});
	app.experimental_registerCommand({
		id: "notify",
		label: () => "External test notice",
		experimental_run: () =>
			experimental_controllers().experimental_notify("External command reached the host", "success"),
	});
	app.experimental_onDispose(() => console.info("Failure example activation disposed"));
});
