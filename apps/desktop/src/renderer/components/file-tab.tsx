/**
 * A file tab (desktop-shell.md section 9.6), a read-only file viewer: a toolbar of
 * capsules, the path as a breadcrumb and the Open split button, over the file in @pierre/diffs' File view (12px code
 * on 22px lines, the Changes pane's theme) with the line it was opened at marked and scrolled into view. The server
 * reads the file (file/read), as it reads every file the desktop shows.
 */

import type { ResultOf } from "@knightcode/app-server-protocol";
import { isHighlighterLoaded, type FileOptions } from "@pierre/diffs";
import { File } from "@pierre/diffs/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.ts";
import diffOverrides from "../diff-overrides.css?raw";
import { basename } from "../format.ts";
import { errorText, useStore } from "../store.ts";
import { highlighterReady } from "./changes.tsx";
import { ChevronRight, File as FileIcon } from "./icons.tsx";
import { OpenInButton } from "./open-in.tsx";

type Read = ResultOf<"file/read">;

const slashes = (path: string) => path.replaceAll("\\", "/").replace(/\/+$/, "");

/** The breadcrumb: the thread's folder and the path under it, or the whole path for a file outside it. */
export function crumbs(path: string, cwd: string): string[] {
	const file = slashes(path);
	const root = slashes(cwd);
	const win = /^[a-zA-Z]:/.test(file);
	const within = root && (win ? file.toLowerCase() : file).startsWith(`${win ? root.toLowerCase() : root}/`);
	if (within) return [basename(root), ...file.slice(root.length + 1).split("/")];
	return file.split("/").filter(Boolean);
}

function Breadcrumb({ segments }: { segments: string[] }) {
	return (
		<div className="kc-capsule flex h-8 min-w-0 shrink items-center rounded-full p-0.5">
			<nav aria-label="File path" className="flex h-full min-w-0 items-center overflow-hidden px-2">
				<ol className="flex min-w-0 flex-1 items-center gap-1 text-[13px] leading-[18.5px] text-secondary select-text">
					{segments.map((segment, i) => {
						const last = i === segments.length - 1;
						return (
							<li key={i} className={`flex items-center gap-1 ${last ? "min-w-0" : "shrink-0"}`}>
								<span className={last ? "min-w-0 truncate font-medium text-ink" : "whitespace-nowrap"}>{segment}</span>
								{last ? null : <ChevronRight size={14} className="shrink-0 text-tertiary" />}
							</li>
						);
					})}
				</ol>
			</nav>
		</div>
	);
}

function Notice({ title, detail }: { title: string; detail?: string }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
			<FileIcon size={48} strokeWidth={0.85} className="mb-2 text-ink/85" />
			<div className="text-[15px] leading-6 font-semibold text-ink">{title}</div>
			{detail ? <div className="text-[13px] leading-5 text-tertiary">{detail}</div> : null}
		</div>
	);
}

export function FileTab({ threadId, path, line, used }: { threadId: string; path: string; line?: number; used: number }) {
	const thread = useStore((s) => s.held[threadId]?.thread);
	const version = useStore((s) => s.diffVersion[threadId] ?? 0);
	const themeType = useStore((s) => s.resolvedTheme) === "light" ? "light" : "dark";
	const [loaded, setLoaded] = useState<{ path: string; read?: Read; error?: string }>();
	const [highlighter, setHighlighter] = useState(isHighlighterLoaded);
	const body = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!highlighter) void highlighterReady.then(() => setHighlighter(true));
	}, [highlighter]);
	useEffect(() => {
		let live = true;
		const load = () =>
			client.request("file/read", { threadId, path }).then(
				(read) => live && setLoaded({ path, read }),
				(error: unknown) => live && setLoaded({ path, error: errorText(error) }),
			);
		void load();
		// A turn's edits and a return to the window both show the file as it is now.
		const onFocus = () => void load();
		window.addEventListener("focus", onFocus);
		return () => {
			live = false;
			window.removeEventListener("focus", onFocus);
		};
	}, [threadId, path, version]);

	const read = loaded?.path === path ? loaded.read : undefined;
	const error = loaded?.path === path ? loaded.error : undefined;
	// The same object while the text is the same, so a reload of an unchanged file redraws nothing.
	const file = useMemo(
		() => (read?.text !== undefined ? { name: basename(read.path), contents: read.text } : undefined),
		[read?.path, read?.text],
	);
	const options = useMemo<FileOptions<undefined, undefined>>(
		() => ({
			theme: { dark: "pierre-dark", light: "pierre-light" },
			themeType,
			overflow: "scroll",
			disableFileHeader: true,
			unsafeCSS: diffOverrides,
		}),
		[themeType],
	);
	// The line it was opened at, each time it is opened there (`used` changes): scrolled to the middle once, so a
	// reload after an edit leaves the user's own scrolling alone.
	const scrolled = useRef("");
	useEffect(() => {
		const key = `${path}:${line}:${used}`;
		if (!line || !file || !highlighter || scrolled.current === key) return;
		const frame = requestAnimationFrame(() => {
			const host = body.current?.querySelector("diffs-container") ?? body.current?.firstElementChild;
			const row = host?.shadowRoot?.querySelector(`[data-line="${line}"]`) ?? host?.querySelector(`[data-line="${line}"]`);
			const scroller = body.current;
			if (!row || !scroller) return;
			// Vertically only: scrollIntoView would also scroll the code sideways under its sticky line numbers.
			const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
			scroller.scrollTop += top - (scroller.clientHeight - row.getBoundingClientRect().height) / 2;
			scrolled.current = key;
		});
		return () => cancelAnimationFrame(frame);
	}, [path, line, used, file, highlighter]);

	const cwd = thread?.cwd ?? "";
	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col" aria-label={basename(path)}>
			<header className="relative z-20 flex shrink-0 items-center gap-1.5 p-2">
				<Breadcrumb segments={crumbs(read?.path ?? path, cwd)} />
				<div className="flex-1" />
				<OpenInButton path={read?.path ?? path} line={line} project={thread?.projectCwd ?? cwd} threadId={threadId} />
			</header>
			<div ref={body} className="min-h-0 flex-1 overflow-auto border-t border-line">
				{error ? (
					<Notice title="Could not open file" detail={error} />
				) : !read ? null : read.binary ? (
					<Notice title="Binary file not shown" detail="Open it in another app to see it." />
				) : read.tooLarge ? (
					<Notice title="This file is too large to preview in the side panel" detail="Open it in another app to see it." />
				) : file && highlighter ? (
					<File
						file={file}
						options={options}
						disableWorkerPool
						selectedLines={line ? { start: line, end: line } : null}
					/>
				) : null}
			</div>
		</div>
	);
}
