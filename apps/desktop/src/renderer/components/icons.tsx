import { type ReactNode, type SVGProps, useId } from "react";

/*
 * KnightCode's icon set, drawn for the desktop app in the Codex desktop app's style (measured 2026-10-18): a
 * 16-unit grid, 1.05-unit strokes with round caps and joins, 2.5-unit corner radii. Rendered at 20px the same
 * drawing gives the heavier 1.3px line Codex uses for its rail. As in Codex, an icon holds still on hover and
 * press; the button around it changes (styles.css, .kc-button). `filled` draws an icon's selected or open
 * form: parts tagged data-fill appear (and fill), parts tagged data-empty disappear.
 *
 * Icons are usually drawn in a translucent colour (half white at rest). Painted part by part, every place two
 * strokes meet would come out brighter, so the parts are drawn into a mask and the colour is painted through it
 * once, which is what Codex gets from shipping each icon as a single filled outline. `overlay` is painted on top,
 * unmasked, for parts with colours of their own.
 */

export type IconProps = SVGProps<SVGSVGElement> & { size?: number | string; filled?: boolean };

function icon(name: string, body: ReactNode, overlay?: ReactNode) {
	const Icon = ({ size = 16, strokeWidth = 1.05, className, filled, fill, ...rest }: IconProps) => {
		const id = useId();
		return (
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width={size}
				height={size}
				viewBox="0 0 16 16"
				fill="none"
				aria-hidden="true"
				data-filled={filled || undefined}
				className={className ? `ki ${className}` : "ki"}
				{...rest}
			>
				<mask id={id}>
					<g
						color="#fff"
						fill={fill && fill !== "none" ? "#fff" : "none"}
						stroke="#fff"
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						{body}
					</g>
				</mask>
				<rect width="16" height="16" fill="currentColor" mask={`url(#${id})`} />
				{overlay}
			</svg>
		);
	};
	Icon.displayName = name;
	return Icon;
}

const dot = (cx: number, cy: number, r = 0.8) => <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

// A sheet with its top-right corner folded over.
const SHEET = "M9.5 2H5.5A2.5 2.5 0 0 0 3 4.5v7A2.5 2.5 0 0 0 5.5 14h5a2.5 2.5 0 0 0 2.5-2.5V5.5Z";
const FOLD = "M9.5 2v2a1.5 1.5 0 0 0 1.5 1.5h2";
// A folder whose tab steps down into the top edge.
const FOLDER =
	"M2 4.75a2 2 0 0 1 2-2h1.9a2 2 0 0 1 1.25.44l.85.68a2 2 0 0 0 1.25.43H12a2 2 0 0 1 2 2v5.95a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z";
const FRAME = <rect x="2" y="2.75" width="12" height="10.5" rx="2.5" />;
const CIRCLE = <circle cx="8" cy="8" r="6.25" />;
const SHIELD =
	"M3 4.1a1.25 1.25 0 0 1 .8-1.17l3.75-1.4a1.25 1.25 0 0 1 .9 0l3.75 1.4a1.25 1.25 0 0 1 .8 1.17v3.65c0 3.05-2.15 5.3-5 6.5-2.85-1.2-5-3.45-5-6.5Z";
// Codex's diff colours, at half strength, for the panes of the diff-layout icons.
const DELETED = { fill: "#f84e63", fillOpacity: 0.5 };
const ADDED = { fill: "#36d958", fillOpacity: 0.5 };

// Six broad, flat teeth, one pointing up, traced once at load.
const GEAR = (() => {
	const points: string[] = [];
	for (let i = 0; i < 96; i++) {
		const t = (i / 96) * Math.PI * 2;
		const r = 5.45 + (0.65 * Math.tanh(-3 * Math.cos(6 * t))) / Math.tanh(3);
		points.push(`${(8 + r * Math.cos(t)).toFixed(2)} ${(8 + r * Math.sin(t)).toFixed(2)}`);
	}
	return `M${points.join("L")}Z`;
})();

export const ChevronRight = icon("ChevronRight", <path d="M6.5 4 10.25 8 6.5 12" />);
export const ChevronLeft = icon("ChevronLeft", <path d="M9.5 4 5.75 8 9.5 12" />);
export const ChevronDown = icon("ChevronDown", <path d="m4 6.5 4 3.75 4-3.75" />);
export const ChevronUp = icon("ChevronUp", <path d="m4 9.5 4-3.75 4 3.75" />);

