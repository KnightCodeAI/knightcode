/** Built-in rail/card/sidebar/content arrangement, composed through public surface hosts. */
import {
	defineDesktopExtension,
	experimental_SurfaceHost as Surface,
	experimental_Content as Content,
	experimental_useNavigation,
} from "@knightcodeai/cli/desktop";

export function Layout() {
	const { sidebarOpen } = experimental_useNavigation();
	return (
		<div className="kc-app-body flex min-h-0 flex-1 pt-2 pe-1 pb-1">
			<Surface surface="navigation" />
			<div className="kc-app-card flex min-w-0 flex-1 overflow-hidden rounded-tl-[12px] rounded-tr-[12px] rounded-br-[4px] rounded-bl-[12px]">
				<div className="kc-sidebar-slot flex shrink-0" data-open={sidebarOpen || undefined} inert={!sidebarOpen}>
					<Surface surface="threadList" />
				</div>
				<main className={`flex min-w-0 flex-1 bg-surface ${sidebarOpen ? "border-l border-line" : ""}`}>
					<Content />
				</main>
			</div>
		</div>
	);
}
export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "default", surface: "layout", experimental_render: Layout });
});
