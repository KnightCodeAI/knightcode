import { expect, test } from "vitest";
import { GAMES, replay, START } from "../../src/renderer/chess.ts";

// The games' legality and mates were checked against chess.js when they went in; this keeps an edit from moving a
// piece that is not there, out of turn or onto its own side, or ending anywhere but on the mate.
test("every game moves the side to move's pieces and ends on the mate", () => {
	for (const game of GAMES) {
		const { plies, frames } = replay(game);
		plies.forEach((ply, i) => {
			expect(ply.piece, game).toBeGreaterThanOrEqual(0);
			expect(START[ply.piece]!.white, game).toBe(i % 2 === 0);
			const taken = frames[i]!.indexOf(ply.to);
			if (taken >= 0) expect(START[taken]!.white, game).not.toBe(START[ply.piece]!.white);
		});
		expect(game.indexOf("#"), game).toBe(game.length - 1);
		expect(plies.at(-1)!.check, game).toBe(true);
		const kings = START.flatMap((piece, i) => (piece.kind === "k" ? [i] : []));
		expect(
			kings.map((king) => frames.at(-1)![king]! >= 0),
			game,
		).toEqual([true, true]);
	}
});
