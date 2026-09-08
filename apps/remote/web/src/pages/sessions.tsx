import { ChevronDown, Laptop, LogOut, Menu, Unplug } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GlassButton, TopBar } from "@/components/glass";
import { SessionRing } from "@/components/ring";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { type Me, type Room, type SessionState, shortenPath, stateOf } from "@/lib/api";
import { fullTime, shortAge } from "@/lib/time";
import { cn } from "@/lib/utils";

export type Filter = "all" | "live" | "past";

const FILTERS: Array<{ value: Filter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "live", label: "Active" },
	{ value: "past", label: "Past" },
];

function matches(room: Room, filter: Filter): boolean {
	if (filter === "all") return true;
	return filter === "live" ? stateOf(room) !== "offline" : stateOf(room) === "offline";
}

const STATE_LABEL: Record<SessionState, string> = { working: "Working", live: "Connected", offline: "Disconnected" };

function SessionRow({ room }: { room: Room }): React.JSX.Element {
	const state = stateOf(room);
	const where = shortenPath(room.cwd);
	return (
		<a
			className="flex items-center gap-3.5 rounded-[1.25rem] bg-raised px-4 py-3.5 text-label transition active:scale-[0.99] active:bg-raised-hover"
			href={`/r/${room.id}`}
		>
			<SessionRing state={state} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-[17px] leading-snug font-medium">{room.session_name ?? "Untitled session"}</span>
				<span className="flex items-center gap-1.5 truncate text-[14px] text-label-2">
					{state === "offline" ? (
						<Unplug className="size-3.5 flex-none" aria-hidden="true" />
					) : (
						<Laptop className="size-3.5 flex-none text-live" aria-hidden="true" />
					)}
					<span className={cn(state !== "offline" && "text-live")}>{STATE_LABEL[state]}</span>
					{where ? (
						<>
							<span aria-hidden="true">·</span>
							<span className="truncate">{where}</span>
						</>
					) : null}
				</span>
			</span>
			<time
				className="flex-none self-start pt-0.5 text-[14px] text-label-2 tabular-nums"
				dateTime={new Date(room.last_seen_at).toISOString()}
				title={fullTime(room.last_seen_at)}
			>
				{shortAge(room.last_seen_at)}
			</time>
		</a>
	);
}

function AccountSheet({ me }: { me?: Me }): React.JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<>
			<GlassButton aria-label="Account" onClick={() => setOpen(true)}>
				<Menu className="size-5" aria-hidden="true" />
			</GlassButton>
			<Sheet open={open} onOpenChange={setOpen}>
				<SheetContent side="left" showCloseButton={false} className="glass-strong w-[82vw] max-w-xs gap-0 border-r-0 p-0 text-label">
					<div className="flex flex-col gap-5 px-5 pt-[calc(var(--safe-top)+1.5rem)]">
						<div className="flex items-center gap-3">
							{me?.avatarUrl ? (
								<img src={me.avatarUrl} alt="" className="size-11 rounded-full bg-raised" width="44" height="44" />
							) : (
								<span className="size-11 rounded-full bg-raised" aria-hidden="true" />
							)}
							<div className="min-w-0">
								<SheetTitle className="truncate text-[17px] font-semibold text-label">{me?.login ?? "Signed in"}</SheetTitle>
								<SheetDescription className="text-[13px] text-label-2">GitHub</SheetDescription>
							</div>
						</div>
						<p className="text-[14px] leading-relaxed text-label-2">
							Run <code className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[12px]">/remote</code> in a terminal
							and the session appears here.
						</p>
					</div>
					<div className="mt-auto px-5 pb-[calc(var(--safe-bottom)+1.5rem)]">
						<a
							href="/logout"
							className="flex items-center gap-2.5 rounded-2xl bg-raised px-4 py-3 text-[15px] font-medium active:bg-raised-hover"
						>
							<LogOut className="size-4" aria-hidden="true" />
							Sign out
						</a>
					</div>
				</SheetContent>
			</Sheet>
		</>
	);
}

function FilterMenu({ value, onChange }: { value: Filter; onChange(next: Filter): void }): React.JSX.Element {
	const label = FILTERS.find((option) => option.value === value)?.label ?? "All";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="flex h-9 items-center gap-1 rounded-full px-3 text-[15px] text-label-2 active:bg-raised">
				{label}
				<ChevronDown className="size-4" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="glass-strong min-w-36 rounded-2xl p-1.5 text-label">
				<DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as Filter)}>
					{FILTERS.map((option) => (
						<DropdownMenuRadioItem key={option.value} value={option.value} className="rounded-xl py-2 pl-3 text-[15px]">
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function Sessions({ rooms, me, onReload }: { rooms: Room[]; me?: Me; onReload: () => void }): React.JSX.Element {
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

	return (
		<div className="relative min-h-dvh">
			<TopBar
				left={<AccountSheet me={me} />}
				center={<h1 className="truncate text-[19px] font-semibold">Sessions</h1>}
			/>

			<main className="mx-auto max-w-3xl px-3 pb-16" style={{ paddingTop: "calc(var(--topbar) + var(--safe-top) + 0.75rem)" }}>
				<div className="mb-2 flex items-center justify-between pl-1">
					<p className="text-[15px] text-label-2">
						{rooms.length === 0 ? "No sessions" : `${rooms.length} ${rooms.length === 1 ? "session" : "sessions"}`}
					</p>
					<FilterMenu value={filter} onChange={setFilter} />
				</div>

				{shown.length === 0 ? (
					<p className="mx-auto max-w-xs py-16 text-center leading-relaxed text-label-2">
						{rooms.length === 0 ? (
							<>
								Run <code className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[13px]">/remote</code> in a terminal
								and it appears here.
							</>
						) : (
							<>Nothing matches this filter.</>
						)}
					</p>
				) : (
					<div className="flex flex-col gap-2.5">
						{shown.map((room) => (
							<SessionRow key={room.id} room={room} />
						))}
					</div>
				)}
			</main>
		</div>
	);
}
