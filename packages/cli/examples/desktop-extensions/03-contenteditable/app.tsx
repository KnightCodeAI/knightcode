/** A genuinely different editor using only the public root, adapter and shared composer layout. */
import { useEffect, useMemo, useState } from "react";
import {
	defineDesktopExtension,
	experimental_ComposerFrame as ComposerFrame,
	experimental_Button as Button,
	experimental_controls,
	type experimental_ComposerState,
	experimental_useComposer,
	experimental_useComposerDraft,
	experimental_useComposerEditor,
	type experimental_EditorAdapter,
	type experimental_EditorSelection,
	type experimental_EditorMount,
} from "@knightcodeai/cli/desktop";

let retired: experimental_EditorMount | undefined;
let capturedSubmit: experimental_ComposerState["submit"] | undefined;

function ContentEditor() {
	const { target, controller, placeholder } = experimental_useComposer();
	const draft = experimental_useComposerDraft(target);
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const adapter = useMemo<experimental_EditorAdapter | undefined>(() => {
		if (!element) return undefined;
		let saved: experimental_EditorSelection | undefined;
		const offset = (node: Node, at: number) => {
			const range = document.createRange();
			range.selectNodeContents(element);
			range.setEnd(node, at);
			return range.toString().length;
		};
		const point = (position: number): { node: Node; offset: number } => {
			const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
			let node = walker.nextNode();
			let remaining = position;
			while (node) {
				const length = node.textContent?.length ?? 0;
				if (remaining <= length) return { node, offset: remaining };
				remaining -= length;
				node = walker.nextNode();
			}
			return { node: element, offset: element.childNodes.length };
		};
		const rangeAt = (position: number) => {
			const pointAt = point(position);
			const range = document.createRange();
			range.setStart(pointAt.node, pointAt.offset);
			range.collapse(true);
			return range;
		};
		return {
			experimental_read: () => {
				const selection = window.getSelection();
				if (
					selection?.anchorNode &&
					selection.focusNode &&
					element.contains(selection.anchorNode) &&
					element.contains(selection.focusNode)
				) {
					const anchor = offset(selection.anchorNode, selection.anchorOffset);
					const focus = offset(selection.focusNode, selection.focusOffset);
					saved = {
						start: Math.min(anchor, focus),
						end: Math.max(anchor, focus),
						direction: anchor === focus ? "none" : anchor < focus ? "forward" : "backward",
					};
				}
				return {
					text: element.textContent ?? "",
					selection: saved,
					focused: document.activeElement === element,
					composing: false,
				};
			},
			experimental_apply: ({ text, selection }) => {
				if (element.textContent !== text) element.textContent = text;
				saved = selection;
				if (!selection) return;
				const start = point(selection.start);
				const end = point(selection.end);
				const native = window.getSelection();
				if (selection.direction === "backward")
					native?.setBaseAndExtent(end.node, end.offset, start.node, start.offset);
				else native?.setBaseAndExtent(start.node, start.offset, end.node, end.offset);
			},
			experimental_focus: () => element.focus(),
			experimental_caretAnchor: () => {
				if (!saved || !element.isConnected) return undefined;
				const rect = rangeAt(saved.end).getBoundingClientRect();
				const fallback = element.getBoundingClientRect();
				return {
					x: rect.height ? rect.x : fallback.x,
					y: rect.height ? rect.y : fallback.y,
					width: 0,
					height: rect.height || 20,
				};
			},
		};
	}, [element]);
	const mount = experimental_useComposerEditor(adapter);
	useEffect(
		() => () => {
			if (mount) retired = mount;
		},
		[mount],
	);
	return (
		<div
			ref={setElement}
			role="textbox"
			aria-label="Message"
			aria-multiline="true"
			data-kc-editor
			contentEditable={!draft.locked}
			suppressContentEditableWarning
			data-placeholder={placeholder}
			onBeforeInput={(event) => {
				const native = event.nativeEvent as InputEvent;
				if (native.inputType !== "insertParagraph" && native.inputType !== "insertLineBreak") return;
				event.preventDefault();
				controller.experimental_insert("\n", controller.experimental_getSnapshot().revision);
			}}
			onPaste={(event) => {
				if ([...event.clipboardData.items].some((item) => item.type.startsWith("image/"))) return;
				event.preventDefault();
				controller.experimental_insert(
					event.clipboardData.getData("text/plain"),
					controller.experimental_getSnapshot().revision,
				);
			}}
			className="content-editor"
		/>
	);
}

function RetiredMountAction() {
	const [status, setStatus] = useState("");
	const [capturedStatus, setCapturedStatus] = useState("");
	const { submit } = experimental_useComposer();
	const {
		experimental_Menu: Menu,
		experimental_MenuTrigger: Trigger,
		experimental_MenuContent: Content,
		experimental_MenuItem: Item,
	} = experimental_controls();
	return (
		<>
			<Menu>
				<Trigger>
					<Button size="xs" aria-label="Editor contract checks">
						Editor
					</Button>
				</Trigger>
				<Content side="top">
					<Item
						onSelect={() => {
							retired?.dispose();
							setStatus(retired?.experimental_report(0).status ?? "none");
						}}
					>
						Dispose previous editor
					</Item>
					<Item
						onSelect={() => {
							capturedSubmit = submit;
						}}
					>
						Capture submit callback
					</Item>
					<Item onSelect={() => setCapturedStatus(capturedSubmit ? capturedSubmit(false).status : "none")}>
						Run captured submit callback
					</Item>
				</Content>
			</Menu>
			<output aria-label="Retired editor result">{status}</output>
			<output aria-label="Captured submit result">{capturedStatus}</output>
		</>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerSlot({ id: "retired", surface: "composerActions", experimental_render: RetiredMountAction });
	app.experimental_registerProvider({
		id: "composer",
		surface: "composer",
		experimental_render: () => <ComposerFrame editor={<ContentEditor />} />,
	});
});
