/**
 * The home mark's game of chess (home.tsx loads this module on the first click on the mark). The mark shrinks onto g1
 * as that knight while a board unfolds upward from its place; two players run through one of
 * chess.ts's short games to mate, a different one each time; then the board folds into the mating piece, which grows
 * back into the mark. Motion is CSS on transforms and opacity (styles.css, .kc-chess); the only script while it runs
 * is a timeout per move. A click on the board ends it early.
 */

import { type CSSProperties, useEffect, useState } from "react";
import { GAMES, type PieceKind, replay, START } from "../chess.ts";
import { KNIGHT_BASE, KNIGHT_BODY, KnightMark } from "./icons.tsx";

/** A square in px. The board is 128px wide, sharing the home mark's centreline and bottom edge. */
const SQUARE = 16;
/** The mark's centre on the board. */
const MARK = { x: 64, y: 92 };
const G1 = 6;
/** The kings' indexes in START. */
const WHITE_KING = 4;
const BLACK_KING = 28;
/** How much later a square or piece arrives, or leaves, per square of distance from where the board unfolds. */
const STAGGER = 32;
/** The pieces arrive as the mark lands on g1, 0.55 s after the click (styles.css); the first move follows. */
const PIECES_IN = 320;
const FIRST_MOVE = 1100;
const MATE_HOLD = 1600;

/** The pieces, on the mark's 16-unit grid and its base; the knight is the mark's own. */
const BODIES: Record<PieceKind, string> = {
	p: "M8 2.5a2.25 2.25 0 1 1 0 4.5a2.25 2.25 0 1 1 0-4.5ZM6 7.15h4a.5.5 0 0 1 0 1H6a.5.5 0 0 1 0-1ZM6.75 8.3h2.5c0 1.9.75 3.3 1.85 4.5H4.9c1.1-1.2 1.85-2.6 1.85-4.5Z",
	n: KNIGHT_BODY,
	b: "M8 1.05a.95.95 0 1 1 0 1.9a.95.95 0 1 1 0-1.9ZM8 3.1c1.9 1.15 2.85 2.65 2.4 4.5H5.6C5.15 5.75 6.1 4.25 8 3.1ZM8.85 4.45l.5.42-1.6 1.9-.5-.42ZM6.1 7.75h3.8a.45.45 0 0 1 0 .9H6.1a.45.45 0 0 1 0-.9ZM6.85 8.8h2.3c0 1.75.7 3 1.7 4H5.15c1-1 1.7-2.25 1.7-4Z",
	r: "M4.6 2.3h1.6v1.3h1.1V2.3h1.4v1.3h1.1V2.3h1.6v3l-1 1v4.9l1.1 1.6H4.5l1.1-1.6V6.3l-1-1Z",
	q: "M3.95 3.05a.7.7 0 1 1 0 1.4a.7.7 0 1 1 0-1.4ZM6 1.9a.7.7 0 1 1 0 1.4a.7.7 0 1 1 0-1.4ZM8 1.65a.7.7 0 1 1 0 1.4a.7.7 0 1 1 0-1.4ZM10 1.9a.7.7 0 1 1 0 1.4a.7.7 0 1 1 0-1.4ZM12.05 3.05a.7.7 0 1 1 0 1.4a.7.7 0 1 1 0-1.4ZM5.6 9.3 3.95 4.55l1.6 2.45L6 3.4l1.25 3.15L8 3.2l.75 3.35L10 3.4l.45 3.6 1.6-2.45L10.4 9.3ZM5.45 9.45h5.1a.45.45 0 0 1 0 .9h-5.1a.45.45 0 0 1 0-.9ZM6 10.5h4c.15 1 .55 1.7 1.05 2.3h-6.1c.5-.6.9-1.3 1.05-2.3Z",
	k: "M7.45.7h1.1v.85h1v1.05h-1v1.8h-1.1V2.6h-1V1.55h1ZM8 4.9C9.25 3.75 11.5 3.9 12.05 5.35c.5 1.35-.4 2.85-1.6 3.95H5.55C4.35 8.2 3.45 6.7 3.95 5.35 4.5 3.9 6.75 3.75 8 4.9ZM5.45 9.45h5.1a.45.45 0 0 1 0 .9h-5.1a.45.45 0 0 1 0-.9ZM6 10.5h4c.15 1 .55 1.7 1.05 2.3h-6.1c.5-.6.9-1.3 1.05-2.3Z",
};

const file = (square: number) => square % 8;
const rank = (square: number) => square >> 3;
const distance = (a: number, b: number) => Math.hypot(file(a) - file(b), rank(a) - rank(b));
/** A square's top left corner on the board, in px (rank 8 at the top). */
const corner = (square: number) => ({ x: file(square) * SQUARE, y: (7 - rank(square)) * SQUARE });
/** How long a piece takes between two squares: a longer reach takes a little longer. */
const glide = (from: number, to: number) => Math.round(Math.min(460, 240 + 50 * distance(from, to)));
const ms = (value: number) => `${Math.round(value)}ms`;