export const ArrowUp = icon("ArrowUp", <path d="M8 13.25V2.75M3.5 7.25 8 2.75l4.5 4.5" />);
export const ArrowDown = icon("ArrowDown", <path d="M8 2.75v10.5M3.5 8.75 8 13.25l4.5-4.5" />);
export const Download = icon("Download", <path d="M8 2.75v7.5M4.75 7 8 10.25 11.25 7M3 13.25h10" />);
export const ArrowLeft = icon("ArrowLeft", <path d="M13.25 8H2.75M7.25 3.5 2.75 8l4.5 4.5" />);
export const ArrowRight = icon("ArrowRight", <path d="M2.75 8h10.5M8.75 3.5 13.25 8l-4.5 4.5" />);
export const ArrowUpRight = icon("ArrowUpRight", <path d="m4.5 11.5 7-7m-6 0h6v6" />);
export const ArrowLeftRight = icon(
	"ArrowLeftRight",
	<path d="M2.5 5.25h11m-2.75-2.75 2.75 2.75L10.75 8m2.75 2.75h-11M5.25 8 2.5 10.75l2.75 2.75" />,
);
export const CornerDownLeft = icon("CornerDownLeft", <path d="M13 3v3.75A2.75 2.75 0 0 1 10.25 9.5H3m3-3-3 3 3 3" />);
export const ExternalLink = icon(
	"ExternalLink",
	<path d="M7.25 2.5h-2A2.75 2.75 0 0 0 2.5 5.25v5.5a2.75 2.75 0 0 0 2.75 2.75h5.5a2.75 2.75 0 0 0 2.75-2.75v-2m-4-6.25h4v4m0-4L8 8" />,
);
export const RefreshCw = icon(
	"RefreshCw",
	<path d="M2.75 8a5.25 5.25 0 0 1 9.55-3.01M12.75 2.5v2.75H10M13.25 8a5.25 5.25 0 0 1-9.55 3.01M3.25 13.5v-2.75H6" />,
);
// Codex's Undo: an arrow back to the left that comes round into a hook.
export const Undo = icon("Undo", <path d="M5.25 2 2.5 4.75 5.25 7.5M2.5 4.75h6.75a4 4 0 0 1 0 8h-2.5" />);
// Codex's spinner: a faint ring with three quarters of it drawn over, turned by `motion-safe:animate-spin`.
export const Spinner = icon(
	"Spinner",
	<>
		<circle cx="8" cy="8" r="4.75" strokeWidth={1.35} strokeOpacity={0.3} />
		<path d="M8 3.25a4.75 4.75 0 1 1-4.75 4.75" strokeWidth={1.35} />
	</>,
);
// Codex's "Collapse all diffs" and "Expand all diffs": arrows meeting or parting beside the lines.
export const CollapseAll = icon(
	"CollapseAll",
	<path d="M4.5 1.75v4.5m-2-2 2 2 2-2m-2 7.5v-4.5m-2 2 2-2 2 2M9 6.75h5.25M9 9.25h3.5" />,
);
export const ExpandAll = icon(
	"ExpandAll",
	<path d="M4.5 2.25v11.5m-2-9.5 2-2 2 2m-4 7.5 2 2 2-2M9 4.75h5.25M9 8h5.25M9 11.25h3.5" />,
);

// Codex's "Enter full screen" and "Exit full screen": two arrows out to opposite corners, or in from them.
export const Maximize = icon(
	"Maximize",
	<path d="M3.33 9.33v3.34h3.34M3.33 12.67 6.7 9.3m2.63-5.97h3.34v3.34m0-3.34L9.3 6.7" />,
);
export const Minimize = icon(
	"Minimize",
	<path d="M3.33 9.33h3.34v3.34M3 13l3.67-3.67m2.66-6v3.34h3.34M13 3 9.33 6.67" />,
);

export const X = icon("X", <path d="m4 4 8 8m0-8-8 8" />);
export const Plus = icon("Plus", <path d="M8 3v10M3 8h10" />);
export const Minus = icon("Minus", <path d="M3 8h10" />);
export const Check = icon("Check", <path data-m="draw" pathLength={1} d="M3.5 8.5 6.5 11.5l6-7" />);
export const MoreHorizontal = icon(
	"MoreHorizontal",
	<>
		{dot(3.33, 8, 1.15)}
		{dot(8, 8, 1.15)}
		{dot(12.67, 8, 1.15)}
	</>,
);

