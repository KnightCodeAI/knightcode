/** A page and live panel share typed, epoch-bound RPC and a public setting; no raw bridge access. */
import { useEffect, useState } from "react";
import {
	defineDesktopExtension,
	experimental_Button as Button,
	experimental_useBackend,
} from "@knightcodeai/cli/desktop";
import { increment, read, tick } from "./contract.ts";

function Counter() {
	const backend = experimental_useBackend();
	const [count, setCount] = useState<number>();
	const [label, setLabel] = useState("Shared counter");
	const [message, setMessage] = useState("");
	useEffect(() => {
		if (!backend) return;
		const lifetime = new AbortController();
		void backend.experimental_call(read, null, lifetime.signal).then((result) => {
			if (!lifetime.signal.aborted && result.status === "ok") setCount(result.value);
		});
		void backend.experimental_settings(undefined, lifetime.signal).then((result) => {
			if (!lifetime.signal.aborted && result.status === "ok" && typeof result.value.label === "string")
				setLabel(result.value.label);
		});
		const subscription = backend.experimental_subscribe(tick, setCount, lifetime.signal);
		return () => {
			lifetime.abort();
			subscription.dispose();
		};
	}, [backend]);
	return (
		<section className="flex flex-col gap-3 p-4" aria-label="Backend counter">
			<h2>{label}</h2>
			<output aria-label="Shared count">{count ?? "Connecting…"}</output>
			<Button
				disabled={!backend}
				onClick={() => {
					void backend?.experimental_call(increment, 1).then((result) => {
						if (result.status === "ok") setCount(result.value);
						else
							setMessage(
								result.status === "outcome-unknown"
									? "Write outcome unknown. Read the counter before trying again."
									: result.status,
							);
					});
				}}
			>
				Increment shared counter
			</Button>
			<label>
				Counter label
				<input aria-label="Counter label" value={label} onChange={(event) => setLabel(event.currentTarget.value)} />
			</label>
			<Button
				disabled={!backend}
				onClick={() => {
					void backend?.experimental_setSetting("label", label).then((result) => setMessage(result.status));
				}}
			>
				Save counter label
			</Button>
			<p role="status">{message}</p>
		</section>
	);
}
export default defineDesktopExtension((app) => {
	app.experimental_registerPage({ id: "counter", label: "Backend counter", experimental_render: Counter });
	app.experimental_registerPanelTab({ id: "counter-panel", label: "Live counter", experimental_render: Counter });
});
