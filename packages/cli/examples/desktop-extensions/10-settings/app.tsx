/** A declarative settings section, a custom section with a theme preview and owned portal, and a theme preset. */
import { useState } from "react";
import {
	defineDesktopExtension,
	experimental_appearance,
	experimental_Button as Button,
	experimental_Portal as Portal,
	experimental_settingsControls,
	experimental_ThemeScope as ThemeScope,
} from "@knightcodeai/cli/desktop";

function Preview() {
	const { experimental_Card: Card, experimental_Row: Row } = experimental_settingsControls();
	const { theme } = experimental_appearance().experimental_useState();
	const other = theme === "dark" ? "light" : "dark";
	const [open, setOpen] = useState(false);
	return (
		<Card title="Example preview">
			<Row title="Opposite theme" detail="A preview; the window's theme does not change">
				<ThemeScope theme={other} customization={{ accent: "#04bb9f" }}>
					<Button variant="soft" toolbar onClick={() => setOpen(!open)}>
						Open preview popup
					</Button>
					{open ? (
						<Portal>
							<p role="note" aria-label="Preview popup">
								Previewed in {other}
							</p>
						</Portal>
					) : null}
				</ThemeScope>
			</Row>
		</Card>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerSettingsSection({
		id: "options",
		page: "general",
		title: "Example extension",
		// App values by default; a project or one of its threads can override them.
		scopes: ["app", "project", "thread"],
		fields: [
			{ key: "greeting", title: "Show greeting", kind: "switch" },
			{
				key: "density",
				title: "Density",
				kind: "select",
				options: [
					["comfortable", "Comfortable"],
					["compact", "Compact"],
				],
			},
			{ key: "limit", title: "Item limit", kind: "number", min: 1, max: 100, unit: "items" },
		],
	});
	app.experimental_registerSettingsSection({ id: "preview", page: "appearance", experimental_render: Preview });
	app.experimental_registerThemePreset({
		id: "sea",
		label: "Sea",
		theme: "light",
		customization: { accent: "#04bb9f", background: "#f4fbfa" },
	});
});
