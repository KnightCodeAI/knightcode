/** A second owner's actions, banner, menu and owned popup work with either composer editor. */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
	defineDesktopExtension,
	experimental_composer,
	experimental_Button as Button,
	experimental_Portal as Portal,
	experimental_useComposer,
	experimental_shellServices,
	type experimental_CommandContext,
	type experimental_ComposerTarget,
	type experimental_EditorSelection,
} from "@knightcodeai/cli/desktop";

let popup:
	{ target: experimental_ComposerTarget; revision: number; selection?: experimental_EditorSelection } | undefined;
const listeners = new Set<() => void>();
const publish = () => {
	for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
function Actions({ context, signal }: { context: experimental_CommandContext; signal: AbortSignal }) {
	const [locked, setLocked] = useState<{ dispose(): void }>();
	const [anchor, setAnchor] = useState("");
	useEffect(() => () => locked?.dispose(), [locked]);
	if (!context.composer) return null;
	const controller = experimental_composer(context.composer);
	return (
		<>
			<Button
				size="xs"
				aria-label="Insert review note"
				onClick={() => {
					const result = controller.experimental_insert("review", controller.experimental_getSnapshot().revision);
					if (result.status === "applied") controller.experimental_focus();
				}}
			>
				Review
			</Button>
			<Button
				size="xs"
				aria-label="Review popup"
				onClick={() => {
					const draft = controller.experimental_getSnapshot();
					popup = { target: context.composer!, revision: draft.revision, selection: draft.selection };
					publish();
				}}
			>
				Popup
			</Button>
			<Button
				size="xs"
				aria-label={locked ? "Unlock input" : "Lock input"}
				onClick={() => {
					if (locked) {
						locked.dispose();
						setLocked(undefined);
					} else setLocked(controller.experimental_lock(signal));
				}}
			>
				Lock
			</Button>
			<Button size="xs" aria-label="Focus editor end" onClick={() => controller.experimental_focusEnd()}>
				End
			</Button>
			<Button
				size="xs"
				aria-label="Read caret anchor"
				onClick={() => {
					const value = controller.experimental_caretAnchor();
					setAnchor(value ? `${Math.round(value.x)},${Math.round(value.y)}` : "unavailable");
				}}
			>
				Caret
			</Button>
			{anchor ? <output aria-label="Caret anchor">{anchor}</output> : null}
		</>
	);
}
function Popup() {
	const captured = useSyncExternalStore(subscribe, () => popup);
	const [result, setResult] = useState("");
	const [note, setNote] = useState("popup");
	if (!captured) return null;
	const close = () => {
		popup = undefined;
		publish();
		experimental_composer(captured.target).experimental_focus();
	};
	return (
		<Portal>
			<div
				role="dialog"
				aria-label="Review insertion"
				className="review-popup"
				onKeyDown={(event) => {
					if (experimental_shellServices().experimental_matches(event, "desktop.picker.dismiss")) {
						event.preventDefault();
						close();
					}
				}}
			>
				<input autoFocus aria-label="Popup note" value={note} onChange={(event) => setNote(event.target.value)} />
				<p>Insert at the selection captured when this popup opened.</p>
				<Button
					onClick={() => {
						const controller = experimental_composer(captured.target);
						const outcome = captured.selection
							? controller.experimental_replace(captured.selection, note, captured.revision)
							: { status: "unavailable" };
						setResult(outcome.status);
						if (outcome.status === "applied") close();
					}}
				>
					Insert popup note
				</Button>
				<Button onClick={close}>Close review popup</Button>
				<output>{result}</output>
			</div>
		</Portal>
	);
}
function MenuItem({ context }: { context: experimental_CommandContext }) {
	const { dismissSuggestions } = experimental_useComposer();
	if (!context.composer) return null;
	const controller = experimental_composer(context.composer);
	return (
		<button
			type="button"
			className="review-menu"
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => {
				if (
					controller.experimental_insert("menu", controller.experimental_getSnapshot().revision).status === "applied"
				) {
					dismissSuggestions();
					controller.experimental_focus();
				}
			}}
		>
			Insert review menu note
		</button>
	);
}
export default defineDesktopExtension((app) => {
	app.experimental_registerSlot({ id: "action", surface: "composerActions", experimental_render: Actions });
	app.experimental_registerSlot({
		id: "banner",
		surface: "composerBanners",
		experimental_render: () => <p className="review-banner">Review before sending</p>,
	});
	app.experimental_registerSlot({ id: "menu", surface: "composerAddMenu", experimental_render: MenuItem });
	app.experimental_registerSlot({ id: "popup", surface: "composerPopups", experimental_render: Popup });
});
