import { getCurrentSystemMessage } from "@knightcode/ai";
import { AskPicker } from "@knightcode/tools/ask/picker";
import type { AskAnswers } from "@knightcode/tools/ask/tool";
import { readPersisted } from "@knightcode/tools/state";
import { Markdown, Text } from "@knightcode/tui";
import { Type } from "typebox";
import { ExtensionStartupError } from "../../core/extensions/startup-error.ts";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "../../core/extensions/types.ts";
import type { CustomMessage } from "../../core/messages.ts";
import { writeRawStdout } from "../../core/output-guard.ts";
import { buildSessionContext } from "../../core/session-manager.ts";
import { getMarkdownTheme } from "../../modes/interactive/theme/theme.ts";
import { foldPlanState, type PlanSnapshot, type PlanTransition, transitionPlan } from "./state.ts";

const INSPECT = ["read", "grep", "find", "ls", "webfetch", "websearch"];
const SHELLS = ["bash", "powershell"];
const ALLOWED = new Set([...INSPECT, ...SHELLS, "ask_user", "submit_plan"]);
const LOADOUT = ["ask_user", "submit_plan", "read", "grep", "find", "ls"];
// Planning benefits from research: on from entry unless the user turned them off in /tools. Like the
// rest of the loadout they stay on afterwards, so leaving planning never rewrites the tool list.
const WEB = ["webfetch", "websearch"];
const REQUIRED_TOOLS =
	"Plan mode needs the ask_user and submit_plan tools; include them in --tools and remove any matching --exclude-tools filters, or restart without --no-tools.";
const CODEMODE_ONLY =
	"Plan mode needs direct read tools, which codemode only mode hides. Set codemode.mode to on to plan.";
const OUTSIDE = "Not in plan mode. If your plan was approved, continue implementing it.";
const STALE = "The plan changed; run /plan to review the latest revision.";
const EXIT = "<plan_mode>Plan mode has ended. Its restrictions no longer apply.</plan_mode>";
type ReviewAction = "implement" | "fresh" | "keep" | "exit";
const REVIEW: { action: ReviewAction; label: string; description: string }[] = [
	{ action: "implement", label: "Implement", description: "Leave plan mode and implement it in this session." },
	{ action: "fresh", label: "Implement in a fresh session", description: "Start clean with only the plan." },
	{ action: "keep", label: "Keep planning", description: "Close this; run /plan to review it again." },
	{ action: "exit", label: "Exit planning", description: "Leave plan mode without implementing; the draft is kept." },
];
const REVISE = { label: "Revise the plan", description: "Tell the model what to change." };

/** Names only the tools this session has, so the model is never pointed at a disabled one. */
function allowedLine(active: readonly string[]): string {
	const inspect = INSPECT.filter((name) => active.includes(name));
	const shells = SHELLS.filter((name) => active.includes(name));
	const shell = shells.length
		? ` ${shells.join(" and ")} commands are not checked: run only commands that inspect (git log, git diff, tests or builds that leave tracked files alone), never ones that edit, format, install, commit or otherwise change state.`
		: "";
	return `Allowed: ${inspect.length ? inspect.join(", ") : "no inspection tools"}, ask_user and submit_plan. Every other tool is blocked.${shell}`;
}

const instructions = (active: readonly string[]) => `<plan_mode>
Plan mode is active. You are planning, not implementing. Only the user ends plan mode; if they ask you to do the work, plan how to do it.

${allowedLine(active)}

1. Explore first. Never ask what the code can tell you.
2. Ask only about intent and trade-offs the code cannot settle, using ask_user. If no user is available, take the recommended option and record it under Assumptions.
3. When no important question remains, call submit_plan with the complete plan in Markdown:
   - Summary: the goal and the chosen approach (only the chosen one).
   - Changes: files to change and existing code to reuse, with paths.
   - Verification: tests and commands that prove it works.
   - Assumptions: decisions made without the user.
   Keep it as short as an implementer can act on. A revision replaces the whole plan.

End every turn with ask_user or submit_plan. Call submit_plan on its own, not alongside other tools. Never ask for approval in prose.
</plan_mode>`;

