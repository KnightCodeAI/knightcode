/** Interactive home mark; reduced motion keeps the static icon. */
import { useEffect, useState } from "react";
import KnightGame from "./knight-game.tsx";
import { KnightMark } from "./mark-icon.tsx";

export function HomeMark() {
	const [playing, setPlaying] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [reduceMotion, setReduceMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
	useEffect(() => {
		const preference = matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => {
			setReduceMotion(preference.matches);
			if (preference.matches) setPlaying(false);
		};
		update();
		preference.addEventListener("change", update);
		return () => preference.removeEventListener("change", update);
	}, []);
	const mark = <KnightMark size={56} className="kc-home-mark-icon block text-ink opacity-30" />;
	return (
		<button
			type="button"
			className="kc-home-mark"
			aria-label="Chess animation"
			aria-pressed={playing}
			disabled={reduceMotion}

			onClick={(event) => {
				if (playing) setStopping(true);
				else if (!reduceMotion) {
					const slot = event.currentTarget;
					const area = slot.closest(".kc-home-content");

					const box = slot.getBoundingClientRect();
					const overhang = parseFloat(getComputedStyle(slot).getPropertyValue("--kc-chess-board")) - box.height;
					if (area && box.top - area.getBoundingClientRect().top < overhang) return;
					setStopping(false);
					setPlaying(true);
				}
			}}
		>
			{playing ? <KnightGame stopping={stopping} onDone={() => setPlaying(false)} /> : mark}
		</button>
	);
}
