import { useCallback, useEffect, useState } from "react";
import { fetchMe, fetchRooms, type Me, type Room as RoomRow, Unauthorized } from "./lib/api.ts";
import { Bugs } from "./pages/bugs.tsx";
import { Device } from "./pages/device.tsx";
import { Landing } from "./pages/landing.tsx";
import { Room } from "./pages/room.tsx";
import { Sessions } from "./pages/sessions.tsx";

/** Mirrors the id shape the Worker enforces before a room reaches D1 or a Durable Object. */
const ROOM_PATH = /^\/r\/([0-9A-F]{32})$/;

/**
 * Routing is a switch on the path, not a router: every one of these is a full page the
 * Worker already serves the shell for, and the links between them cross an auth boundary
 * the server has to re-check anyway.
 */
export function App(): React.JSX.Element {
	const path = window.location.pathname;
	const room = ROOM_PATH.exec(path);
	if (room?.[1]) return <Room roomId={room[1]} />;
	if (path === "/device") return <Device />;
	// The Worker serves this shell only to an address in ADMIN_EMAILS, so reaching it is
	// already the authorisation; the page just loads.
	if (path === "/bugs") return <Bugs />;
	return <Home />;
}

function Home(): React.JSX.Element {
	const [rooms, setRooms] = useState<RoomRow[]>();
	const [me, setMe] = useState<Me>();
	const [signedOut, setSignedOut] = useState(false);
	const [error, setError] = useState<string>();

	const load = useCallback(() => {
		fetchRooms().then(
			(next) => {
				setRooms(next);
				setError(undefined);
			},
			(cause: unknown) => {
				// 401 is the signed-out state, not a failure: it renders the landing page.
				if (cause instanceof Unauthorized) setSignedOut(true);
				else setError(cause instanceof Error ? cause.message : String(cause));
			},
		);
	}, []);

	useEffect(load, [load]);
	useEffect(() => {
		void fetchMe().then(setMe, () => {
			// The list is the page; the account sheet degrades to a sign-out link.
		});
	}, []);

	if (signedOut) return <Landing />;
	if (rooms === undefined) {
		return <p className="px-6 pt-[30vh] text-center text-label-2">{error ?? "Loading your sessions…"}</p>;
	}
	return <Sessions rooms={rooms} me={me} onReload={load} />;
}
