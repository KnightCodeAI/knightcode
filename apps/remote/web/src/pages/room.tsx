import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFrame, type StampedFrame } from "../../../../../packages/remote/src/protocol.ts";
import { toTranscriptEntry, type TranscriptEntry } from "../lib/entries.ts";
import { renderMarkdown } from "../lib/markdown.ts";
import "../styles/room.css";

type Connection = "connecting" | "live" | "reconnecting" | "offline";

const RECONNECT_MS = 2000;

function Entry({ entry }: { entry: TranscriptEntry }): React.JSX.Element {
	return (
		<article className={`entry entry-${entry.role}`}>
			{entry.text.trim().length > 0 ? (
				// Safe: renderMarkdown escapes the source before it emits any tag.
				<p dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.text) }} />
			) : null}
			{entry.toolCalls.map((call, index) => (
				<details className="tool" key={`${call.name}-${index}`}>
					<summary>{call.name}</summary>
					<pre>
						<code>{JSON.stringify(call.arguments, null, 2)}</code>
					</pre>
				</details>
			))}
		</article>
	);
}

export function Room({ roomId }: { roomId: string }): React.JSX.Element {
	const [entries, setEntries] = useState<TranscriptEntry[]>([]);
	const [liveText, setLiveText] = useState<string>();
	const [sessionName, setSessionName] = useState("Session");
	const [connection, setConnection] = useState<Connection>("connecting");
	const [streaming, setStreaming] = useState(false);
	const [draft, setDraft] = useState("");

	const socket = useRef<WebSocket>(null);
	const lastSeq = useRef(0);
	const transcript = useRef<HTMLElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);

	const applyFrame = useCallback((frame: StampedFrame): void => {
		if (typeof frame.seq === "number") lastSeq.current = Math.max(lastSeq.current, frame.seq);
		if (frame.type === "snapshot") {
			if (frame.sessionName) setSessionName(frame.sessionName);
			setLiveText(undefined);
			setEntries(frame.entries.map(toTranscriptEntry).filter((entry) => entry !== undefined));
		} else if (frame.type === "entries") {
			// The streamed draft is replaced by the finished entries it was previewing.
			setLiveText(undefined);
			setEntries((current) => [
				...current,
				...frame.entries.map(toTranscriptEntry).filter((entry) => entry !== undefined),
			]);
		} else if (frame.type === "stream") {
			setLiveText(frame.content);
		} else if (frame.type === "status") {
			setStreaming(frame.streaming);
		} else if (frame.type === "bye") {
			setConnection("offline");
		}
	}, []);

	useEffect(() => {
		let closed = false;
		let retry: ReturnType<typeof setTimeout>;

		const connect = (): void => {
			const next = new WebSocket(`${location.origin.replace(/^http/, "ws")}/r/${roomId}/ws`);
			socket.current = next;
			next.addEventListener("open", () => {
				setConnection("live");
				// `since` resumes the stream where this viewer left off instead of refetching it all.
				next.send(encodeFrame(lastSeq.current > 0 ? { v: 1, type: "hello", since: lastSeq.current } : { v: 1, type: "hello" }));
			});
			next.addEventListener("message", (event) => {
				try {
					applyFrame(JSON.parse(String(event.data)) as StampedFrame);
				} catch {
					// A frame the client cannot parse is skipped rather than breaking the stream.
				}
			});
			next.addEventListener("close", () => {
				if (closed) return;
				setConnection("reconnecting");
				retry = setTimeout(connect, RECONNECT_MS);
			});
		};

		connect();
		return () => {
			closed = true;
			clearTimeout(retry);
			socket.current?.close();
		};
	}, [roomId, applyFrame]);

	// Follow the tail the way a terminal does.
	useEffect(() => {
		const node = transcript.current;
		if (node) node.scrollTop = node.scrollHeight;
	}, [entries, liveText]);

	// Keep the composer above the iOS keyboard rather than under it.
	useEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const onResize = (): void =>
			document.documentElement.style.setProperty("--viewport-height", `${viewport.height}px`);
		viewport.addEventListener("resize", onResize);
		return () => viewport.removeEventListener("resize", onResize);
	}, []);

	const send = (event: React.FormEvent): void => {
		event.preventDefault();
		const text = draft.trim();
		if (text.length === 0 || socket.current?.readyState !== WebSocket.OPEN) return;
		socket.current.send(encodeFrame({ v: 1, type: "prompt", text }));
		setDraft("");
		if (input.current) input.current.style.height = "auto";
	};

	const stop = (): void => {
		if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(encodeFrame({ v: 1, type: "abort" }));
	};

	return (
		<>
			<header className="glass topbar">
				<span className="session-title">{sessionName}</span>
				<span className={connection === "live" ? "pill" : "pill offline"}>{connection}</span>
			</header>

			<main id="transcript" ref={transcript}>
				{entries.map((entry, index) => (
					<Entry key={index} entry={entry} />
				))}
				{liveText !== undefined ? (
					<article
						className="entry entry-assistant entry-live"
						dangerouslySetInnerHTML={{ __html: `<p>${renderMarkdown(liveText)}</p>` }}
					/>
				) : null}
			</main>

			<form className="glass composer" onSubmit={send}>
				<textarea
					ref={input}
					rows={1}
					value={draft}
					placeholder="Reply to this session"
					autoComplete="off"
					onChange={(event) => {
						setDraft(event.target.value);
						event.target.style.height = "auto";
						event.target.style.height = `${Math.min(event.target.scrollHeight, 160)}px`;
					}}
				/>
				<button type="submit" aria-label="Send" disabled={draft.trim().length === 0}>
					Send
				</button>
				{streaming ? (
					<button type="button" aria-label="Stop the current turn" onClick={stop}>
						Stop
					</button>
				) : null}
			</form>
		</>
	);
}
