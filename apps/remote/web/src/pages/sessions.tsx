import { useEffect, useMemo, useState } from "react";
import { isLive, type Room, shortenPath } from "../lib/api.ts";
import { fullTime, shortAge } from "../lib/time.ts";
import "../styles/sessions.css";

export type Filter = "all" | "live" | "past";

const FILTERS: Array<{ value: Filter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "live", label: "Active" },
	{ value: "past", label: "Past" },
];

function matches(room: Room, filter: Filter): boolean {
	if (filter === "all") return true;
	return filter === "live" ? isLive(room) : !isLive(room);
}

function SessionRow({ room }: { room: Room }): React.JSX.Element {
	const live = isLive(room);
	const where = shortenPath(room.cwd);
	return (
		<a className="session" href={`/r/${room.id}`}>
			<span className={`avatar${live ? " avatar-live" : ""}`} aria-hidden="true" />
			<span className="session-body">
				<span className="session-name">{room.session_name ?? "Untitled session"}</span>
				<span className="session-meta">
					<span className={live ? "state state-live" : "state"}>{live ? "Live" : "Disconnected"}</span>
					{where ? <span className="where"> · {where}</span> : null}
				</span>
			</span>
			<time className="session-age" dateTime={new Date(room.last_seen_at).toISOString()} title={fullTime(room.last_seen_at)}>
				{shortAge(room.last_seen_at)}
			</time>
		</a>
	);
}

export function Sessions({ rooms, onReload }: { rooms: Room[]; onReload: () => void }): React.JSX.Element {
	const [filter, setFilter] = useState<Filter>("all");

	// The relay flips a room to offline when its host socket drops, so a list left open
	// goes stale on its own. Refresh on a timer and whenever the tab comes back into view.
	useEffect(() => {
		const timer = setInterval(onReload, 15_000);
		const onVisible = (): void => {
			if (document.visibilityState === "visible") onReload();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [onReload]);

	const shown = useMemo(() => rooms.filter((room) => matches(room, filter)), [rooms, filter]);
	const liveCount = useMemo(() => rooms.filter(isLive).length, [rooms]);

	return (
		<>
			<header className="glass topbar">
				<span className="brand">
					<img src="/knight.svg" alt="" width="22" height="22" />
					KnightCode
				</span>
				<a className="pill" href="/logout">
					Sign out
				</a>
			</header>

			<main className="sessions">
				<div className="sessions-head">
					<h1>Sessions</h1>
					<label className="filter">
						<select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
							{FILTERS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
				</div>

				{rooms.length > 0 ? (
					<p className="sessions-count">
						{liveCount > 0 ? `${liveCount} live · ` : ""}
						{rooms.length} total
					</p>
				) : null}

				{shown.length === 0 ? (
					<p className="empty">
						{rooms.length === 0 ? (
							<>
								No sessions yet. Run <code>/remote</code> in a terminal and it appears here.
							</>
						) : (
							<>Nothing matches this filter.</>
						)}
					</p>
				) : (
					<div className="session-list">
						{shown.map((room) => (
							<SessionRow key={room.id} room={room} />
						))}
					</div>
				)}
			</main>
		</>
	);
}