function notice(ctx: ExtensionContext, text: string, level: "info" | "warning" = "info"): void {
	if (ctx.hasUI) ctx.ui.notify(text, level);
	else process.stderr.write(`${text}\n`);
}

/** Enforced planning lives entirely in an optional, replaceable extension. */
export default function planMode(kc: ExtensionAPI): void {
	let snapshot: PlanSnapshot = { mode: "off" };
	let batch: { ids: Set<string>; designated: string; succeeded: boolean } | undefined;
	let submitted: number | undefined;
	let lastShown: number | undefined;
	let reviewAbort: AbortController | undefined;
	let recovery:
		CustomMessage<{ kind: "recovery"; id: string; revision?: number; status: "planning" | "approved" }> | undefined;

	const status = (ctx: ExtensionContext) =>
		ctx.ui.setStatus(
			"plan",
			snapshot.mode === "planning"
				? `plan${snapshot.draft ? ` · revision ${snapshot.draft.revision}` : ""}`
				: undefined,
		);
	const persist = (event: PlanTransition, ctx: ExtensionContext) => {
		snapshot = transitionPlan(snapshot, event);
		kc.appendEntry("plan-mode", snapshot);
		status(ctx);
	};
	const message = (kind: string, content: string) =>
		kc.sendMessage(
			{
				customType: "plan-mode",
				content,
				display: false,
				details: { kind },
			},
			{ triggerTurn: false },
		);
	const refusal = (active = kc.getActiveTools()): string | undefined => {
		const tools = new Set(
			kc
				.getAllTools()
				.filter((t) => t.exposure !== "hidden")
				.map((t) => t.name),
		);
		if (!tools.has("ask_user") || !tools.has("submit_plan")) return REQUIRED_TOOLS;
		if (kc.getSettings().codemode?.mode === "only" && active.includes("codemode")) return CODEMODE_ONLY;
		return undefined;
	};
	const reconcile = () => {
		const available = new Set(kc.getAllTools().map((t) => t.name));
		const active = kc.getActiveTools();
		const persisted = readPersisted();
		const wanted = [...LOADOUT, ...WEB.filter((name) => persisted[name]?.enabled !== false)];
		const missing = wanted.filter((name) => available.has(name) && !active.includes(name));
		if (missing.length) kc.setActiveTools([...active, ...missing]);
	};
	const enter = (ctx: ExtensionContext) => {
		const error = refusal();
		if (error) throw new ExtensionStartupError(error);
		reconcile();
		persist({ type: "enter" }, ctx);
		message(
			"instructions",
			instructions(kc.getActiveTools()) +
				(snapshot.draft
					? `\nAn earlier plan exists (revision ${snapshot.draft.revision}). If this is the same task, revise it; otherwise start fresh.`
					: ""),
		);
	};

	const recover = (ctx: ExtensionContext) => {
		const branch = ctx.sessionManager.getBranch();
		const compaction = branch.findLastIndex((entry) => entry.type === "compaction");
		if (compaction < 0) return;
		const pinned = snapshot.draft && snapshot.approved === snapshot.draft.revision;
		if (snapshot.mode !== "planning" && !pinned) return;
		if (
			branch
				.slice(compaction + 1)
				.some(
					(entry) =>
						entry.type === "custom_message" &&
						entry.customType === "plan-mode" &&
						(entry.details as { kind?: string } | undefined)?.kind === "recovery",
				)
		)
			return;
		const id = branch[compaction].id;
		if (recovery?.details?.id === id) return;
		const planning = snapshot.mode === "planning";
		const content = planning
			? instructions(kc.getActiveTools()) +
				(snapshot.draft ? `\n\nCurrent plan (revision ${snapshot.draft.revision}):\n\n${snapshot.draft.markdown}` : "")
			: `Approved plan (revision ${snapshot.draft!.revision}) from before compaction; ignore it if complete.\n\n${snapshot.draft!.markdown}`;
		recovery = {
			role: "custom",
			customType: "plan-mode",
			display: false,
			timestamp: Date.now(),
			content,
			details: { kind: "recovery", id, revision: snapshot.draft?.revision, status: planning ? "planning" : "approved" },
		};
		kc.sendMessage(recovery, { triggerTurn: false });
	};

	// Complete and registered before commands or entry checks can expose it. ask_user comes from the tools extension.
	kc.registerTool({
		name: "submit_plan",
		label: "Plan",
		exposure: "model-only",
		defaultActive: false,
		executionMode: "sequential",
		description:
			"Submit the complete plan in Markdown. A revision replaces the whole plan. Call this on its own, then end the turn; only the user can approve implementation.",
		parameters: Type.Object({ markdown: Type.String({ minLength: 1 }) }),
		execute: async (id, { markdown }, signal, _update, ctx) => {
			if (snapshot.mode !== "planning") throw new Error(OUTSIDE);
			signal?.throwIfAborted();
			if (!markdown.trim()) throw new Error("Submit a non-empty Markdown plan.");
			persist({ type: "submit", markdown }, ctx);
			if (batch?.designated === id) batch.succeeded = true;
			submitted = snapshot.draft!.revision;
			return {
				content: [
					{ type: "text", text: `Submitted as revision ${submitted}. End your turn now; do not repeat the plan.` },
				],
				details: { revision: submitted, markdown },
				terminate: true,
			};
		},
		renderCall: (args) =>
			new Markdown(typeof args.markdown === "string" ? args.markdown : "", 0, 0, getMarkdownTheme()),
		// The call already shows the plan; a successful result would repeat it.
		renderResult: (result) =>
			new Text(
				result.isError
					? result.content
							.filter((c) => c.type === "text")
							.map((c) => c.text)
							.join("\n")
					: "",
				0,
				0,
			),
	});

	kc.on("session_start", (event, ctx) => {
		snapshot = foldPlanState(ctx.sessionManager.getBranch());
		if (snapshot.mode === "planning") {
			const error = refusal();
			if (error) throw new ExtensionStartupError(error);
			reconcile();
		} else if (event.reason === "startup" && kc.getFlag("plan") === true) enter(ctx);
		status(ctx);
		recover(ctx);
	});
	kc.on("session_before_tree", (event, ctx) => {
		const target = ctx.sessionManager.getEntry(event.preparation.targetId);
		if (!target) return;
		const leaf =
			target.type === "custom_message" || (target.type === "message" && target.message.role === "user")
				? target.parentId
				: target.id;
		const branch = leaf ? ctx.sessionManager.getBranch(leaf) : [];
		let saved: PlanSnapshot;
		try {
			saved = foldPlanState(branch);
		} catch (error) {
			// The runner reports and swallows handler errors here, which would let navigation land on an unreadable plan.
			notice(ctx, (error as Error).message, "warning");
			return { cancel: true };
		}
		if (saved.mode !== "planning") return;
		const declared = getCurrentSystemMessage(buildSessionContext(branch).messages)?.toolsAdded?.map((t) => t.name);
		const error = refusal(declared ?? []);
		if (error) {
			notice(ctx, error, "warning");
			return { cancel: true };
		}
	});
	kc.on("session_tree", (_event, ctx) => {
		reviewAbort?.abort();
		lastShown = undefined;
		snapshot = foldPlanState(ctx.sessionManager.getBranch());
		recovery = undefined;
		if (snapshot.mode === "planning") reconcile();
		status(ctx);
		recover(ctx);
	});
	kc.on("session_compact", (_event, ctx) => {
		snapshot = foldPlanState(ctx.sessionManager.getBranch());
		recover(ctx);
	});
	kc.on("context_with_system", (event) => {
		if (!recovery) return;
		const frozen = recovery;
		if (
			event.messages.some(
				(m) =>
					m.role === "custom" &&
					m.customType === "plan-mode" &&
					(m.details as { id?: string } | undefined)?.id === frozen.details!.id,
			)
		) {
			recovery = undefined;
			return;
		}
		return { messages: [...event.messages, frozen] };
	});
	kc.on("before_agent_start", (_event, ctx) => {
		if (snapshot.mode !== "planning") return;
		// The tools extension's session_start runs after ours and drops ask_user when /tools turned it off.
		reconcile();
		const branch = ctx.sessionManager.getBranch();
		const instructions = branch.findLastIndex(
			(e) =>
				e.type === "custom_message" &&
				e.customType === "plan-mode" &&
				(e.details as { kind?: string } | undefined)?.kind === "instructions",
		);
		const user = branch.findLastIndex((e) => e.type === "message" && e.message.role === "user");
		if (instructions > user) return;
		return {
			message: {
				customType: "plan-mode",
				display: false,
				details: { kind: "reminder" },
				content: `<plan_mode>Plan mode is still active. ${allowedLine(kc.getActiveTools())} End your turn with ask_user or submit_plan.</plan_mode>`,
			},
		};
	});
	kc.on("session_shutdown", () => {
		reviewAbort?.abort();
	});
	kc.on("agent_start", () => {
		reviewAbort?.abort();
		batch = undefined;
		submitted = undefined;
	});
	kc.on("message_end", (event) => {
		if (snapshot.mode !== "planning" || event.message.role !== "assistant") return;
		const calls = event.message.content.filter((c) => c.type === "toolCall");
		const first = calls.find((c) => c.name === "submit_plan");
		if (first) batch = { ids: new Set(calls.map((c) => c.id)), designated: first.id, succeeded: false };
	});
	kc.on("tool_call", (event) => {
		if (snapshot.mode !== "planning") return;
		if (batch?.ids.has(event.toolCallId) && event.toolCallId !== batch.designated)
			return {
				block: true,
				reason: "This batch contains a plan submission; submit the plan on its own.",
			};
		if (ALLOWED.has(event.toolName)) return;
		return {
			block: true,
			reason: `Plan mode: \`${event.toolName}\` is blocked while planning. ${allowedLine(kc.getActiveTools())}`,
		};
	});
	kc.on("turn_end", () => {
		const end = batch?.succeeded === true;
		batch = undefined;
		if (end) return { end: true };
	});
	kc.on("agent_settled", (_event, ctx) => {
		batch = undefined;
		const revision = submitted;
		submitted = undefined;
		if (revision === undefined || snapshot.draft?.revision !== revision) return;
		if (ctx.mode === "print") writeRawStdout(snapshot.draft.markdown + "\n");
		else if (ctx.mode === "rpc") notice(ctx, `Plan revision ${revision} submitted. Run /plan to review.`);
		else if (ctx.mode === "tui" && lastShown !== revision) {
			kc.sendUserMessage("/plan", { expandPromptTemplates: true });
		}
	});

	kc.registerFlag("plan", {
		type: "boolean",
		default: false,
		description: "Enter enforced plan mode on initial startup",
	});
	kc.registerCommand("plan", {
		description: "Plan a task, review a draft, or approve implementation",
		handler: async (args, ctx: ExtensionCommandContext) => {
			if (!ctx.isIdle() || ctx.hasPendingMessages()) {
				notice(ctx, "Finish or interrupt the current turn first.", "warning");
				return;
			}
			snapshot = foldPlanState(ctx.sessionManager.getBranch());
			const text = args.trim();
			if (text === "off") {
				if (snapshot.mode === "planning") {
					persist({ type: "exit" }, ctx);
					message("exit", EXIT);
				}
				return;
			}
			// A note needs the revision before it, so "/plan approve this" stays a revision request.
			const approval = /^approve(?: (fresh))?(?: (\d+)(?: ([\s\S]+))?)?$/.exec(text);
			const note = approval?.[3] ? `\n\nUser note: ${approval[3]}` : "";
			if (approval) {
				if (approval[1] && ctx.mode === "engine") {
					notice(ctx, "Fresh-session handoff is not available in the IDE yet; use /plan approve.");
					return;
				}
				if (snapshot.mode !== "planning" || !snapshot.draft) {
					notice(ctx, "No plan to approve.");
					return;
				}
				if (approval[2] && Number(approval[2]) !== snapshot.draft.revision) {
					notice(ctx, STALE, "warning");
					return;
				}
				if (approval[1]) {
					const approved = transitionPlan(snapshot, { type: "approve" });
					const parentSession = ctx.sessionManager.getSessionFile();
					const handoff = `A previous planning session produced the plan below. Implement it in this fresh context. Treat the plan as the source of user intent, re-read files as needed, and verify the work. Planning transcript: ${parentSession ?? "(in-memory session)"}.\n\n${approved.draft!.markdown}${note}`;
					await ctx.newSession({
						preserveModel: true,
						parentSession,
						setup: async (manager) => {
							manager.appendCustomEntry("plan-mode", approved);
						},
						withSession: async (replacement) => {
							await replacement.sendUserMessage(handoff);
						},
					});
					return;
				}
				persist({ type: "approve" }, ctx);
				await ctx.sendUserMessage(
					`Plan mode has ended. Implement the approved plan (revision ${snapshot.draft!.revision}).${note}`,
				);
				return;
			}
			if (snapshot.mode === "off") enter(ctx);
			else if (!text) {
				const draft = snapshot.draft;
				if (!draft) {
					notice(ctx, "No plan submitted yet; send a task to continue planning.");
					return;
				}
				if (!ctx.hasUI) {
					notice(ctx, `Plan revision ${draft.revision} submitted. Run /plan approve to implement.`);
					return;
				}
				reviewAbort?.abort();
				const controller = new AbortController();
				reviewAbort = controller;
				const sessionId = ctx.sessionManager.getSessionId();
				const shown = JSON.stringify(snapshot);
				lastShown = draft.revision;
				let action: ReviewAction | undefined;
				let feedback: string | undefined;
				try {
					if (ctx.mode === "tui") {
						// The plan is already in the transcript, so the review only asks what to do with it.
						const percent = ctx.getContextUsage()?.percent;
						const options = REVIEW.map(({ action, label, description }) => ({
							label,
							description:
								action === "fresh" && percent != null
									? `${description} ${Math.round(percent)}% of the context is used now.`
									: description,
						}));
						const answers = await ctx.ui.custom<AskAnswers | undefined>(
							(tui, theme, keys, done) =>
								new AskPicker(
									[{ id: "plan", question: "Implement this plan?", options }],
									tui,
									theme,
									keys,
									done,
									controller.signal,
									{ title: `Plan revision ${draft.revision}`, other: REVISE, cancel: "keep planning" },
								),
						);
						const answer = answers?.plan;
						feedback = answer?.other ?? answer?.note;
						action = answer?.other ? "keep" : REVIEW.find((r) => r.label === answer?.label)?.action;
					} else {
						const rows = ["Implement", "Implement in a fresh session", "Keep planning (Esc)", "Exit planning"];
						const choice = await ctx.ui.select(`Plan revision ${draft.revision}\n\n${draft.markdown}`, rows, {
							signal: controller.signal,
						});
						action = (["implement", "fresh", "keep", "exit"] as const)[rows.indexOf(choice ?? "")];
					}
				} finally {
					if (reviewAbort === controller) reviewAbort = undefined;
				}
				if (controller.signal.aborted || action === undefined || (action === "keep" && !feedback)) return;
				if (
					ctx.sessionManager.getSessionId() !== sessionId ||
					JSON.stringify(foldPlanState(ctx.sessionManager.getBranch())) !== shown ||
					!ctx.isIdle() ||
					ctx.hasPendingMessages()
				) {
					notice(ctx, STALE, "warning");
					return;
				}
				// Feedback while planning is a revision request; on approval it rides along as a note.
				if (action === "keep") await ctx.sendUserMessage(feedback!);
				else
					await ctx.sendUserMessage(
						action === "exit"
							? "/plan off"
							: `/plan approve${action === "fresh" ? " fresh" : ""} ${draft.revision}${feedback ? ` ${feedback}` : ""}`,
						{ expandPromptTemplates: true },
					);
				return;
			}
			if (text) await ctx.sendUserMessage(text);
		},
	});
}