export const Search = icon(
	"Search",
	<>
		<circle cx="7.25" cy="7.25" r="4.75" />
		<path d="m10.65 10.65 3.1 3.1" />
	</>,
);
export const Settings = icon(
	"Settings",
	<>
		<path d={GEAR} />
		<circle cx="8" cy="8" r="2" />
	</>,
);
// Selected, the house is solid with the door left open, as Codex's rail draws Home.
export const House = icon(
	"House",
	<>
		<path d="M1.9 7.1 7.05 3.05a1.55 1.55 0 0 1 1.9 0l5.15 4.05M3.25 6.1v5.2a2 2 0 0 0 2 2H6.5v-1.8a1.5 1.5 0 0 1 3 0v1.8h1.25a2 2 0 0 0 2-2V6.1" />
		<path
			data-fill
			d="M3.25 6.1 7.05 3.1a1.55 1.55 0 0 1 1.9 0l3.8 3v5.2a2 2 0 0 1-2 2H9.5v-1.8a1.5 1.5 0 0 0-3 0v1.8H5.25a2 2 0 0 1-2-2Z"
		/>
	</>,
);

export const File = icon(
	"File",
	<>
		<path d={SHEET} />
		<path d={FOLD} />
	</>,
);
export const FileText = icon(
	"FileText",
	<>
		<path d={SHEET} />
		<path d={FOLD} />
		<path d="M5.75 8.75h4.5m-4.5 2.5h3" />
	</>,
);
export const FilePen = icon(
	"FilePen",
	<>
		<path d="M13 7.25V5.5L9.5 2H5.5A2.5 2.5 0 0 0 3 4.5v7A2.5 2.5 0 0 0 5.5 14H7" />
		<path d={FOLD} />
		<path d="M12.15 8.85a1.2 1.2 0 0 1 1.7 1.7L10.4 14l-2.15.5.5-2.15Z" />
	</>,
);
// Codex's "Changes": plus over minus in a rounded square.
export const FileDiff = icon(
	"FileDiff",
	<>
		<rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
		<path d="M8 4.75v3.5M6.25 6.5h3.5m-3.5 4h3.5" />
	</>,
);
export const FileSearch = icon(
	"FileSearch",
	<>
		<path d="M6.5 14h-1A2.5 2.5 0 0 1 3 11.5v-7A2.5 2.5 0 0 1 5.5 2h4L13 5.5v1.75" />
		<path d={FOLD} />
		<circle cx="10" cy="10.25" r="2.25" />
		<path d="m11.65 11.9 1.85 1.85" />
	</>,
);

export const Folder = icon(
	"Folder",
	<>
		<path d={FOLDER} />
		<path d="M2 6.5h12" />
	</>,
);
export const FolderOpen = icon(
	"FolderOpen",
	<path d="M12.75 6.25v-.5a1.75 1.75 0 0 0-1.75-1.75H8.6a2 2 0 0 1-1.25-.44l-.85-.68a2 2 0 0 0-1.25-.43H3.75A1.75 1.75 0 0 0 2 4.2v7.3c0 .97.78 1.75 1.75 1.75h7.6a1.5 1.5 0 0 0 1.4-.95l1.6-4.05a1 1 0 0 0-.93-1.37H5.05a1.5 1.5 0 0 0-1.4.95L2.05 12" />,
);
export const FolderPlus = icon(
	"FolderPlus",
	<>
		<path d="M8 13.25H4a2 2 0 0 1-2-2v-6.5a2 2 0 0 1 2-2h1.9a2 2 0 0 1 1.25.44l.85.68a2 2 0 0 0 1.25.43H12a2 2 0 0 1 2 2V8" />
		<path d="M12 9.5v4.5m-2.25-2.25h4.5" />
	</>,
);
// Codex's file-tree toggle: one folder in front of another.
export const Folders = icon(
	"Folders",
	<path d="M1.75 6.75A1.75 1.75 0 0 1 3.5 5h1.6a1.5 1.5 0 0 1 1 .38l.65.57a1.5 1.5 0 0 0 1 .38H9.5a1.75 1.75 0 0 1 1.75 1.75v4.17a1.75 1.75 0 0 1-1.75 1.75h-6a1.75 1.75 0 0 1-1.75-1.75ZM4.75 5V4.5A1.75 1.75 0 0 1 6.5 2.75h1.6a1.5 1.5 0 0 1 1 .38l.65.57a1.5 1.5 0 0 0 1 .38h1.75a1.75 1.75 0 0 1 1.75 1.75v4.17a1.75 1.75 0 0 1-1.75 1.75h-1.25" />,
);

