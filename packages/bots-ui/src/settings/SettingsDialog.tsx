// Settings: a 900 x 702 dialog with its sections down the left and the open one on the right. Activity lives here too.
// Usage and billing share one page: usage first, then the plan, credits and receipts.
import {
	Activity as ActivityIcon,
	BarChart3,
	KeyRound,
	MessageCircle,
	Monitor,
	Settings,
	ShieldCheck,
	Wallet,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Activity } from "../activity/Activity.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { navigate, type SettingsSection } from "../shell/routes.ts";
import { Usage } from "../usage/Usage.tsx";
import { Account } from "./Account.tsx";
import { Approvals } from "./Approvals.tsx";
import { Billing } from "./Billing.tsx";
import { Channels } from "./Channels.tsx";
import { HomeRouting } from "./HomeRouting.tsx";
import { Payments } from "./Payments.tsx";
import { Tailscale } from "./Tailscale.tsx";
import { ThisComputer } from "./ThisComputer.tsx";
import { NewVaultItem, Vault } from "./Vault.tsx";

export type SettingsView = SettingsSection | "activity";

type NavId = Exclude<SettingsView, "billing">;

/** The sections, in nav order; billing opens the Usage & Billing page. */
export const SETTINGS_NAV: {
	id: NavId;
	label: string;
	icon: ReactNode;
	page: () => ReactNode;
	action?: () => ReactNode;
}[] = [
	{ id: "account", label: "General", icon: <Settings size={15} />, page: () => <Account /> },
	{ id: "computer", label: "Computer", icon: <Monitor size={15} />, page: () => <ComputerSettings /> },
	{ id: "approvals", label: "Approvals", icon: <ShieldCheck size={15} />, page: () => <Approvals /> },
	{ id: "vault", label: "Vault", icon: <KeyRound size={15} />, page: () => <Vault />, action: () => <NewVaultItem /> },
	{
		id: "usage",
		label: "Usage & Billing",
		icon: <BarChart3 size={15} />,
		page: () => (
			<>
				<Usage />
				<Billing />
			</>
		),
	},
	{ id: "payments", label: "Payments", icon: <Wallet size={15} />, page: () => <Payments /> },
	{ id: "channels", label: "Chat apps", icon: <MessageCircle size={15} />, page: () => <Channels /> },
	{ id: "activity", label: "Activity", icon: <ActivityIcon size={15} />, page: () => <Activity /> },
];

const open = (id: NavId) => navigate(id === "activity" ? { name: "activity" } : { name: "settings", section: id });

/** The dialog showing `view`. */
export function SettingsDialog({ view, onClose }: { view: SettingsView; onClose: () => void }) {
	const id: NavId = view === "billing" ? "usage" : view;
	const current = SETTINGS_NAV.find((item) => item.id === id) ?? SETTINGS_NAV[0]!;
	let firstOther = true;
	// A copied link opens on its setting.
	useEffect(() => {
		const anchor = decodeURIComponent(location.hash.slice(1));
		if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: "center" }));
	}, [current.id]);
	return (
		<Dialog
			open
			onOpenChange={(isOpen) => !isOpen && onClose()}
			title="Settings"
			bare
			width={900}
			className="kb-settings-dialog"
			dataRef="dialog"
		>
			<div className="kb-settings-dialog__layout">
				<nav className="kb-settings-nav" aria-label="Settings sections" data-ref="settings-nav">
					{SETTINGS_NAV.map((item) => {
						const active = item.id === current.id;
						const ref = active ? "nav-item-active" : firstOther ? "nav-item" : undefined;
						if (!active) firstOther = false;
						return (
							<button
								key={item.id}
								type="button"
								className="kb-settings-nav__item"
								aria-current={active ? "page" : undefined}
								data-ref={ref}
								onClick={() => open(item.id)}
							>
								<span className="kb-settings-nav__icon">{item.icon}</span>
								<span>{item.label}</span>
							</button>
						);
					})}
				</nav>
				<section className="kb-settings-panel" aria-labelledby="kb-settings-title" data-ref="panel">
					<header
						className={
							current.action
								? "kb-settings-panel__header kb-settings-panel__header--action"
								: "kb-settings-panel__header"
						}
						data-ref="pane-header"
					>
						<h2 className="kb-settings-panel__title" id="kb-settings-title">
							{current.label}
						</h2>
						{current.action?.()}
					</header>
					<div className="kb-settings-panel__body" data-ref="settings-body">
						<div className="kb-settings-panel__content">{current.page()}</div>
					</div>
				</section>
			</div>
		</Dialog>
	);
}

/** The computer's network settings. */
function ComputerSettings() {
	return (
		<>
			<ThisComputer />
			<HomeRouting />
			<Tailscale />
		</>
	);
}
