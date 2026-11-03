// packages/bots-ui/test/avatar.test.ts
import { AVATAR_SHAPES, type ComputerState, type ConversationView } from "@knightcode/bots-protocol";
import { expect, it } from "vitest";
import { botState, computerState, threadState } from "../src/avatar/BotAvatar.tsx";
import { SHAPE_BODIES } from "../src/avatar/BotAvatarView.tsx";
import { createEngine } from "../src/avatar/motion.ts";
import { renderSvg } from "../src/avatar/render.ts";
import { AVATAR_STATES, bridgeState, createSequencer } from "../src/avatar/sequencer.ts";

function render(shape: (typeof AVATAR_SHAPES)[number], state: (typeof AVATAR_STATES)[number], seconds: number): string {
	const engine = createEngine({ body: SHAPE_BODIES[shape] });
	const sequencer = createSequencer(engine, state, { seed: 7 });
	for (let t = 0; t < seconds; t += 1 / 60) {
		sequencer.advance(1 / 60);
		engine.advance(1 / 60);
	}
	return renderSvg(engine.frame(), { ink: "#ff6700" }, 92, "a");
}

it("draws every avatar shape with its body and eyes", () => {
	for (const shape of AVATAR_SHAPES) {
		const svg = render(shape, "idle", 0.5);
		expect(svg, shape).toMatch(/^<svg [^>]*viewBox="0 0 92 92"/);
		expect(svg, shape).toMatch(/fill="#ff6700"/);
		// Cut-out eyes: a mask (shapes) or even-odd holes in the body (the blob).
		expect(svg, shape).toMatch(/-holes|fill-rule="evenodd"/);
	}
});

it("plays every state", () => {
	expect(AVATAR_STATES).toHaveLength(53);
	for (const state of AVATAR_STATES) expect(render("clover", state, 1.2), state).toContain("<path");
});

it("is deterministic for a seed", () => {
	expect(render("star", "working", 2)).toBe(render("star", "working", 2));
	expect(render("star", "working", 2)).not.toBe(render("star", "working", 2.5));
});

it("shows the thinking overlay as two dots", () => {
	expect(render("blob", "thinking", 1).match(/<circle /g)).toHaveLength(2);
});

function sequence(initial: (typeof AVATAR_STATES)[number]) {
	const engine = createEngine({ body: "sphere" });
	const sequencer = createSequencer(engine, initial, { seed: 7 });
	const run = (seconds: number) => {
		for (let t = 0; t < seconds; t += 1 / 60) {
			sequencer.advance(1 / 60);
			engine.advance(1 / 60);
		}
	};
	return { sequencer, run };
}

it("bridges into a state: waking from sleep, finishing work, calling for attention", () => {
	expect(bridgeState("sleeping", "working")).toBe("waking");
	expect(bridgeState("streaming", "idle")).toBe("finished");
	expect(bridgeState("idle", "waiting")).toBe("alerting");
	expect(bridgeState("waiting", "blocked")).toBeNull();
	expect(bridgeState("idle", "working")).toBeNull();

	const { sequencer, run } = sequence("sleeping");
	sequencer.setState("working");
	expect(sequencer.state).toBe("waking");
	run(2);
	// Waking hands over to where the avatar was headed, not to waking's own idle.
	expect(sequencer.state).toBe("working");
	sequencer.setState("idle");
	expect(sequencer.state).toBe("finished");
	run(7);
	expect(sequencer.state).toBe("idle");
	sequencer.setState("waiting");
	expect(sequencer.state).toBe("alerting");
	run(3);
	expect(sequencer.state).toBe("waiting");
});

it("plays a reaction once, then returns", () => {
	const { sequencer, run } = sequence("working");
	sequencer.react("notifying");
	expect(sequencer.state).toBe("notifying");
	run(2.5);
	expect(sequencer.state).toBe("working");
});

it("reads a bot, a thread and a computer as states", () => {
	expect(botState({ status: "sleeping", needsYou: true })).toBe("sleeping");
	expect(botState({ status: "idle", needsYou: true })).toBe("waiting");
	expect(botState({ status: "working", needsYou: false })).toBe("working");
	expect(botState({ status: "idle", needsYou: false })).toBe("idle");

	const at = 0;
	const user = { kind: "message", id: "u", role: "user", text: "hi", createdAt: at } as const;
	const reply = { kind: "message", id: "r", role: "assistant", text: "…", createdAt: at, streaming: true } as const;
	const question: ConversationView["entries"][number] = {
		kind: "card",
		id: "q",
		createdAt: at,
		card: { type: "question", question: "Which?", choices: ["a"], allowOther: false },
	};
	const view = (entries: ConversationView["entries"], running = true): ConversationView => ({
		entries,
		running,
		hasEarlier: false,
	});
	expect(threadState(undefined)).toBe("loading");
	expect(threadState(view([user]))).toBe("thinking");
	expect(threadState(view([user, reply]))).toBe("streaming");
	expect(threadState(view([user, reply, question]))).toBe("waiting");
	// A question the user moved past is no longer waited on.
	expect(threadState(view([question, user], false))).toBeUndefined();
	// In a group only a member's own entries count.
	expect(threadState(view([user, { ...reply, botId: "b1" }]), "b1")).toBe("streaming");
	expect(threadState(view([user, { ...reply, botId: "b1" }]), "b2")).toBeUndefined();

	expect(computerState(undefined)).toBe("loading");
	expect(computerState({ status: "off" } as ComputerState)).toBe("sleeping");
	expect(computerState({ status: "awake", job: { action: "update", progress: 0.4 } } as ComputerState)).toBe(
		"progress",
	);
});