export const GitBranch = icon(
	"GitBranch",
	<>
		<circle cx="4.5" cy="3.75" r="1.6" />
		<circle cx="11.5" cy="3.75" r="1.6" />
		<circle cx="4.5" cy="12.25" r="1.6" />
		<path d="M4.5 5.35v5.3m7-5.3v.4c0 1.7-1.3 3-3 3H7c-1.4 0-2.5.9-2.5 1.9" />
	</>,
);
export const GitBranchPlus = icon(
	"GitBranchPlus",
	<>
		<circle cx="4.5" cy="12.25" r="1.6" />
		<path d="M4.5 1.75v8.9m0 0c0-2.1 1.4-3.65 3.5-3.65h.75" />
		<path d="M12 1.75v4.5M9.75 4h4.5" />
	</>,
);
export const GitCommitHorizontal = icon(
	"GitCommitHorizontal",
	<>
		<circle cx="8" cy="8" r="2.5" />
		<path d="M1.75 8H5.5m5 0h3.75" />
	</>,
);
export const GitPullRequest = icon(
	"GitPullRequest",
	<>
		<circle cx="4.25" cy="3.75" r="1.6" />
		<circle cx="4.25" cy="12.25" r="1.6" />
		<circle cx="11.75" cy="12.25" r="1.6" />
		<path d="M4.25 5.35v5.3m7.5 0V6a2 2 0 0 0-2-2H8m1.5-1.75L7.75 4 9.5 5.75" />
	</>,
);
export const GitPullRequestDraft = icon(
	"GitPullRequestDraft",
	<>
		<circle cx="4.25" cy="3.75" r="1.6" />
		<circle cx="4.25" cy="12.25" r="1.6" />
		<circle cx="11.75" cy="12.25" r="1.6" />
		<path d="M4.25 5.35v5.3m7.5-7.15v.01m0 3.24v1.25" />
	</>,
);

export const Square = icon("Square", <rect x="3" y="3" width="10" height="10" rx="2.5" />);
export const SquareTerminal = icon(
	"SquareTerminal",
	<>
		<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.75" />
		<path d="M5.25 6 7.25 8l-2 2m3.5.25H11" />
	</>,
);
// Codex's code block mark: angle brackets around a slash.
export const Code = icon("Code", <path d="M5 5.25 2.25 8 5 10.75m6-5.5L13.75 8 11 10.75M9.25 4.5l-2.5 7" />);
export const SquareSlash = icon(
	"SquareSlash",
	<>
		<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2.75" />
		<path d="m9.25 5.5-2.5 5" />
	</>,
);
// Codex's "New chat": a square open at one corner, a pencil writing into it.
export const SquarePen = icon(
	"SquarePen",
	<>
		<path d="M7.25 2.5h-2A2.75 2.75 0 0 0 2.5 5.25v5.5a2.75 2.75 0 0 0 2.75 2.75h5.5a2.75 2.75 0 0 0 2.75-2.75v-2" />
		<path d="M11.6 2.9a1.4 1.4 0 0 1 2 2L9 9.5l-2.5.6.6-2.5Z" />
	</>,
);
// The diff layouts, with Codex's red and green panes: side by side, and stacked.
export const Columns2 = icon(
	"Columns2",
	FRAME,
	<>
		<rect x="3.65" y="4.4" width="3.8" height="7.2" rx="0.6" {...DELETED} />
		<rect x="8.55" y="4.4" width="3.8" height="7.2" rx="0.6" {...ADDED} />
	</>,
);
export const Rows2 = icon(
	"Rows2",
	FRAME,
	<>
		<rect x="3.65" y="4.4" width="8.7" height="3.05" rx="0.6" {...DELETED} />
		<rect x="3.65" y="8.55" width="8.7" height="3.05" rx="0.6" {...ADDED} />
	</>,
);
// Open (filled), the sidebar's edge runs the full height; closed, a short bar stands for it.
export const PanelLeft = icon(
	"PanelLeft",
	<>
		{FRAME}
		<path data-fill d="M6 2.75v10.5" />
		<path data-empty d="M4.6 5.5v5" />
	</>,
);
// Open (filled), the frame is split down the middle; closed, it is empty.
export const PanelRight = icon(
	"PanelRight",
	<>
		{FRAME}
		<path data-fill d="M8 2.75v10.5" />
	</>,
);

