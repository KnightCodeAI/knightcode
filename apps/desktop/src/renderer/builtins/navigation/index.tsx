/** Built-in navigation and profile UI on the public structural facade. */
import { useEffect, useState } from "react";
import {
	defineDesktopExtension,
	experimental_controllers,
	experimental_controls,
	experimental_icons,
	experimental_shellServices,
	experimental_useNavigation,
	type experimental_Profile as Profile,
} from "@knightcodeai/cli/desktop";
function Avatar({ profile, size }: { profile: Profile | undefined; size: number }) {
	const [broken, setBroken] = useState(false);
	if (profile?.signedIn && profile.avatarUrl && !broken)
		return (
			<img
				src={profile.avatarUrl}
				alt=""
				onError={() => setBroken(true)}
				style={{ width: size, height: size }}
				className="kc-profile-avatar shrink-0 rounded-full object-cover"
			/>
		);
	if (profile?.signedIn && profile.login)
		return (
			<span
				style={{ width: size, height: size, fontSize: size * 0.4 }}
				className="kc-profile-avatar flex shrink-0 items-center justify-center rounded-full bg-avatar font-medium text-white uppercase"
			>
				{profile.login.slice(0, 2)}
			</span>
		);
	const { CircleUserRound } = experimental_icons();
	return <CircleUserRound size={size} className="shrink-0" />;
}

function ProfileMenu({ profile, setProfile }: { profile: Profile | undefined; setProfile: (p: Profile) => void }) {
	const [signingIn, setSigningIn] = useState(false);
	const {
		experimental_MenuContent: MenuContent,
		experimental_MenuItem: MenuItem,
		experimental_MenuSeparator: MenuSeparator,
		experimental_MenuSub: MenuSub,
	} = experimental_controls();
	const { LogIn, Settings, LifeBuoy, Keyboard, BookOpen, ArrowUpRight, Info, LogOut } = experimental_icons();
	const { experimental_showSettings: showSettings, experimental_notify: toast } = experimental_controllers();
	const { experimental_bindingLabel: bindingLabel } = experimental_shellServices();
	const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
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
						event.preventDefault();
						setSigningIn(true);
						void experimental_shellServices()
							.experimental_profile("signIn")
							.then(setProfile)
							.catch((e: unknown) => toast(errorText(e), "error"))
							.finally(() => setSigningIn(false));
					}}
				>
					{signingIn ? "Waiting for GitHub…" : "Sign in with GitHub"}
				</MenuItem>
			)}
			<MenuItem icon={<Settings />} hint={bindingLabel("desktop.settings")} onSelect={() => showSettings("general")}>
				Settings
			</MenuItem>
			<MenuSeparator />
			<MenuSub icon={<LifeBuoy />} label="Help">
				<MenuItem icon={<Keyboard />} onSelect={() => showSettings("shortcuts")}>
					Keyboard shortcuts
				</MenuItem>
				<MenuItem
					icon={<BookOpen />}
					hint={<ArrowUpRight size={16} />}
					onSelect={() => void experimental_shellServices().experimental_openDocumentation()}
				>
					Documentation
				</MenuItem>
				<MenuItem icon={<Info />} onSelect={() => showSettings("about")}>
					About KnightCode
				</MenuItem>
			</MenuSub>
			{profile?.signedIn ? (
				<MenuItem
					icon={<LogOut />}
					onSelect={() =>
						void experimental_shellServices()
							.experimental_profile("signOut")
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
	const { view } = experimental_useNavigation();
	const home = view.kind !== "settings" && view.kind !== "page";
	const { experimental_useHiddenNavigation: useHiddenNavigation, experimental_usePages: usePages } =
		experimental_shellServices();
	const hidden = useHiddenNavigation();
	const pages = usePages();
	const { experimental_showNew: showNew, experimental_openPage: openPage } = experimental_controllers();
	const {
		experimental_IconButton: IconButton,
		experimental_Menu: Menu,
		experimental_MenuTrigger: MenuTrigger,
	} = experimental_controls();
	const { House, Layers } = experimental_icons();
	const [profile, setProfile] = useState<Profile>();
	useEffect(() => {
		void experimental_shellServices()
			.experimental_profile("read")
			.then(setProfile)
			.catch(() => setProfile({ signedIn: false }));
	}, []);
	return (
		<nav aria-label="App navigation" className="flex w-[52px] shrink-0 flex-col items-center gap-2 px-2 pt-2 pb-1">
			{hidden.includes("home") ? null : (
				<IconButton label="Home" size="xl" strong aria-current={home ? "page" : undefined} onClick={() => showNew()}>
					<House size={20} filled={home} />
				</IconButton>
			)}
			{pages
				.filter((p) => !p.hidden)
				.map((p) => (
					<IconButton
						key={p.id}
						label={p.label}
						size="xl"
						strong
						aria-current={view.kind === "page" && view.id === p.id ? "page" : undefined}
						onClick={() => openPage(p.id)}
					>
						<Layers size={20} />
					</IconButton>
				))}
			<div className="flex-1" />
			{hidden.includes("profile") ? null : (
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
			)}
		</nav>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "default", surface: "navigation", experimental_render: Rail });
});
