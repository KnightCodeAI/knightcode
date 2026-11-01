// The avatar shapes a bot can wear, shared by recipes, the UI renderer and the Worker.
import { type Static, Type } from "typebox";

/** The 25 named avatar shapes, in display order. */
export const AVATAR_SHAPES = [
	"blob",
	"pebble",
	"bean",
	"egg",
	"squircle",
	"tablet",
	"capsule",
	"cylinder",
	"hex",
	"gem",
	"crystal",
	"wedge",
	"shield",
	"dome",
	"arch",
	"cloud",
	"teardrop",
	"leaf",
	"square",
	"sparkle",
	"clover",
	"flower",
	"heart",
	"house",
	"star",
] as const;

export type AvatarShape = (typeof AVATAR_SHAPES)[number];

/** One of the named avatar shapes. */
export const AvatarShapeSchema = Type.Enum(AVATAR_SHAPES);

/** The eleven avatar colours, in picker order. Each theme renders them with its own shade ("black" is light on dark). */
export const AVATAR_COLORS = [
	"black",
	"brown",
	"red",
	"orange",
	"yellow",
	"green",
	"cyan",
	"blue",
	"violet",
	"magenta",
	"gray",
] as const;

export type AvatarColorName = (typeof AVATAR_COLORS)[number];

export const AvatarColorSchema = Type.Enum(AVATAR_COLORS);

/** A bot's avatar: a named shape in a named palette colour. */
export const AvatarSchema = Type.Object({ shape: AvatarShapeSchema, color: AvatarColorSchema });
export type Avatar = Static<typeof AvatarSchema>;
