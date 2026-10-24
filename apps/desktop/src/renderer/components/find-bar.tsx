/**
 * Find in the thread (View › Find, Ctrl+F), after Codex's find bar (measured 2026-10-19): a 340px pill floating at the
 * window's top right, clear of the caption buttons, on the darker surface with 20px corners and a hairline; the
 * search field, the scopes (the thread, or the Changes pane's diffs, which it opens), a rule and Close; once there is a
 * query, a second row with Previous and Next and "1 / 6 results". Matches are painted with the CSS Custom Highlight API
 * in Codex's yellow, the current one in its orange, so the DOM (React's, and the diffs' shadow trees) is never touched;
 * they follow streaming text and redrawn diffs.
 */

import { type RefObject, useEffect, useRef, useState } from "react";
import { matchOffsets } from "../format.ts";
import { matches, useBinding } from "../keys.ts";
import { showChanges, useStore } from "../store.ts";
import { IconButton } from "./button.tsx";
import { ArrowDown, ArrowUp, FileDiff, MessageSquare, Search, X } from "./icons.tsx";

/** The Changes pane's file list, which the diffs scope leaves out. */
const SKIP = "file-tree-container";

/**
 * Every match of `query` in the text under `root`, in document order, into open shadow trees (the diffs render in
 * theirs); a match does not span elements. Also the shadow roots it went through, to watch them.
 */
function findRanges(root: Node, query: string, shadows: ShadowRoot[] = []): { ranges: Range[]; shadows: ShadowRoot[] } {
	const ranges: Range[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
		acceptNode: (node) =>
			node instanceof Element && node.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
	});
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node instanceof Element) {
			if (node.shadowRoot) {
				shadows.push(node.shadowRoot);
				ranges.push(...findRanges(node.shadowRoot, query, shadows).ranges);
			}
			continue;
		}
		for (const start of matchOffsets(node.textContent ?? "", query)) {
			const range = document.createRange();
			range.setStart(node, start);
			range.setEnd(node, start + query.length);
			ranges.push(range);
		}
	}
	return { ranges, shadows };
}

/**
 * Bring a match to the middle of the nearest vertical scroller (crossing shadow hosts), without scrolling sideways:
 * a diff's sticky line numbers would cover a match scrolled to the edge.
 */
function scrollToRange(range: Range): void {
	let node: Node | null = range.startContainer;
	while (node) {
		const element: Element | null = node instanceof Element ? node : node.parentElement;
		if (!element) {
			node = node instanceof ShadowRoot ? node.host : node.parentNode;
			continue;
		}
		const overflow = getComputedStyle(element).overflowY;
		if ((overflow === "auto" || overflow === "scroll") && element.scrollHeight > element.clientHeight) {
			const offset = range.getBoundingClientRect().top - element.getBoundingClientRect().top;
			element.scrollTop += offset - element.clientHeight / 2;
			return;
		}
		node = element.parentNode instanceof ShadowRoot ? element.parentNode.host : element.parentNode;
	}
}

