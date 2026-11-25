/** Profile identical real-store text streaming through S4 and current transcript/composer presentations. */
import { Profiler, type ComponentType, type ProfilerOnRenderCallback } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { getState, openThread, useStore } from "../../src/renderer/store.ts";
import { TurnView } from "../../src/renderer/builtins/conversation/items.tsx";
import { Composer } from "../../src/renderer/components/composer.tsx";
import { desktopExtensions } from "../../src/renderer/extensions/runtime.ts";
import { defineDesktopExtension, experimental_ItemRenderer as RenderItem } from "@knightcodeai/cli/desktop";
import type { ViewTurn } from "../../src/renderer/turns.ts";
import { chunks, emitChunk, history, threadId } from "./client.ts";

export interface ProfileMetrics {
	commits: Record<string, number>;
	durationMs: number;
	chunks: number;
	history: number;
}

export async function profile(
	Turn: ComponentType<{ turn: ViewTurn; latest: boolean; threadId: string }> = TurnView,
	Input: ComponentType<{ threadId: string }> = Composer,
): Promise<ProfileMetrics> {
	// An unchanged clock makes the existing elapsed-time interval an eager no-op in both presentations.
	Date.now = () => Date.UTC(2026, 10, 12, 12, 0, 10);
	const dispose = initializeDesktopExtensions();
	await openThread(threadId);
	let metrics: ProfileMetrics = { commits: {}, durationMs: 0, chunks, history };
	const record: ProfilerOnRenderCallback = (id, _phase, duration) => {
		metrics.commits[id] = (metrics.commits[id] ?? 0) + 1;
		metrics.durationMs += duration;
	};
	function Transcript() {
		const held = useStore((state) => state.held[threadId])!;
		return (
			<>
				{held.turns.map((turn, index) => (
					<Profiler key={turn.id} id={turn.id} onRender={record}>
						<Turn turn={turn} threadId={threadId} latest={index === held.turns.length - 1} />
					</Profiler>
				))}
				<Profiler id="composer" onRender={record}>
					<Input threadId={threadId} />
				</Profiler>
			</>
		);
	}
	const root = createRoot(document.getElementById("root")!);
	try {
		if (Turn === TurnView) {
			const probe = desktopExtensions.register(
				"profile.probe",
				defineDesktopExtension((app) => {
					app.experimental_registerItemRenderer({
						id: "probe",
						experimental_available: (context) => context.item?.id.startsWith("profile-probe") ?? false,
						experimental_render: ({ context }) => <span data-profile-probe>{context.thread?.id ?? "none"}</span>,
					});
				}),
			);
			try {
				const errors: string[] = [];
				flushSync(() =>
					root.render(
						<TurnView
							threadId={threadId}
							latest
							turn={{
								id: "probe-turn",
								threadId,
								status: "completed",
								startedAt: 1,
								items: [
									{
										type: "toolCall",
										id: "profile-probe-plan",
										tool: "submit_plan",
										status: "completed",
										input: { markdown: "A plan" },
										output: [],
									},
								],
							}}
						/>,
					),
				);
				if (document.querySelector("[data-profile-probe]")?.textContent !== threadId)
					errors.push("Plan items bypass the public renderer");
				flushSync(() =>
					root.render(
						<RenderItem item={{ type: "agentMessage", id: "profile-probe-isolated", text: "Isolated" }}>
							Fallback
						</RenderItem>,
					),
				);
				if (document.querySelector("[data-profile-probe]")?.textContent !== "none")
					errors.push("An untargeted item borrowed the selected thread");
				flushSync(() =>
					root.render(
						<TurnView
							threadId={threadId}
							latest
							turn={{
								id: "probe-steered-turn",
								threadId,
								status: "completed",
								startedAt: 1,
								items: [
									{ type: "userMessage", id: "probe-first", text: "First", images: [] },
									{ type: "userMessage", id: "profile-probe-steered", text: "Steered", images: [] },
								],
							}}
						/>,
					),
				);
				if (document.querySelector("[data-profile-probe]")?.textContent !== threadId)
					errors.push("Steered messages bypass the public renderer");
				if (errors.length) throw new Error(errors.join("; "));
			} finally {
				probe.dispose();
			}
		}
		flushSync(() => root.render(<Transcript />));
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		metrics = { commits: {}, durationMs: 0, chunks, history };
		for (let index = 0; index < chunks; index++) {
			emitChunk();
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		await new Promise((resolve) => requestAnimationFrame(resolve));
		const last = getState().held[threadId]!.turns.at(-1)!.items.at(-1)!;
		if (last.type !== "agentMessage" || last.text !== `Reply ${history}.` + " streaming".repeat(chunks))
			throw new Error("Streaming fixture dropped a notification");
		return metrics;
	} finally {
		root.unmount();
		dispose();
	}
}
