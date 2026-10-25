/**
 * The games the home mark plays when clicked (components/knight-game.tsx): short real games that end in mate, in
 * from-to squares ("e2e4"), with "+" after a check and "#" after the mate. None castles, takes en passant or promotes,
 * so a move is only ever one piece going somewhere, maybe onto another.
 */

export type PieceKind = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
	kind: PieceKind;
	white: boolean;
	/** a1 is 0, b1 1, a2 8, h8 63. */
	square: number;
}

/** A move: the piece's index in START, where it went, and whether it checks. */
export interface Ply {
	piece: number;
	from: number;
	to: number;
	check: boolean;
}

const BACK_RANK = "rnbqkbnr";

/** The opening position; a piece's index here is its identity through a game. */
export const START: readonly Piece[] = [
	...[...BACK_RANK].map((kind, file) => ({ kind: kind as PieceKind, white: true, square: file })),
	...[...BACK_RANK].map((_, file) => ({ kind: "p" as const, white: true, square: 8 + file })),
	...[...BACK_RANK].map((_, file) => ({ kind: "p" as const, white: false, square: 48 + file })),
	...[...BACK_RANK].map((kind, file) => ({ kind: kind as PieceKind, white: false, square: 56 + file })),
];

export const GAMES: readonly string[] = [
	// Fool's mate, and its cousin.
	"f2f3 e7e5 g2g4 d8h4#",
	"f2f4 e7e6 g2g4 d8h4#",
	// The same diagonal, the other way round.
	"e2e4 g7g5 d2d4 f7f6 d1h5#",
	"e2e4 f7f5 e4f5 g7g5 d1h5#",
	// The king walks out to meet the queen.
	"e2e4 e7e5 d1h5 e8e7 h5e5#",
	// Scholar's mate, three ways.
	"e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7#",
	"e2e4 e7e5 d1h5 b8c6 f1c4 g8f6 h5f7#",
	"e2e4 e7e5 f1c4 b8c6 d1f3 d7d6 f3f7#",
	// Black's turn at f2.
	"e2e4 e7e5 b1c3 f8c5 g1e2 d8h4 e2f4 h4f2#",
	// A knight smothers the king in the Caro-Kann.
	"e2e4 c7c6 d2d4 d7d5 b1c3 d5e4 c3e4 b8d7 d1e2 g8f6 e4d6#",
	// The Budapest's knight sacrifice on e3.
	"d2d4 g8f6 b1d2 e7e5 d4e5 f6g4 h2h3 g4e3 f2e3 d8h4+ g2g3 h4g3#",
	// Légal's mate: the queen given away, two knights and a bishop.
	"e2e4 e7e5 g1f3 d7d6 f1c4 c8g4 b1c3 g7g6 f3e5 g4d1 c4f7+ e8e7 c3d5#",
	// The Blackburne Shilling gambit's knight mate.
	"e2e4 e7e5 g1f3 b8c6 f1c4 c6d4 f3e5 d8g5 e5f7 g5g2 h1f1 g2e4+ c4e2 d4f3#",
];

const square = (name: string) => name.charCodeAt(0) - 97 + (name.charCodeAt(1) - 49) * 8;

/** A game's moves, and every piece's square after each (frames[0] is the start; -1 once taken). */
export function replay(game: string): { plies: Ply[]; frames: number[][] } {
	let squares = START.map((p) => p.square);
	const frames = [squares];
	const plies = game.split(" ").map((move) => {
		const from = square(move.slice(0, 2));
		const to = square(move.slice(2, 4));
		const piece = squares.indexOf(from);
		squares = squares.map((s) => (s === to ? -1 : s));
		squares[piece] = to;
		frames.push(squares);
		return { piece, from, to, check: move.length > 4 };
	});
	return { plies, frames };
}
