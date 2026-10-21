/**
 * The app rail at the far left, after Codex's: Home at the top, the profile at the bottom. The profile is the
 * GitHub account of the KnightCode Remote sign-in, and its menu holds Settings, Help and signing in and out.
 */

import {
	ArrowUpRight,
	BookOpen,
	CircleUserRound,
	House,
	Info,
	Keyboard,
	LifeBuoy,
	LogIn,
	LogOut,
	Settings,
} from "./icons.tsx";
import { useEffect, useState } from "react";
import type { Profile } from "../../shared/host-protocol.ts";
import { client } from "../client.ts";
import { bindingLabel } from "../keys.ts";
import { errorText, navigate, showNew, toast, useStore } from "../store.ts";
import { IconButton } from "./button.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuTrigger } from "./menu.tsx";

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
				className="flex shrink-0 items-center justify-center rounded-full bg-avatar font-medium text-white uppercase"
			>
				{profile.login.slice(0, 2)}
			</span>
		);
	return <CircleUserRound size={size} className="shrink-0" />;
}

/** The profile menu: the account, Settings, Help (a submenu) and signing in or out, as Codex's profile menu. */
function ProfileMenu({ profile, setProfile }: { profile: Profile | undefined; setProfile: (p: Profile) => void }) {
	const [signingIn, setSigningIn] = useState(false);
	return (
		<MenuContent side="right" align="end" sideOffset={4} minWidth={228}>
			<div className="flex items-center gap-2.5 px-2 py-1.5">
				<Avatar profile={profile} size={20} />
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] leading-[18px] text-ink">
						{profile?.signedIn ? (profile.login ?? "Signed in") : "Not signed in"}
					</div>
					<div className="text-[12px] leading-4 text-tertiary">GitHub</div>
				</div>
			</div>
			<MenuSeparator />
			{profile?.signedIn ? null : (
				<MenuItem
					icon={<LogIn />}
					disabled={signingIn}
					onSelect={(event) => {
						// Stays open to show the wait.
						event.preventDefault();
						setSigningIn(true);
						void client
							.host("host/profile/signIn", {})
							.then(setProfile)
							.catch((e: unknown) => toast(errorText(e), "error"))
							.finally(() => setSigningIn(false));
					}}
				>
					{signingIn ? "Waiting for GitHub…" : "Sign in with GitHub"}
				</MenuItem>
			)}
			<MenuItem
				icon={<Settings />}
				hint={bindingLabel("desktop.settings")}
				onSelect={() => navigate({ kind: "settings", page: "general" })}
			>
				Settings
			</MenuItem>
			<MenuSeparator />
			<MenuSub icon={<LifeBuoy />} label="Help">
				<MenuItem icon={<Keyboard />} onSelect={() => navigate({ kind: "settings", page: "shortcuts" })}>
					Keyboard shortcuts
				</MenuItem>
				<MenuItem
					icon={<BookOpen />}
					hint={<ArrowUpRight size={16} />}
					onSelect={() => void client.host("host/shell/openExternal", { url: "https://knightcode.dev/docs" })}
				>
					Documentation
				</MenuItem>
				<MenuItem icon={<Info />} onSelect={() => navigate({ kind: "settings", page: "about" })}>
					About KnightCode
				</MenuItem>
			</MenuSub>
			{profile?.signedIn ? (
				<MenuItem
					icon={<LogOut />}
					onSelect={() =>
						void client
							.host("host/profile/signOut", {})
							.then(() => setProfile({ signedIn: false }))
							.catch((e: unknown) => toast(errorText(e), "error"))
					}
				>
					Log out
				</MenuItem>
			) : null}
		</MenuContent>
	);
}

export function Rail() {
	// Threads open inside Home, so only Settings leaves it.
	const home = useStore((s) => s.view.kind !== "settings");
	const [profile, setProfile] = useState<Profile>();
	useEffect(() => {
		void client
			.host("host/profile/read", {})
			.then(setProfile)
			.catch(() => setProfile({ signedIn: false }));
	}, []);
	return (
		// Codex's rail: 36px buttons with 20px icons, 8px apart, 8px in from the edges (measured 2026-10-19).
		<nav aria-label="App navigation" className="flex w-[52px] shrink-0 flex-col items-center gap-2 px-2 pt-2 pb-1">
			<IconButton label="Home" size="xl" strong aria-current={home ? "page" : undefined} onClick={() => showNew()}>
				<House size={20} filled={home} />
			</IconButton>
			<div className="flex-1" />
			<Menu>
				<MenuTrigger>
					<IconButton
						label={profile?.signedIn && profile.login ? profile.login : "Open profile menu"}
						aria-label="Open profile menu"
						size="xl"
						strong
					>
						<Avatar profile={profile} size={24} />
					</IconButton>
				</MenuTrigger>
				<ProfileMenu profile={profile} setProfile={setProfile} />
			</Menu>
		</nav>
	);
}
