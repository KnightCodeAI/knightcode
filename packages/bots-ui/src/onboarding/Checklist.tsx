// "Get started" for new users: connect providers, create the first bot, connect an app, set approvals, link a chat app.
// Each item links to its screen and disappears when done; it is the home screen until everything is done or skipped.
import type { Onboarding } from "@knightcode/bots-protocol";
import { ChevronRight } from "lucide-react";
import { Button } from "../primitives/Button.tsx";
import { navigate, type Route } from "../shell/routes.ts";

/** One step of the checklist. */
export type OnboardingItem = Onboarding["items"][number];

const ITEMS: Record<OnboardingItem["id"], { title: string; detail: string; to: Route }> = {
	providers: {
		title: "Connect your AI providers",
		detail: "Your bots run on your own accounts.",
		to: { name: "settings", section: "account" },
	},
	bot: {
		title: "Create your first bot",
		detail: "Start blank or from a template.",
		to: { name: "new", tab: "create" },
	},
	app: { title: "Connect an app", detail: "Mail, calendar, code, files.", to: { name: "connectors" } },
	approvals: {
		title: "Choose how bots ask first",
		detail: "Ask, Auto review or Never ask.",
		to: { name: "settings", section: "approvals" },
	},
	"chat-app": {
		title: "Link a chat app",
		detail: "Telegram, Slack or email.",
		to: { name: "settings", section: "channels" },
	},
};

const SKIPPED = "kb.onboardingSkipped";

/** The items still to do, in order. */
export const openItems = (items: OnboardingItem[]) => items.filter((item) => !item.done);

/** True when the user skipped the checklist in this browser. */
export function onboardingSkipped(): boolean {
	try {
		return localStorage.getItem(SKIPPED) === "1";
	} catch {
		return false;
	}
}

/** The checklist view. */
export function Checklist({ items, onSkip }: { items: OnboardingItem[]; onSkip: () => void }) {
	const open = openItems(items);
	return (
		<div className="kb-view">
			<div className="kb-view__inner">
				<h1 className="kb-view__title">Get started</h1>
				<p className="kb-catchup__summary">A few steps and your bots can work on their own.</p>
				<ul className="kb-list" aria-label="Get started">
					{open.map((item) => {
						const step = ITEMS[item.id];
						return (
							<li key={item.id}>
								<button type="button" className="kb-list__row" onClick={() => navigate(step.to)}>
									<span className="kb-checklist__dot" aria-hidden />
									<span className="kb-list__main">
										<span className="kb-list__title">{step.title}</span>
										<span className="kb-list__meta">{step.detail}</span>
									</span>
									<ChevronRight size={14} className="kb-list__pin" aria-hidden />
								</button>
							</li>
						);
					})}
				</ul>
				<div>
					<Button
						variant="secondary"
						onClick={() => {
							try {
								localStorage.setItem(SKIPPED, "1");
							} catch {
								// Without storage the checklist comes back next time.
							}
							onSkip();
						}}
					>
						Skip for now
					</Button>
				</div>
			</div>
		</div>
	);
}
