/** Built-in new-thread home, with host-owned setup and ordered extension sections. */
import { useEffect, useState } from "react";
import { HomeMark } from "./mark.tsx";
import {
	defineDesktopExtension,
	experimental_controls,
	experimental_shellServices,
	experimental_useThreadList,
	experimental_useNavigation,
	experimental_Slots as Slots,
} from "@knightcodeai/cli/desktop";
export function Home({ cwd: requested }: { cwd?: string }) {
	const { projects } = experimental_useThreadList();
	const {
		experimental_HomeSetup: HomeSetup,
		experimental_ProjectPicker: ProjectPicker,
		experimental_HomeComposer: Composer,
	} = experimental_controls();
	const { experimental_basename: basename } = experimental_shellServices();
	const [cwd, setCwd] = useState<string | undefined>(requested ?? projects[0]?.path);
	useEffect(() => {
		if (requested) setCwd(requested);
	}, [requested]);
	useEffect(() => {
		if (!cwd && projects[0]) setCwd(projects[0].path);
	}, [cwd, projects]);

	return (
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<div className="kc-home-content">
				<div className="kc-home-intro">
					<HomeSetup cwd={cwd} />
					<HomeMark />
					<Slots surface="homeSection" cwd={cwd} />
					<h1 className="text-center text-xl leading-[33.6px] font-normal text-ink">
						What should we build
						{cwd ? (
							<>
								{" in "}
								<ProjectPicker
									cwd={cwd}
									onChange={setCwd}
									side="bottom"
									trigger={() => (
										<button
											type="button"
											className="inline-block max-w-full align-baseline break-words underline decoration-tertiary decoration-dotted decoration-1 underline-offset-4 hover:text-secondary"
										>
											{basename(cwd)}?
										</button>
									)}
								/>
							</>
						) : (
							"?"
						)}
					</h1>
				</div>
			</div>
			<div className="shrink-0">
				<Composer cwd={cwd} onChange={setCwd} />
			</div>
		</div>
	);
}

function HomeProvider() {
	const { view } = experimental_useNavigation();
	return <Home key={view.kind === "new" ? view.cwd : ""} cwd={view.kind === "new" ? view.cwd : undefined} />;
}
export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "default", surface: "home", experimental_render: HomeProvider });
});
