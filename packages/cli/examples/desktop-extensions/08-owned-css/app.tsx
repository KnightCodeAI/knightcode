/** Authored external-only classes and an owned portal, using the host's shared React. */
import { useState } from "react";
import { defineDesktopExtension, experimental_Portal as Portal } from "@knightcodeai/cli/desktop";
function Example() {
	const [open, setOpen] = useState(false);
	return (
		<div className="external-only">
			<button className="external-button" onClick={() => setOpen(!open)}>
				Owned CSS example
			</button>
			{open ? (
				<Portal>
					<div className="external-popup">
						<button onClick={() => setOpen(false)}>Close owned portal</button>
						<p>Owned portal follows the theme</p>
					</div>
				</Portal>
			) : null}
		</div>
	);
}
export default defineDesktopExtension((app) => {
	app.experimental_registerSlot({ id: "example", surface: "feedback", experimental_render: Example });
});
