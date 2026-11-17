/** Built-in textarea adapter; no composer service relies on a textarea ref. */
import { useLayoutEffect, useMemo, useState } from "react";
import {
	experimental_useComposer,
	experimental_useComposerDraft,
	experimental_useComposerEditor,
	type experimental_EditorAdapter,
} from "@knightcodeai/cli/desktop";

export function TextareaEditor() {
	const { target, placeholder } = experimental_useComposer();
	const draft = experimental_useComposerDraft(target);
	const [element, setElement] = useState<HTMLTextAreaElement | null>(null);
	const adapter = useMemo<experimental_EditorAdapter | undefined>(
		() =>
			element
				? {
						experimental_read: () => ({
							text: element.value,
							selection: element.isConnected
								? { start: element.selectionStart, end: element.selectionEnd, direction: element.selectionDirection }
								: undefined,
							focused: document.activeElement === element,
							composing: false,
						}),
						experimental_apply: ({ text, selection }) => {
							if (element.value !== text) element.value = text;
							if (selection) element.setSelectionRange(selection.start, selection.end, selection.direction);
						},
						experimental_focus: () => element.focus(),
						experimental_caretAnchor: () => {
							if (!element.isConnected) return undefined;
							const rect = element.getBoundingClientRect();
							const style = getComputedStyle(element);
							const mirror = document.createElement("div");
							for (const property of [
								"font",
								"font-size",
								"font-family",
								"font-weight",
								"line-height",
								"letter-spacing",
								"padding",
								"border",
								"box-sizing",
								"word-spacing",
								"tab-size",
							])
								mirror.style.setProperty(property, style.getPropertyValue(property));
							Object.assign(mirror.style, {
								position: "fixed",
								left: `${rect.x}px`,
								top: `${rect.y}px`,
								width: `${rect.width}px`,
								height: "auto",
								whiteSpace: "pre-wrap",
								overflowWrap: "break-word",
								visibility: "hidden",
								pointerEvents: "none",
							});
							mirror.textContent = element.value.slice(0, element.selectionStart);
							const caret = document.createElement("span");
							caret.textContent = "\u200b";
							mirror.append(caret);
							document.body.append(mirror);
							const anchor = caret.getBoundingClientRect();
							mirror.remove();
							return {
								x: anchor.x - element.scrollLeft,
								y: anchor.y - element.scrollTop,
								width: 0,
								height: anchor.height || Number.parseFloat(style.lineHeight),
							};
						},
					}
				: undefined,
		[element],
	);
	experimental_useComposerEditor(adapter);
	useLayoutEffect(() => {
		if (!element) return;
		element.style.height = "auto";
		element.style.height = `${Math.min(element.scrollHeight, 300)}px`;
	}, [element, draft.text]);
	return (
		<textarea
			ref={setElement}
			defaultValue={draft.text}
			rows={1}
			aria-label="Message"
			data-kc-editor
			readOnly={draft.locked}
			placeholder={placeholder}
			className="selectable block max-h-[300px] min-h-11 w-full resize-none bg-transparent px-3 text-base leading-5 outline-none placeholder:text-tertiary focus-visible:outline-none"
		/>
	);
}
