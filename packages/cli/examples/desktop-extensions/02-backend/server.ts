/** One process-wide backend, with owned producers and secret settings never projected to the renderer. */
import { experimental_defineDesktopBackend } from "@knightcodeai/cli/desktop-backend";
import { Type } from "typebox";
import { increment, read, tick } from "./contract.ts";

export default experimental_defineDesktopBackend((app) => {
	const count = app.experimental_storage({ id: "count", schema: Type.Number() });
	app.experimental_setting({ id: "label", schema: Type.String(), default: "Shared counter" });
	app.experimental_setting({ id: "token", schema: Type.String(), default: "example-server-only", secret: true });
	const event = app.experimental_event(tick);
	app.experimental_registerRpc({ ...read, kind: "read", experimental_handle: () => count.experimental_get() ?? 0 });
	app.experimental_registerRpc({
		...increment,
		kind: "write",
		experimental_handle: (amount) => {
			const next = (count.experimental_get() ?? 0) + amount;
			count.experimental_set(next);
			event.experimental_emit(next);
			return next;
		},
	});
	app.experimental_onActivate((context) => {
		let timer: ReturnType<typeof setInterval> | undefined;
		const stop = () => {
			clearInterval(timer);
			timer = undefined;
		};
		const start = () => {
			timer = setInterval(() => event.experimental_emit(count.experimental_get() ?? 0), 500);
		};
		start();
		context.experimental_onPause(stop);
		context.experimental_onResume(start);
		return stop;
	});
});