/** Codex's "New tab" (the side panel's toggle): a rounded square with a plus. */
export const SquarePlus = icon(
	"SquarePlus",
	<>
		<rect x="2.33" y="2.33" width="11.33" height="11.33" rx="2" />
		<path d="M8 5.17v5.66M5.17 8h5.66" />
	</>,
);

export const Pencil = icon(
	"Pencil",
	<path d="M10.6 3.15a1.75 1.75 0 0 1 2.47 2.47L6.2 12.5l-3.2.85.85-3.2ZM9.5 4.25l2.47 2.47" />,
);
export const AppWindow = icon(
	"AppWindow",
	<>
		<rect x="2.25" y="3" width="11.5" height="10" rx="2.25" />
		<path d="M2.25 6h11.5M4.5 4.5h.01M6.25 4.5h.01" />
	</>,
);
export const Copy = icon(
	"Copy",
	<>
		<rect x="2.25" y="5.25" width="8.5" height="8.5" rx="2.25" />
		<path d="M5.25 5.25V4.5A2.25 2.25 0 0 1 7.5 2.25h4a2.25 2.25 0 0 1 2.25 2.25v4a2.25 2.25 0 0 1-2.25 2.25h-.75" />
	</>,
);
export const Clipboard = icon(
	"Clipboard",
	<>
		<rect x="5.5" y="1.75" width="5" height="2.5" rx="1" />
		<path d="M5.5 3H5a2 2 0 0 0-2 2v7.25a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-.5" />
	</>,
);
export const Eye = icon(
	"Eye",
	<>
		<path d="M1.75 8C3.1 5.3 5.4 3.75 8 3.75s4.9 1.55 6.25 4.25C12.9 10.7 10.6 12.25 8 12.25S3.1 10.7 1.75 8Z" />
		<circle cx="8" cy="8" r="2.25" />
	</>,
);
export const Trash2 = icon(
	"Trash2",
	<path d="M2.75 4.25h10.5M6 4.25V3.5a1.25 1.25 0 0 1 1.25-1.25h1.5A1.25 1.25 0 0 1 10 3.5v.75m-6 0 .65 7.9a2 2 0 0 0 2 1.85h2.7a2 2 0 0 0 2-1.85L12 4.25M6.75 7v4m2.5-4v4" />,
);
export const Archive = icon(
	"Archive",
	<>
		<rect x="2" y="2.5" width="12" height="3.25" rx="1.25" />
		<path d="M3 5.75v5.75a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V5.75m-6.25 2.75h2.5" />
	</>,
);
export const ArchiveRestore = icon(
	"ArchiveRestore",
	<>
		<rect x="2" y="2.5" width="12" height="3.25" rx="1.25" />
		<path d="M3 5.75v5.75a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V5.75M8 11.5V8.25M6.25 10 8 8.25 9.75 10" />
	</>,
);
// A thumbtack, drawn upright and leaned over so the needle points down-left.
const TACK = (
	<g transform="rotate(45 8 8)">
		<path d="M6.25 1.75h3.5a.9.9 0 0 1 .64 1.54l-.39.39V6.9l2.03 1.62a1 1 0 0 1 .37.78v.2a.75.75 0 0 1-.75.75H4.35a.75.75 0 0 1-.75-.75v-.2a1 1 0 0 1 .37-.78L6 6.9V3.68l-.39-.39a.9.9 0 0 1 .64-1.54Z" />
		<path d="M8 10.25v4.5" />
	</g>
);
export const Pin = icon("Pin", TACK);
export const PinOff = icon(
	"PinOff",
	<>
		{TACK}
		<path d="m2 2 12 12" />
	</>,
);

