import {
	defineDesktopExtension,
	experimental_panelServices,
	type experimental_Checkout,
	type experimental_FileIntent,
} from "@knightcodeai/cli/desktop";
import { useEffect, useState } from "react";

function Viewer({ intent, signal }: { intent: experimental_FileIntent; signal: AbortSignal }) {
	const [text, setText] = useState("");
	const { path, target } = intent;
	useEffect(() => {
		let showing = true;
		const panel = experimental_panelServices().experimental_panel(target);
		void panel.experimental_readFile(path).then(
			(file) => {
				if (showing && !signal.aborted) setText(file?.text ?? "File is not available as text.");
			},
			() => {
				if (showing && !signal.aborted) setText("Could not read file.");
			},
		);
		return () => {
			showing = false;
		};
	}, [path, target.threadId, target.cwd, target.projectCwd, signal]);
	return <pre aria-label="Example file contents">{text}</pre>;
}

function OpenReadme({ target }: { target: experimental_Checkout }) {
	return (
		<button
			onClick={() => {
				const panel = experimental_panelServices().experimental_panel(target);
				const opener = panel
					.experimental_fileOpeners("README.md")
					.find((entry) => entry.label === "Example text viewer");
				if (opener) panel.experimental_openFile("README.md", undefined, opener.id);
			}}
		>
			Open README in example viewer
		</button>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerPanelTab({
		id: "file",
		label: "File viewer example",
		experimental_render: ({ context, signal }) =>
			context.file ? (
				<Viewer key={context.file.path} intent={context.file} signal={signal} />
			) : context.workspace ? (
				<OpenReadme target={context.workspace} />
			) : null,
	});
	app.experimental_registerFileOpener({
		id: "text",
		label: "Example text viewer",
		tab: "file",
		experimental_matches: ({ path }) => /\.(md|txt)$/i.test(path),
	});
});
