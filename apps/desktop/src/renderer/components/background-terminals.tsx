/**
 * Background terminals: the commands the agent left running after their calls returned. The thread's summary lists
 * the running ones under "Background processes", each opening its output in a side panel tab and stopping on hover;
 * the tab draws the command's output in a read-only terminal, following it while it runs.
 */

import type { BackgroundShell } from "@knightcode/app-server-protocol";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { client } from "../client.ts";
import { selectPreferences, stopBackgroundShell, useStore } from "../store.ts";
import { IconButton } from "./button.tsx";
import { Spinner, Square, SquareTerminal } from "./icons.tsx";
import { linkProvider, terminalTheme } from "./terminal.tsx";
import { Tooltip } from "./tooltip.tsx";

/** A command on one line, as a row or a tab names it. */
export const commandLabel = (command: string) => command.trim().split("\n")[0] || "Background terminal";

const NO_SHELLS: BackgroundShell[] = [];

/** The summary's "Background processes": a count, then a row per running command, Stop shown on hover. */
export function BackgroundProcessesSection({
	threadId,
	onOpen,
}: {
	threadId: string;
	onOpen: (shell: BackgroundShell) => void;
}) {
	const shells = useStore((s) => s.held[threadId]?.backgroundShells ?? NO_SHELLS);
	const running = useMemo(() => shells.filter((s) => s.status === "running"), [shells]);
	// One stop at a time, its row's button a spinner until the server answers.
	const [stopping, setStopping] = useState<string>();
	if (running.length === 0) return null;
	return (
		<>
			<div className="mt-1 flex h-9 items-center gap-1.5 ps-3 text-sm text-tertiary">
				Background processes <span className="tabular-nums">{running.length}</span>
			</div>
			{running.map((shell) => (
				<div key={shell.id} className="group flex h-[34px] items-center rounded-xl pe-1 hover:bg-ghost-hover">
					<button
						type="button"
						onClick={() => onOpen(shell)}
						className="flex h-full min-w-0 flex-1 items-center gap-2.5 ps-3 text-start text-base text-ink"
					>
						<SquareTerminal size={16} className="shrink-0 text-secondary" />
						<Tooltip content={shell.command} align="start" overflow>
							<span className="min-w-0 truncate">{commandLabel(shell.command)}</span>
						</Tooltip>
					</button>
					<IconButton
						label="Stop background terminal"
						round
						disabled={stopping !== undefined}
						className={
							stopping === shell.id ? "" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
						}
						onClick={() => {
							setStopping(shell.id);
							void stopBackgroundShell(threadId, shell.id).finally(() => setStopping(undefined));
						}}
					>
						{stopping === shell.id ? <Spinner size={16} className="motion-safe:animate-spin" /> : <Square size={16} />}
					</IconButton>
				</div>
			))}
		</>
	);
}

/** How much of the last output a read must find again in the next to append to it rather than start over. */
const OVERLAP = 2048;

/** Output in a terminal that takes no input: appended as it grows, and kept in sight at its end. */
function OutputTerminal({ output }: { output: string }) {
	const host = useRef<HTMLDivElement>(null);
	const term = useRef<Terminal | undefined>(undefined);
	const fit = useRef<FitAddon | undefined>(undefined);
	const written = useRef("");
	const theme = useStore((s) => s.resolvedTheme);
	const fontSize = useStore((s) => selectPreferences(s).codeFontSize ?? 12);

	useEffect(() => {
		const element = host.current!;
		const xterm = new Terminal({
			fontFamily: getComputedStyle(element).getPropertyValue("--kc-font-code"),
			fontSize,
			lineHeight: 1.2,
			theme: terminalTheme(element),
			disableStdin: true,
			cursorStyle: "bar",
			cursorInactiveStyle: "none",
			// A command's output has bare newlines, which a terminal only takes as line feeds.
			convertEol: true,
			scrollback: 5000,
			linkHandler: { activate: (_event, url) => void client.host("host/shell/openExternal", { url }).catch(() => {}) },
		});
		const fitter = new FitAddon();
		xterm.loadAddon(fitter);
		xterm.registerLinkProvider(linkProvider(xterm));
		xterm.open(element);
		term.current = xterm;
		fit.current = fitter;
		written.current = "";
		const observer = new ResizeObserver(() => {
			if (element.offsetParent) fitter.fit();
		});
		observer.observe(element);
		return () => {
			observer.disconnect();
			xterm.dispose();
			term.current = undefined;
			fit.current = undefined;
		};
		// The font size and theme update in place (below).
	}, []);

	useEffect(() => {
		const xterm = term.current;
		if (!xterm || !host.current) return;
		xterm.options.theme = terminalTheme(host.current);
		xterm.options.fontSize = fontSize;
		if (host.current.offsetParent) fit.current?.fit();
	}, [theme, fontSize]);

	useEffect(() => {
		const xterm = term.current;
		if (!xterm) return;
		const before = written.current;
		// The server keeps only the end of a running command's output, so a read can start past where the last one did:
		// what follows the last read's end is new. Output that no longer holds it starts the view over.
		// ponytail: a 2 KB overlap; output that repeats whole 2 KB blocks can append twice, stream deltas if it shows.
		const tail = before.slice(-OVERLAP);
		const at = before ? (output.startsWith(before) ? before.length : output.lastIndexOf(tail) + tail.length) : 0;
		if (before && at < tail.length) {
			xterm.reset();
			xterm.write(output);
		} else xterm.write(output.slice(at));
		written.current = output;
	}, [output]);

	return (
		<div className="relative flex h-full w-full flex-col bg-[var(--kc-terminal-bg)] text-[var(--kc-terminal-fg)]">
			<div className="flex-1 overflow-hidden py-3 ps-3 tracking-normal">
				<div ref={host} className="h-full w-full overflow-hidden" />
			</div>
		</div>
	);
}

/**
 * A background command's output tab. It reads the output on open, once a second while the command runs, and once
 * more when it ends.
 */
export function BackgroundShellTab({ threadId, id }: { threadId: string; id: string }) {
	const running = useStore(
		(s) => s.held[threadId]?.backgroundShells?.find((shell) => shell.id === id)?.status === "running",
	);
	const [output, setOutput] = useState<string>();
	const [gone, setGone] = useState(false);
	useEffect(() => {
		let closed = false;
		const read = () =>
			client.request("thread/backgroundShells/output", { threadId, id }).then(
				(result) => {
					if (!closed) setOutput(result.output);
				},
				() => {
					if (!closed) setGone(true);
				},
			);
		void read();
		// ponytail: polls the kept end of the output; push output deltas if a second's lag or the 50 KB end falls short.
		const timer = running ? setInterval(() => void read(), 1000) : undefined;
		return () => {
			closed = true;
			clearInterval(timer);
		};
	}, [threadId, id, running]);
	return (
		<div className="flex min-h-0 flex-1 flex-col bg-surface">
			{output ? (
				<OutputTerminal output={output} />
			) : (
				<div className="p-4 font-code text-code text-tertiary">
					{gone && output === undefined ? "This command's output is no longer kept" : "No output yet"}
				</div>
			)}
		</div>
	);
}
