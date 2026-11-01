// The computer's terminal, docked under the screen: the same screen capability opened on its terminal. Typing needs
// control, like the screen itself.
import { useEffect, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { useStore } from "../state/store.ts";
import { ScreenViewer } from "./ScreenViewer.tsx";

/** Shows the terminal while the user has control; otherwise offers to take it. */
export function TerminalDock({
	botId,
	controlling,
	onTake,
	onClose,
}: {
	botId: string;
	controlling: boolean;
	onTake: () => void;
	onClose: () => void;
}) {
	const store = useStore();
	const [url, setUrl] = useState<string>();
	useEffect(() => {
		if (!controlling) return setUrl(undefined);
		let live = true;
		// The fragment never reaches the server, so the signed capability stays as issued.
		void store.api.getScreen({ botId, mode: "control" }).then((result) => live && setUrl(`${result.url}#terminal`));
		return () => {
			live = false;
		};
	}, [store, botId, controlling]);
	return (
		<section className="kb-dock" aria-label="Terminal">
			<header className="kb-dock__head">
				<span>Terminal</span>
				<button type="button" className="kb-link-button" onClick={onClose}>
					Close
				</button>
			</header>
			{controlling ? (
				<ScreenViewer
					capabilityUrl={url}
					mode="control"
					title="Terminal"
					status={<span className="kb-screen__label">Opening…</span>}
				/>
			) : (
				<div className="kb-dock__body">
					<p className="kb-settings__hint">
						Take control to type in the terminal. The bot pauses its own work on the screen meanwhile.
					</p>
					<Button variant="secondary" size="sm" onClick={onTake}>
						Take control
					</Button>
				</div>
			)}
		</section>
	);
}
