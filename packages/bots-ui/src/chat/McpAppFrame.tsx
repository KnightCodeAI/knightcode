// An interactive panel from an MCP server. It loads only from the sandbox origin, never from the app's own origin,
// and its actions go to the API, which applies the same approval policy as the model's own actions.
import { createContext, useContext, useEffect, useRef } from "react";

/** Where MCP App panels are served from; set by the host. Without one, panels are not shown. */
export const SandboxOriginContext = createContext<string | undefined>(undefined);

export interface McpAppFrameProps {
	appUrl: string;
	title?: string;
	onAction: (action: unknown) => void;
}

/** The panel, or a notice when its URL is not on the sandbox origin. */
export function McpAppFrame({ appUrl, title = "App", onAction }: McpAppFrameProps) {
	const sandbox = useContext(SandboxOriginContext);
	const frame = useRef<HTMLIFrameElement>(null);
	const allowed = isAllowed(appUrl, sandbox);
	useEffect(() => {
		if (!allowed || !sandbox) return;
		const listener = (event: MessageEvent) => {
			// Only this panel's window, from the sandbox origin, may send actions.
			if (event.source !== frame.current?.contentWindow || event.origin !== sandbox) return;
			onAction(event.data);
		};
		window.addEventListener("message", listener);
		return () => window.removeEventListener("message", listener);
	}, [allowed, sandbox, onAction]);
	if (!allowed) return <p className="kb-panel-blocked">This panel cannot be shown here.</p>;
	return (
		<iframe
			ref={frame}
			className="kb-app-frame"
			src={appUrl}
			title={title}
			sandbox={PANEL_SANDBOX}
			referrerPolicy="no-referrer"
			allow=""
		/>
	);
}

/**
 * The panel frame's sandbox. allow-same-origin keeps the panel on its own origin (otherwise it is "null" and the
 * origin check above could never pass); that is safe only because `isAllowed` refuses the app's own origin.
 */
export const PANEL_SANDBOX = "allow-scripts allow-forms allow-same-origin";

/** True when `appUrl` is on the sandbox origin and that origin is not the app's own. */
export function isAllowed(appUrl: string, sandbox: string | undefined): boolean {
	if (!sandbox) return false;
	try {
		const origin = new URL(appUrl).origin;
		return origin === new URL(sandbox).origin && origin !== globalThis.location?.origin;
	} catch {
		return false;
	}
}