export const CircleAlert = icon(
	"CircleAlert",
	<>
		{CIRCLE}
		<path d="M8 4.75V8.5" />
		{dot(8, 11)}
	</>,
);
export const CircleCheck = icon(
	"CircleCheck",
	<>
		{CIRCLE}
		<path d="m5.5 8.25 1.75 1.75 3.25-3.75" />
	</>,
);
// "Mark as unread": an envelope with a dot at its corner.
export const MailDot = icon(
	"MailDot",
	<>
		<path d="M13.75 7.75v3.5a2.5 2.5 0 0 1-2.5 2.5h-6.5a2.5 2.5 0 0 1-2.5-2.5v-6.5a2.5 2.5 0 0 1 2.5-2.5H8.5" />
		<path d="m2.5 5.25 5.5 3.5 2.25-1.4" />
		<circle cx="12.5" cy="3.5" r="1.75" />
	</>,
);
// Codex's filter: three lines, each shorter.
export const List = icon("List", <path d="M6.75 4h6.5M6.75 8h6.5M6.75 12h6.5M3 4h.01M3 8h.01M3 12h.01" />);
export const ArrowDownUp = icon(
	"ArrowDownUp",
	<path d="M4.75 3.5v9.75M2.25 10.75l2.5 2.5 2.5-2.5M11.25 12.5V2.75M8.75 5.25l2.5-2.5 2.5 2.5" />,
);
export const ListFilter = icon("ListFilter", <path d="M2.75 4.5h10.5M4.75 8h6.5M6.75 11.5h2.5" />);
// Codex's "Import theme": an arrow down into a tray.
export const Import = icon(
	"Import",
	<path d="M8 2.75v7.5m-3-3 3 3 3-3M3 10.5v1.25a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5V10.5" />,
);
export const Info = icon(
	"Info",
	<>
		{CIRCLE}
		<path d="M8 7.25V11" />
		{dot(8, 5)}
	</>,
);
// Codex's asked-questions row: a question mark in a circle.
export const CircleHelp = icon(
	"CircleHelp",
	<>
		{CIRCLE}
		<path d="M6.4 6.25a1.7 1.7 0 0 1 3.3.55c0 1.15-1.7 1.45-1.7 2.45" />
		{dot(8, 11)}
	</>,
);
// Web searches: a globe with its meridian and equator.
export const Globe = icon(
	"Globe",
	<>
		{CIRCLE}
		<path d="M2.25 8h11.5M8 2.25c-1.6 1.6-2.4 3.5-2.4 5.75s.8 4.15 2.4 5.75c1.6-1.6 2.4-3.5 2.4-5.75S9.6 3.85 8 2.25Z" />
	</>,
);
export const CircleUserRound = icon(
	"CircleUserRound",
	<>
		{CIRCLE}
		<circle cx="8" cy="6.5" r="2.2" />
		<path d="M3.9 12.3a4.75 4.75 0 0 1 8.2 0" />
	</>,
);
// Codex's Help: a life buoy.
export const LifeBuoy = icon(
	"LifeBuoy",
	<>
		{CIRCLE}
		<circle cx="8" cy="8" r="2.6" />
		<path d="m3.6 3.6 2.55 2.55m3.7 3.7 2.55 2.55m0-8.8L9.85 6.15m-3.7 3.7L3.6 12.4" />
	</>,
);
// The approval modes, as Codex draws them: a shield running commands, and a shield with a warning.
export const ShieldTerminal = icon(
	"ShieldTerminal",
	<>
		<path d={SHIELD} />
		<path d="M5.75 6 7.25 7.5 5.75 9m2.75.75h1.75" />
	</>,
);
export const ShieldAlert = icon(
	"ShieldAlert",
	<>
		<path d={SHIELD} />
		<path d="M8 4.75V8.25" />
		{dot(8, 10.5)}
	</>,
);

