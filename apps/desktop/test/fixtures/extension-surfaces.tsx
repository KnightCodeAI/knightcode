/** Real React client fixture for contribution render errors, fallback ownership and recovery. */
import { defineDesktopExtension } from "@knightcodeai/cli/desktop";
import { createRoot } from "react-dom/client";
import { ExtensionRegistry } from "../../src/renderer/extensions/registry.ts";
import { SurfaceHost } from "../../src/renderer/extensions/surface.tsx";

const registry = new ExtensionRegistry();
const preference = "external/view";
registry.register(
	"builtin",
	defineDesktopExtension((app) => {
		app.experimental_registerProvider({
			id: "view",
			surface: "feedback",
			experimental_render: () => <p>Built-in feedback</p>,
		});
	}),
);
let external = registry.register(
	"external",
	defineDesktopExtension((app) => {
		app.experimental_registerProvider({
			id: "view",
			surface: "feedback",
			experimental_render: () => {
				throw new Error("provider failed");
			},
		});
	}),
);
registry.register(
	"broken",
	defineDesktopExtension((app) => {
		app.experimental_registerSlot({
			id: "slot",
			surface: "feedback",
			experimental_render: () => {
				throw new Error("slot failed");
			},
		});
	}),
);
registry.register(
	"healthy",
	defineDesktopExtension((app) => {
		app.experimental_registerSlot({ id: "slot", surface: "feedback", experimental_render: () => <p>Healthy slot</p> });
	}),
);

createRoot(document.getElementById("root")!).render(
	<>
		<SurfaceHost
			registry={registry}
			surface="feedback"
			builtin="builtin/view"
			preferred={preference}
			context={{ sidebarOpen: true }}
		/>
		<p role="status">Preference: {preference}</p>
		<button
			onClick={() => {
				external.dispose();
				external = registry.register(
					"external",
					defineDesktopExtension((app) => {
						app.experimental_registerProvider({
							id: "view",
							surface: "feedback",
							experimental_render: () => <p>Recovered provider</p>,
						});
					}),
				);
			}}
		>
			Replace failed provider
		</button>
		<button onClick={() => external.dispose()}>Remove provider</button>
	</>,
);
