// Settings: a 900 x 702 dialog with its sections down the left and the open one on the right. Activity lives here too.
import {
	Activity as ActivityIcon,
	BarChart3,
	CreditCard,
	KeyRound,
	MessageCircle,
	Monitor,
	ShieldCheck,
	UserRound,
	Wallet,
} from "lucide-react";
import type { ReactNode } from "react";
import { Activity } from "../activity/Activity.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { navigate, type SettingsSection } from "../shell/routes.ts";
import { Usage } from "../usage/Usage.tsx";

export type SettingsView = SettingsSection | "activity";

/** The sections, in nav order. */
export const SETTINGS_NAV: { id: SettingsView; label: string; icon: ReactNode }[] = [
	{ id: "account", label: "Account", icon: <UserRound size={15} /> },
	{ id: "computer", label: "Computer", icon: <Monitor size={15} /> },
	{ id: "approvals", label: "Approvals", icon: <ShieldCheck size={15} /> },
	{ id: "vault", label: "Vault", icon: <KeyRound size={15} /> },
	{ id: "usage", label: "Usage", icon: <BarChart3 size={15} /> },
	{ id: "billing", label: "Billing", icon: <CreditCard size={15} /> },
	{ id: "payments", label: "Payments", icon: <Wallet size={15} /> },
	{ id: "channels", label: "Chat apps", icon: <MessageCircle size={15} /> },
	{ id: "activity", label: "Activity", icon: <ActivityIcon size={15} /> },
];

const open = (view: SettingsView) =>
	navigate(view === "activity" ? { name: "activity" } : { name: "settings", section: view });

/** The dialog showing `view`; sections without a page yet show their title only. */
export function SettingsDialog({ view, onClose }: { view: SettingsView; onClose: () => void }) {
	const current = SETTINGS_NAV.find((item) => item.id === view) ?? SETTINGS_NAV[0]!;
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
					{SETTINGS_NAV.map((item) => (
						<button
							key={item.id}
							type="button"
							className="kb-settings-nav__item"
							aria-current={item.id === current.id ? "page" : undefined}
							data-ref={item.id === current.id ? "nav-item-active" : undefined}
							onClick={() => open(item.id)}
						>
							<span className="kb-settings-nav__icon">{item.icon}</span>
							<span>{item.label}</span>
						</button>
					))}
				</nav>
				<section className="kb-settings-panel" aria-labelledby="kb-settings-title">
					<header className="kb-settings-panel__header" data-ref="pane-header">
						<h2 className="kb-settings-panel__title" id="kb-settings-title">
							{current.label}
						</h2>
					</header>
					<div className="kb-settings-panel__body" data-ref="settings-body">
						<div className="kb-settings-panel__content">
							{current.id === "usage" && <Usage />}
							{current.id === "activity" && <Activity />}
						</div>
					</div>
				</section>
			</div>
		</Dialog>
	);
}