export const LogIn = icon(
	"LogIn",
	<path d="M9 2.5h2A2.5 2.5 0 0 1 13.5 5v6a2.5 2.5 0 0 1-2.5 2.5H9M2.5 8h7M6.75 5.25 9.5 8l-2.75 2.75" />,
);
export const LogOut = icon(
	"LogOut",
	<path d="M7 2.5H5A2.5 2.5 0 0 0 2.5 5v6A2.5 2.5 0 0 0 5 13.5h2M6.5 8h7m-2.75-2.75L13.5 8l-2.75 2.75" />,
);
export const KeyRound = icon(
	"KeyRound",
	<>
		<circle cx="10.5" cy="5.5" r="3.25" />
		{dot(11.25, 4.75)}
		<path d="M8.2 7.8 2.5 13.5M4 12l1.5 1.5m0-3 1.25 1.25" />
	</>,
);
export const Keyboard = icon(
	"Keyboard",
	<>
		<rect x="1.75" y="3.75" width="12.5" height="8.5" rx="2.25" />
		{dot(4.6, 6.75, 0.65)}
		{dot(6.87, 6.75, 0.65)}
		{dot(9.13, 6.75, 0.65)}
		{dot(11.4, 6.75, 0.65)}
		<path d="M5.5 9.5h5" />
	</>,
);
export const Hand = icon(
	"Hand",
	<path d="M4.75 8.5V4.25a1.13 1.13 0 0 1 2.25 0V7.5m0 0V2.75a1.13 1.13 0 0 1 2.25 0V7.5m0 0V3.75a1.13 1.13 0 0 1 2.25 0V8m0 0V5.5a1.13 1.13 0 0 1 2.25 0v4.5A4.5 4.5 0 0 1 9.25 14.5H8.1a4 4 0 0 1-3.05-1.41L2.6 10.2a1.13 1.13 0 0 1 1.65-1.53l.5.53" />,
);

export const MessageSquare = icon(
	"MessageSquare",
	<path d="M4.75 2.5h6.5A2.75 2.75 0 0 1 14 5.25v3.5a2.75 2.75 0 0 1-2.75 2.75H8.6l-2.5 2.15a.55.55 0 0 1-.9-.42V11.5h-.45A2.75 2.75 0 0 1 2 8.75v-3.5A2.75 2.75 0 0 1 4.75 2.5Z" />,
);
// Codex's "Toggle summary": two items, each a ring and a line.
export const ListTodo = icon(
	"ListTodo",
	<>
		<circle cx="4" cy="4.5" r="1.75" />
		<circle cx="4" cy="11.5" r="1.75" />
		<path d="M8.25 4.5H14m-5.75 7H14" />
	</>,
);
export const Layers = icon("Layers", <path d="M8 2 14 5 8 8 2 5Zm-6 6 6 3 6-3m-12 3 6 3 6-3" />);
export const BookOpen = icon(
	"BookOpen",
	<path d="M8 4.25c-1.1-.95-2.6-1.5-4.5-1.5H2.25v9.5H3.5c1.9 0 3.4.55 4.5 1.5 1.1-.95 2.6-1.5 4.5-1.5h1.25v-9.5H12.5c-1.9 0-3.4.55-4.5 1.5Zm0 0v9.5" />,
);
export const Lightbulb = icon(
	"Lightbulb",
	<path d="M10 11.5c0-1 .45-1.65 1-2.3a4.25 4.25 0 1 0-6 0c.55.65 1 1.3 1 2.3m4 0v.5A1.75 1.75 0 0 1 8.25 13.75h-.5A1.75 1.75 0 0 1 6 12v-.5m4 0H6" />,
);
export const Brain = icon(
	"Brain",
	<path d="M8 3.25A2.25 2.25 0 0 0 4 4.25a2.5 2.5 0 0 0-1.5 4.1A2.4 2.4 0 0 0 4.25 12 2.25 2.25 0 0 0 8 12.75m0-9.5a2.25 2.25 0 0 1 4 1 2.5 2.5 0 0 1 1.5 4.1A2.4 2.4 0 0 1 11.75 12 2.25 2.25 0 0 1 8 12.75m0-9.5v9.5" />,
);
export const Sparkles = icon(
	"Sparkles",
	<path d="M6.25 2c.4 2.75 1.5 3.85 4.25 4.25-2.75.4-3.85 1.5-4.25 4.25C5.85 7.75 4.75 6.65 2 6.25 4.75 5.85 5.85 4.75 6.25 2Zm6 7.25c.18 1.25.75 1.82 2 2-1.25.18-1.82.75-2 2-.18-1.25-.75-1.82-2-2 1.25-.18 1.82-.75 2-2Z" />,
);
export const Zap = icon(
	"Zap",
	<path d="M8.9 1.75 3.6 8.6a.5.5 0 0 0 .4.8h3.6l-.6 4.85 5.3-6.85a.5.5 0 0 0-.4-.8H8.3Z" />,
);
export const Wrench = icon(
	"Wrench",
	<path d="M10.75 2.35a3.5 3.5 0 0 0-4.2 4.6L2.6 10.9a1.25 1.25 0 0 0 1.77 1.77l3.95-3.95a3.5 3.5 0 0 0 4.6-4.2l-1.6 1.6-1.85-.35-.35-1.85Z" />,
);
// Codex's "Word wrap": a line turning back on itself before the margin.
export const WrapText = icon("WrapText", <path d="M13.25 2.5v11M2.75 5h5.5a2.75 2.75 0 0 1 0 5.5H3M5 8.5l-2 2 2 2" />);
export const ImagePlus = icon(
	"ImagePlus",
	<>
		<path d="M14 8.25v2.5a2.75 2.75 0 0 1-2.75 2.75h-6.5A2.75 2.75 0 0 1 2 10.75v-5.5A2.75 2.75 0 0 1 4.75 2.5H8" />
		<path d="m2.3 11.3 3.1-3.1a1.25 1.25 0 0 1 1.77 0l4.3 4.3" />
		<path d="M12 1.25v4.5M9.75 3.5h4.5" />
	</>,
);
export const CloudUpload = icon(
	"CloudUpload",
	<path d="M5 12.75h-.5a3 3 0 0 1-.35-5.98 4.25 4.25 0 0 1 8.15-1.17 3.5 3.5 0 0 1-.55 7.15H11M8 13.75V8.5m-2 2 2-2 2 2" />,
);

