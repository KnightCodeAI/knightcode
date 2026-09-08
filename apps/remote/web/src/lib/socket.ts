import { useCallback, useEffect, useReducer, useRef } from "react";
import {
	encodeFrame,
	type RelayFrame,
	type RemoteCommand,
	type StampedFrame,
} from "../../../../../packages/remote/src/protocol.ts";

export type Connection = "connecting" | "live" | "reconnecting";

export interface RoomState {
	entries: unknown[];
	/** The in-flight assistant message, cumulative. Cleared when its finished entry lands. */
	liveText?: string;
	sessionName?: string;
	cwd?: string;
	model?: string;
	commands: RemoteCommand[];
	/** This browser's socket to the relay. */
	connection: Connection;
	/** Whether a terminal is attached to the room, as the relay reports it. */
	hostOnline: boolean;
	/** True once the relay has answered our hello, so hostOnline is trustworthy. */
	synced: boolean;
	streaming: boolean;
	/** The last relay error, shown until the next successful send. */
	notice?: string;
}

type Action =
	| { type: "frame"; frame: StampedFrame | RelayFrame }
	| { type: "connection"; connection: Connection }
	| { type: "notice"; notice: string | undefined };

const INITIAL: RoomState = {
	entries: [],
	commands: [],
	connection: "connecting",
	hostOnline: false,
	synced: false,
	streaming: false,
};

function reduce(state: RoomState, action: Action): RoomState {
	if (action.type === "connection") return { ...state, connection: action.connection };
	if (action.type === "notice") return { ...state, notice: action.notice };
	const frame = action.frame;
	switch (frame.type) {
		case "snapshot":
			return {
				...state,
				entries: [...frame.entries],
				liveText: undefined,
				sessionName: frame.sessionName ?? state.sessionName,
				cwd: frame.cwd,
				model: frame.model ?? state.model,
				commands: frame.commands ?? state.commands,
			};
		case "entries":
			// The streamed draft is replaced by the finished entries it was previewing.
			return { ...state, entries: [...state.entries, ...frame.entries], liveText: undefined };
		case "stream":
			return { ...state, liveText: frame.content };
		case "status":
			return { ...state, streaming: frame.streaming, model: frame.model ?? state.model };
		case "bye":
			return { ...state, hostOnline: false, streaming: false, liveText: undefined };
		case "host":
			return {
				...state,
				hostOnline: frame.online,
				synced: true,
				streaming: frame.online ? state.streaming : false,
				liveText: frame.online ? state.liveText : undefined,
			};
		case "error":
			return { ...state, notice: frame.message };
		default:
			return state;
	}
}

const RECONNECT_MS = 2000;

export interface RoomSocket {
	state: RoomState;
	/** Returns false when the socket is not open; the caller keeps the draft. */
	send(text: string): boolean;
	abort(): void;
	dismissNotice(): void;
}

export function useRoomSocket(roomId: string): RoomSocket {
	const [state, dispatch] = useReducer(reduce, INITIAL);
	const socket = useRef<WebSocket>(null);
	const lastSeq = useRef(0);

	useEffect(() => {
		let closed = false;
		let retry: ReturnType<typeof setTimeout>;

		const connect = (): void => {
			const next = new WebSocket(`${location.origin.replace(/^http/, "ws")}/r/${roomId}/ws`);
			socket.current = next;
			next.addEventListener("open", () => {
				dispatch({ type: "connection", connection: "live" });
				// `since` resumes the stream where this viewer left off instead of refetching it all.
				next.send(
					encodeFrame(lastSeq.current > 0 ? { v: 1, type: "hello", since: lastSeq.current } : { v: 1, type: "hello" }),
				);
			});
			next.addEventListener("message", (event) => {
				let frame: StampedFrame | RelayFrame;
				try {
					frame = JSON.parse(String(event.data)) as StampedFrame | RelayFrame;
				} catch {
					// A frame the client cannot parse is skipped rather than breaking the stream.
					return;
				}
				if ("seq" in frame && typeof frame.seq === "number") lastSeq.current = Math.max(lastSeq.current, frame.seq);
				dispatch({ type: "frame", frame });
			});
			next.addEventListener("close", () => {
				if (closed) return;
				dispatch({ type: "connection", connection: "reconnecting" });
				retry = setTimeout(connect, RECONNECT_MS);
			});
		};

		connect();
		return () => {
			closed = true;
			clearTimeout(retry);
			socket.current?.close();
		};
	}, [roomId]);

	const send = useCallback((text: string): boolean => {
		const current = socket.current;
		if (current?.readyState !== WebSocket.OPEN) return false;
		current.send(encodeFrame({ v: 1, type: "prompt", text }));
		dispatch({ type: "notice", notice: undefined });
		return true;
	}, []);

	const abort = useCallback((): void => {
		const current = socket.current;
		if (current?.readyState === WebSocket.OPEN) current.send(encodeFrame({ v: 1, type: "abort" }));
	}, []);

	const dismissNotice = useCallback((): void => dispatch({ type: "notice", notice: undefined }), []);

	return { state, send, abort, dismissNotice };
}

/**
 * iOS Safari does not resize the layout viewport for the keyboard, so a bottom-fixed composer
 * ends up under it. Tracking the visual viewport and sizing the app frame from it keeps every
 * fixed element inside the part of the page the user can actually see.
 */
export function useVisualViewport(): void {
	useEffect(() => {
		const viewport = window.visualViewport;
		if (!viewport) return;
		const root = document.documentElement.style;
		const apply = (): void => {
			root.setProperty("--viewport-height", `${viewport.height}px`);
			root.setProperty("--viewport-top", `${viewport.offsetTop}px`);
		};
		apply();
		viewport.addEventListener("resize", apply);
		viewport.addEventListener("scroll", apply);
		return () => {
			viewport.removeEventListener("resize", apply);
			viewport.removeEventListener("scroll", apply);
			root.removeProperty("--viewport-height");
			root.removeProperty("--viewport-top");
		};
	}, []);
}
