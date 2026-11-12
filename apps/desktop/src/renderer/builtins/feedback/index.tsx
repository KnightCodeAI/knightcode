/** The newest three toasts, top centre under the title bar, using host-owned notification state. */
import {
	defineDesktopExtension,
	experimental_Button as Button,
	experimental_controllers,
	experimental_Icon as Icon,
	type experimental_IconName,
	experimental_useToasts,
} from "@knightcodeai/cli/desktop";

const TOAST_MARKS = { success: "CircleCheck", error: "CircleAlert", info: "Info" } satisfies Record<
	string,
	experimental_IconName
>;

function Toasts() {
	const toasts = experimental_useToasts();
	return (
		<div
			role="status"
			aria-label="Notifications"
			className="pointer-events-none fixed inset-x-0 top-12 z-[60] flex flex-col items-center gap-2 px-2"
		>
			{toasts.slice(-3).map((t) => (
				<div key={t.id} data-kind={t.kind} className="kc-toast max-w-[min(560px,100%)]">
					<Icon name={TOAST_MARKS[t.kind]} size={16} className="shrink-0" />
					<span className="min-w-0 [overflow-wrap:anywhere]">{t.text}</span>
					<Button
						size="xs"
						uniform
						pill
						aria-label="Close"
						onClick={() => experimental_controllers().experimental_dismissToast(t.id)}
						className="text-current"
					>
						<Icon name="X" size={16} />
					</Button>
				</div>
			))}
		</div>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "toasts", surface: "feedback", experimental_render: Toasts });
});
