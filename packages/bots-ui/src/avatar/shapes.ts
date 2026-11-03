// The avatar shapes the picker offers.
import type { AvatarShape } from "@knightcode/bots-protocol";

/**
 * The shapes the avatar picker offers, in its order, as measured. The other named shapes stay valid (templates and
 * imports use them) but are not offered.
 */
export const PICKER_SHAPES: AvatarShape[] = [
	"blob",
	"cloud",
	"square",
	"sparkle",
	"clover",
	"heart",
	"flower",
	"teardrop",
	"tablet",
	"wedge",
	"house",
	"star",
	"hex",
	// The reference's fourth slot on this row holds a seasonal avatar; ours holds a shape of its own.
	"pebble",
];
