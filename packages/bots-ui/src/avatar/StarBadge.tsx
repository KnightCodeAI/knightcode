// The star on an avatar's corner: the main bot and a Chief of Staff wear it. Its parent (a `data-avatar-box`) sets its
// box through --kb-badge-* (see shell.css), and the avatar is cut away around it so it reads on any background.

/** The badge for a bot (or template), or nothing when it wears none. */
export function StarBadge({ of, ...rest }: { of: { main?: boolean; manager?: boolean }; "data-ref"?: string }) {
	if (!of.main && !of.manager) return null;
	return (
		<span className="kb-star-badge" role="img" aria-label={of.main ? "Main Bot" : "Chief of Staff"} {...rest}>
			{/* Drawn on the disc's own 24-unit box: a full star at 60% of the disc, its tips rounded by the stroke. */}
			<svg viewBox="0 0 24 24" aria-hidden>
				<path
					d="M12 5.13L14.23 9.65L19.23 10.38L15.61 13.9L16.47 18.87L12 16.53L7.53 18.87L8.39 13.9L4.77 10.38L9.77 9.65Z"
					fill="currentColor"
					stroke="currentColor"
					strokeWidth={1.25}
					strokeLinejoin="round"
				/>
			</svg>
		</span>
	);
}