let lastGame = Math.floor(Math.random() * GAMES.length);
/** A game other than the last one played. */
function pickGame() {
	lastGame = (lastGame + 1 + Math.floor(Math.random() * (GAMES.length - 1))) % GAMES.length;
	return replay(GAMES[lastGame]!);
}

export default function KnightGame({ onDone, stopping }: { onDone: () => void; stopping: boolean }) {
	const [{ plies, frames }] = useState(pickGame);
	const [ply, setPly] = useState(0);
	const [phase, setPhase] = useState<"play" | "mate" | "exit">("play");

	useEffect(() => {
		if (stopping || phase === "exit") return;
		const previous = plies[ply - 1];
		let delay = MATE_HOLD;
		let next = () => setPhase("exit");
		if (phase === "play" && ply === plies.length) {
			delay = glide(previous!.from, previous!.to);
			next = () => setPhase("mate");
		} else if (phase === "play") {
			// A moment to think: longer before the mate, shorter through a long game.
			const think = (200 + Math.random() * 450) * (plies.length > 9 ? 0.65 : 1) + (ply === plies.length - 1 ? 350 : 0);
			delay = previous ? glide(previous.from, previous.to) + think : FIRST_MOVE;
			next = () => setPly(ply + 1);
		}
		const timer = setTimeout(next, delay);
		return () => clearTimeout(timer);
	}, [phase, ply, plies, stopping]);

	const squares = frames[ply]!;
	const last = plies[ply - 1];
	const checked = last?.check ? (START[last.piece]!.white ? BLACK_KING : WHITE_KING) : -1;
	const mate = ply === plies.length && phase !== "play";
	// The board folds toward the last move's square (the mate, unless cut short), farthest squares first.
	const origin = last?.to ?? G1;
	const far = Math.max(...[0, 7, 56, 63].map((c) => distance(c, origin)));
	const out = (square: number) => ms((far - distance(square, origin)) * STAGGER);
	const toMark = (square: number) => {
		const { x, y } = corner(square);
		return { x: `${x + SQUARE / 2 - MARK.x}px`, y: `${y + SQUARE / 2 - MARK.y}px` };
	};
	const markFrom = toMark(origin);
	const markTo = toMark(G1);

	return (
		<>
			<span aria-hidden="true" className="kc-chess" data-phase={stopping ? "exit" : phase}>
				{Array.from({ length: 64 }, (_, cell) => {
					const square = (7 - (cell >> 3)) * 8 + (cell % 8);
					return (
						<span
							key={square}
							className="kc-chess-sq"
							data-light={(file(square) + rank(square)) % 2 === 1 || undefined}
							data-move={(last && (square === last.from || square === last.to)) || undefined}
							data-check={(checked >= 0 && square === squares[checked]) || undefined}
							style={{ "--in": ms(distance(square, G1) * STAGGER), "--out": out(square) } as CSSProperties}
						/>
					);
				})}
				{START.map((piece, id) => {
					// A taken piece stays (hidden) where it was taken.
					const at = squares[id]! >= 0 ? squares[id]! : frames.slice(0, ply).findLast((f) => f[id]! >= 0)![id]!;
					const { x, y } = corner(at);
					return (
						<span
							key={id}
							className="kc-chess-piece"
							data-white={piece.white || undefined}
							data-moving={last?.piece === id || undefined}
							data-taken={squares[id]! < 0 || undefined}
							data-mated={(mate && id === checked) || undefined}
							style={
								{
									transform: `translate(${x}px, ${y}px)`,
									"--glide": last?.piece === id ? ms(glide(last.from, last.to)) : undefined,
									"--in": ms(PIECES_IN + distance(piece.square, G1) * STAGGER),
									"--out": out(at),
								} as CSSProperties
							}
						>
							<svg viewBox="0 0 16 16" aria-hidden="true">
								<path d={KNIGHT_BASE} />
								<path fillRule="evenodd" d={BODIES[piece.kind]} />
							</svg>
						</span>
					);
				})}
			</span>
			<span
				aria-hidden="true"
				className="kc-chess-mark"
				style={
					{
						"--in-x": markTo.x,
						"--in-y": markTo.y,
						"--x": markFrom.x,
						"--y": markFrom.y,
						"--out": ms(far * STAGGER),
					} as CSSProperties
				}
				onAnimationEnd={(event) => {
					if (event.animationName === "kc-chess-mark-out") onDone();
				}}
			>
				<KnightMark size={56} className="block text-ink opacity-30" />
			</span>
		</>
	);
}