/**
 * KnightCode's mark (apps/web/public/knightcode-mark.svg): a filled knight on its base, drawn in the current colour.
 * The home screen shows it large and faint, where Codex shows its own logo.
 */
export function KnightMark({ size = 16, className }: { size?: number; className?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={className}>
			<path
				fillRule="evenodd"
				clipRule="evenodd"
				d="M7.44 0.5L7.95 0.62L8.73 0.99L11.04 2.82L11.47 3.37L10.78 4.58L11.92 3.92L12.64 5.36L12.62 5.6L11.53 7.06L12.85 6.16L13.03 6.96L13.11 7.94L12.5 8.66L11.56 9.39L12.31 9.15L13.03 8.7L13.01 9.21L12.48 10.91L11.29 11.3L10.92 11.61L10.69 11.98L10.61 12.34L10.69 12.65L11.31 12.86L11.43 13.02L4.9 13.04L4.98 12.79L4.73 12.34L4.63 11.87L4.63 11.42L4.83 10.75L5.41 9.76L7.29 7.53L7.62 6.93L7.78 6.32L7.03 7.16L6.23 7.1L5.51 7.16L4.87 7.39L4.12 7.88L2.89 6.83L2.99 6.2L3.75 5.7L4.46 5.09L4.83 4.62L5.16 3.9L7.79 2.06L7.44 0.5ZM8.17 5.54L8.21 6.54L8.09 7L7.83 7.65L7.25 8.57L6.19 9.99L5.74 10.91L5.65 11.38L5.65 11.87L5.78 12.34L6.06 12.8L5.49 12.77L5.2 12.41L5.02 11.83L5.08 11.18L5.45 10.34L5.86 9.76L7.27 8.12L7.76 7.39L8.09 6.55L8.21 5.91L8.17 5.54ZM5.49 5.05L5.9 4.46L7.11 3.98L6.51 4.76L5.49 5.07Z"
			/>
			<path d="M4.94 12.8H11.13A0.43 0.43 0 0 1 11.56 13.23V13.39A0.43 0.43 0 0 1 11.13 13.82H4.94A0.43 0.43 0 0 1 4.51 13.39V13.23A0.43 0.43 0 0 1 4.94 12.8Z" />
			<path d="M4.49 13.68H11.68A0.51 0.51 0 0 1 12.19 14.19V14.99A0.51 0.51 0 0 1 11.68 15.5H4.49A0.51 0.51 0 0 1 3.99 14.99V14.19A0.51 0.51 0 0 1 4.49 13.68Z" />
		</svg>
	);
}
// Codex's "Appearance": a small sun, its rays stopping short of the disc.
export const Sun = icon(
	"Sun",
	<>
		<circle cx="8" cy="8" r="2.75" />
		<path d="M8 1.75v1.25M8 13v1.25M1.75 8H3m10 0h1.25M3.6 3.6l.88.88m7.04 7.04.88.88M3.6 12.4l.88-.88m7.04-7.04.88-.88" />
	</>,
);
