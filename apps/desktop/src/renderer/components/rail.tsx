/**
 * The app rail at the far left, after Codex's: Home at the top, the profile at the bottom. The profile is the
 * GitHub account of the KnightCode Remote sign-in, and its menu holds Settings, Help and signing in and out.
 */

import {
	ArrowUpRight,
	BookOpen,
	ChevronRight,
	CircleHelp,
	CircleUserRound,
	House,
	Info,
	Keyboard,
	LogIn,
	LogOut,
	Settings,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Profile } from "../../shared/host-protocol.ts";
import { client } from "../client.ts";
import { isMac } from "../keys.ts";
import { errorText, navigate, showNew, toast, useStore } from "../store.ts";
import { Popover } from "./popover.tsx";

function Avatar({ profile, size }: { profile: Profile | undefined; size: number }) {
	const [broken, setBroken] = useState(false);
	if (profile?.signedIn && profile.avatarUrl && !broken)
		return (
			<img
				src={profile.avatarUrl}
				alt=""
				onError={() => setBroken(true)}
				style={{ width: size, height: size }}
				className="shrink-0 rounded-full object-cover"
			/>
		);
	if (profile?.signedIn && profile.login)
		return (
			<span
				style={{ width: size, height: size, fontSize: size * 0.4 }}
				className="flex shrink-0 items-center justify-center rounded-full bg-[#5d5d5d] font-medium text-white uppercase"
			>
				{profile.login.slice(0, 2)}
			</span>
		);
	return <CircleUserRound size={size} strokeWidth={1.5} className="shrink-0" />;
}

/** One row of the profile menu: icon, label, and a shortcut or chevron at the end. */
function Row({
	icon,
	label,
	end,
	disabled,
	onClick,
}: {
	icon: React.ReactNode;
	label: string;
	end?: React.ReactNode;
	disabled?: boolean;
	onClick?: () => void;
}) {
	return (
		<button type="button" disabled={disabled} onClick={onClick} className="kc-row text-ink disabled:text-desc">
			<span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{end ? <span className="shrink-0 text-desc">{end}</span> : null}
		</button>
	);
}

const Separator = () => <div className="mx-2 my-1 border-t border-hairline" />;

function ProfileMenu({
	profile,
	setProfile,
	close,
}: {
	profile: Profile | undefined;
	setProfile: (p: Profile) => void;
	close: () => void;
}) {
	const [help, setHelp] = useState(false);
	const [signingIn, setSigningIn] = useState(false);
	const mod = isMac() ? "⌘" : "Ctrl+";
	const go = (run: () => void) => () => {
		close();
		run();
	};
	return (
		<div className="w-[220px]">
			<div className="flex items-center gap-2.5 px-2 py-1.5">
				<Avatar profile={profile} size={20} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] leading-[18px] text-ink">
						{profile?.signedIn ? (profile.login ?? "Signed in") : "Not signed in"}
					</div>
					<div className="text-[12px] leading-4 text-desc">GitHub</div>
				</div>
			</div>
			<Separator />
			{profile?.signedIn ? null : (
				<Row
					icon={<LogIn size={15} />}
					label={signingIn ? "Waiting for GitHub…" : "Sign in with GitHub"}
					disabled={signingIn}
					onClick={() => {
						setSigningIn(true);
						void client
							.host("host/profile/signIn", {})
							.then(setProfile)
							.catch((e: unknown) => toast(errorText(e)))
							.finally(() => setSigningIn(false));
					}}
				/>
			)}
			<Row
				icon={<Settings size={15} />}
				label="Settings"
				end={`${mod},`}
				onClick={go(() => navigate({ kind: "settings", page: "general" }))}
			/>
			<Separator />
			<div className="relative" onMouseEnter={() => setHelp(true)} onMouseLeave={() => setHelp(false)}>
				<Row
					icon={<CircleHelp size={15} />}
					label="Help"
					end={<ChevronRight size={14} />}
					onClick={() => setHelp(!help)}
				/>
				{help ? (
					<div className="kc-menu absolute bottom-0 left-full z-40 ms-[5px] w-[240px]">
						<Row
							icon={<Keyboard size={15} />}
							label="Keyboard shortcuts"
							onClick={go(() => navigate({ kind: "settings", page: "shortcuts" }))}
						/>
						<Row
							icon={<BookOpen size={15} />}
							label="Documentation"
							end={<ArrowUpRight size={14} />}
							onClick={go(() => void client.host("host/shell/openExternal", { url: "https://knightcode.dev/docs" }))}
						/>
						<Row
							icon={<Info size={15} />}
							label="About KnightCode"
							onClick={go(() => navigate({ kind: "settings", page: "about" }))}
						/>
					</div>
				) : null}
			</div>
			{profile?.signedIn ? (
				<Row
					icon={<LogOut size={15} />}
					label="Log out"
					onClick={go(
						() =>
							void client
								.host("host/profile/signOut", {})
								.then(() => setProfile({ signedIn: false }))
								.catch((e: unknown) => toast(errorText(e))),
					)}
				/>
			) : null}
		</div>
	);
}

export function Rail() {
	const home = useStore((s) => s.view.kind === "new");
	const [profile, setProfile] = useState<Profile>();
	useEffect(() => {
		void client
			.host("host/profile/read", {})
			.then(setProfile)
			.catch(() => setProfile({ signedIn: false }));
	}, []);
	return (
		<nav aria-label="App navigation" className="flex w-[52px] shrink-0 flex-col items-center gap-2 px-2 pt-2 pb-1">
			<button
				type="button"
				title="Home"
				aria-label="Home"
				aria-current={home ? "page" : undefined}
				onClick={() => showNew()}
				className={`flex size-9 items-center justify-center rounded-[12.5px] text-ink ${home ? "bg-row" : "text-desc hover:bg-row hover:text-ink"}`}
			>
				<House size={20} strokeWidth={1.75} />
			</button>
			<div className="flex-1" />
			<Popover
				side="right"
				trigger={(open) => (
					<button
						type="button"
						title={profile?.signedIn && profile.login ? profile.login : "Profile"}
						aria-label="Open profile menu"
						className={`flex size-9 items-center justify-center rounded-[12.5px] text-desc hover:bg-row hover:text-ink ${open ? "bg-row text-ink" : ""}`}
					>
						<Avatar profile={profile} size={24} />
					</button>
				)}
			>
				{(close) => <ProfileMenu profile={profile} setProfile={setProfile} close={close} />}
			</Popover>
		</nav>
	);
}
