/** Composer and conversation commands use the same public controllers as their visible controls. */
import {
	experimental_composer,
	experimental_conversationServices,
	type experimental_CommandContext,
	type experimental_DesktopApp,
} from "@knightcodeai/cli/desktop";

function target(context: experimental_CommandContext) {
	return (
		context.composer ??
		(context.thread ? { threadId: context.thread.id } : context.cwd ? { cwd: context.cwd } : undefined)
	);
}

export function registerComposerCommands(app: experimental_DesktopApp) {
	for (const [id, label, binding, alternate] of [
		["send", "Send message", "desktop.composer.send", false],
		["alternate", "Send alternate message", "desktop.composer.steer", true],
	] as const)
		app.experimental_registerCommand({
			id,
			label: () => label,
			binding,
			experimental_available: (context) => {
				const to = target(context);
				return !!context.composer && !!to && experimental_composer(to).experimental_canSubmit();
			},
			experimental_run: (context) => {
				const to = target(context);
				if (to) experimental_composer(to).experimental_submit(alternate);
			},
		});
	app.experimental_registerCommand({
		id: "stop",
		label: () => "Stop turn",
		binding: "desktop.turn.interrupt",
		experimental_available: (context) =>
			!!context.composer &&
			!!context.thread &&
			!!experimental_conversationServices()
				.experimental_readThread(context.thread.id)
				?.turns.some((turn) => turn.status === "inProgress"),
		experimental_run: (context) => {
			if (context.thread) experimental_composer({ threadId: context.thread.id }).experimental_stop();
		},
	});
	app.experimental_registerCommand({
		id: "find",
		label: () => "Find in thread",
		binding: "desktop.thread.find",
		experimental_available: (context) => !!context.composer && !!context.thread,
		experimental_run: (context) => {
			if (context.thread) experimental_conversationServices().experimental_find(context.thread.id, true);
		},
	});
	for (const to of ["top", "bottom"] as const)
		app.experimental_registerCommand({
			id: `scroll-${to}`,
			label: () => `Scroll conversation to ${to}`,
			experimental_available: (context) => !!context.composer && !!context.thread,
			experimental_run: (context) => {
				if (context.thread) experimental_conversationServices().experimental_scroll(context.thread.id, to);
			},
		});
	app.experimental_registerCommand({
		id: "copy-code",
		label: () => "Copy last code block",
		binding: "desktop.thread.copyCode",
		experimental_available: (context) => !!context.composer && !!context.thread,
		experimental_run: (context) => {
			if (context.thread) experimental_conversationServices().experimental_copyLastCodeBlock(context.thread.id);
		},
	});
}