export function FindBar({ root, onClose }: { root: RefObject<HTMLElement | null>; onClose: () => void }) {
	const input = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState("");
	const [ranges, setRanges] = useState<Range[]>([]);
	const [active, setActive] = useState(0);
	const [scope, setScope] = useState<"thread" | "diffs">("thread");
	const panelOpen = useStore((s) => s.panel.open);
	// Ctrl+F again returns to the field with the query selected.
	useBinding("desktop.thread.find", () => {
		input.current?.focus();
		input.current?.select();
	});

	// Find again whenever the query or the text changes (a streaming reply, an earlier page, a redrawn diff).
	useEffect(() => {
		const element = scope === "thread" ? root.current : document.querySelector<HTMLElement>(".kc-changes");
		if (!element) {
			setRanges([]);
			return;
		}
		const options = { subtree: true, childList: true, characterData: true };
		let frame = 0;
		const observer = new MutationObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(update);
		});
		const watched = new Set<Node>();
		const watch = (node: Node) => {
			if (watched.has(node)) return;
			watched.add(node);
			observer.observe(node, options);
		};
		function update() {
			const found = query ? findRanges(element!, query) : { ranges: [], shadows: [] };
			found.shadows.forEach(watch);
			setRanges(found.ranges);
		}
		watch(element);
		update();
		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [root, query, scope, panelOpen]);
	useEffect(() => setActive(0), [query, scope]);
	const choose = (next: "thread" | "diffs") => {
		setScope(next);
		if (next === "diffs") showChanges();
		input.current?.focus();
	};

	const current = ranges.length ? Math.min(active, ranges.length - 1) : -1;
	useEffect(() => {
		// add(), not a spread: a one-letter search of a large diff finds more ranges than a call takes arguments.
		const others = new Highlight();
		ranges.forEach((range, i) => i !== current && others.add(range));
		CSS.highlights.set("kc-find", others);
		const chosen = new Highlight();
		const target = ranges[current];
		if (target) chosen.add(target);
		CSS.highlights.set("kc-find-active", chosen);
	}, [ranges, current]);
	// Scroll when the search or the chosen match changes, not on each DOM change (a streaming reply re-finds every frame).
	const scrolledTo = useRef("");
	useEffect(() => {
		const target = ranges[current];
		const key = JSON.stringify([query, scope, current]);
		if (target && scrolledTo.current !== key) {
			scrolledTo.current = key;
			scrollToRange(target);
		}
	}, [ranges, current, query, scope]);
	useEffect(
		() => () => {
			CSS.highlights.delete("kc-find");
			CSS.highlights.delete("kc-find-active");
		},
		[],
	);

	const step = (by: 1 | -1) => ranges.length && setActive((current + by + ranges.length) % ranges.length);
	return (
		<div
			role="search"
			aria-label="Find in thread"
			className="no-drag fixed top-2 right-[150px] z-40 w-[340px] max-w-[calc(100vw-160px)] rounded-2xl border border-line bg-surface-secondary"
		>
			<div className="flex h-11 items-center">
				<label className="flex min-w-0 flex-1 items-center gap-2 ps-4">
					<Search size={16} className="shrink-0" />
					<input
						ref={input}
						autoFocus
						value={query}
						aria-label={scope === "thread" ? "Find in thread" : "Find in diffs"}
						placeholder={scope === "thread" ? "Search thread…" : "Search diffs…"}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => {
							if (matches(e, "desktop.find.previous")) step(-1);
							else if (matches(e, "desktop.find.next")) step(1);
							else if (matches(e, "desktop.picker.dismiss")) onClose();
							else return;
							e.preventDefault();
						}}
						className="h-6 min-w-0 flex-1 bg-transparent text-base leading-6 outline-none placeholder:text-tertiary focus-visible:outline-none"
					/>
				</label>
				<div role="group" aria-label="Search in" className="flex items-center gap-2 ps-2">
					<IconButton
						label="Search thread"
						size="xs"
						aria-pressed={scope === "thread"}
						onClick={() => choose("thread")}
					>
						<MessageSquare size={16} />
					</IconButton>
					<IconButton label="Search diffs" size="xs" aria-pressed={scope === "diffs"} onClick={() => choose("diffs")}>
						<FileDiff size={16} />
					</IconButton>
				</div>
				<div className="flex items-center gap-2 pe-4 ps-2">
					<div className="h-4 w-px bg-line" />
					<IconButton label="Close find" size="xs" onClick={onClose}>
						<X size={16} />
					</IconButton>
				</div>
			</div>
			{query ? (
				<div className="flex h-9 items-center justify-between border-t border-line px-4 text-base leading-6 text-tertiary">
					<div className="flex items-center gap-3">
						<IconButton label="Previous result" size="3xs" toolbar disabled={!ranges.length} onClick={() => step(-1)}>
							<ArrowUp size={16} />
						</IconButton>
						<IconButton label="Next result" size="3xs" toolbar disabled={!ranges.length} onClick={() => step(1)}>
							<ArrowDown size={16} />
						</IconButton>
					</div>
					<span aria-live="polite">{ranges.length ? `${current + 1} / ${ranges.length} results` : "No results"}</span>
				</div>
			) : null}
		</div>
	);
}
