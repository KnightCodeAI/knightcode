/**
 * Declarative views from extensions (architecture.md section 8.2), drawn with the app's own components and theme
 * tokens: never HTML. The server checked every view before it got here. Controls are live only in widgets (the panel
 * above the composer); in tool rows and extension messages they are drawn disabled, since nothing waits on a press
 * of a result read back from yesterday. Props only, no store: the tests render these with renderToStaticMarkup.
 */

import type { View, Widget } from "@knightcode/app-server-protocol";
import { type ReactNode, useState } from "react";
import { matches } from "../keys.ts";
import { Button } from "./button.tsx";
import { ChevronDown } from "./icons.tsx";
import { Markdown } from "./markdown.tsx";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./menu.tsx";
import { Switch } from "./switch.tsx";

type OnEvent = (id: string, value?: string | boolean) => void;
type Field = Extract<View, { type: "field" }>;

/** The terminal's MAX_WIDGET_LINES: a widget of lines shows at most this many. */
const MAX_WIDGET_LINES = 10;

const TONES = {
	muted: "text-tertiary",
	accent: "text-accent",
	success: "text-success",
	warning: "text-warning",
	error: "text-danger-text",
} as const;

/** A text field holds a draft while focused; Enter or leaving it sends the draft when it changed, Escape drops it. */
function TextField({ field, onEvent }: { field: Field; onEvent?: OnEvent }) {
	const value = String(field.value);
	const [draft, setDraft] = useState<string>();
	const commit = (next: string) => {
		setDraft(undefined);
		if (next !== value) onEvent?.(field.id, next);
	};
	return (
		<input
			aria-label={field.label}
			disabled={!onEvent}
			value={draft ?? value}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => {
				if (draft !== undefined) commit(draft);
			}}
			onKeyDown={(e) => {
				if (matches(e, "desktop.item.activate") && draft !== undefined) commit(draft);
				if (matches(e, "desktop.picker.dismiss")) {
					e.preventDefault();
					setDraft(undefined);
				}
			}}
			className="kc-input h-7 min-w-0 flex-1 text-base"
		/>
	);
}

function FieldNode({ field, onEvent }: { field: Field; onEvent?: OnEvent }) {
	// Radix opens a menu on pointerdown, and a label forwards only a click: the label opens the select itself.
	const [open, setOpen] = useState(false);
	let control: ReactNode;
	if (field.kind === "toggle")
		control = (
			<Switch
				size="sm"
				label={field.label}
				checked={field.value === true}
				disabled={!onEvent}
				onChange={(checked) => onEvent?.(field.id, checked)}
			/>
		);
	else if (field.kind === "select")
		control = (
			<Menu open={open} onOpenChange={setOpen}>
				<MenuTrigger disabled={!onEvent}>
					<Button variant="field" size="sm" aria-label={field.label} disabled={!onEvent} className="max-w-64 px-2.5">
						<span className="truncate text-ink">{String(field.value)}</span>
						<ChevronDown size={14} className="text-tertiary" />
					</Button>
				</MenuTrigger>
				<MenuContent className="max-h-80 overflow-y-auto">
					<MenuRadioGroup value={String(field.value)} onValueChange={(next) => onEvent?.(field.id, next)}>
						{(field.options ?? []).map((option) => (
							<MenuRadioItem key={option} value={option}>
								{option}
							</MenuRadioItem>
						))}
					</MenuRadioGroup>
				</MenuContent>
			</Menu>
		);
	else control = <TextField field={field} onEvent={onEvent} />;
	return (
		<label
			className="flex min-w-0 items-center gap-2 text-base text-secondary"
			onClick={(e) => {
				// Not the trigger (Radix has it), and not an option: a click in the menu's portal bubbles here too.
				const target = e.target as Element;
				if (field.kind === "select" && onEvent && e.currentTarget.contains(target) && !target.closest("button"))
					setOpen(true);
			}}
		>
			<span className="shrink-0">{field.label}</span>
			{control}
		</label>
	);
}

/** One view. Without `onEvent` its buttons and fields are drawn disabled (D5). */
export function ViewNode({ view, onEvent }: { view: View; onEvent?: OnEvent }): ReactNode {
	switch (view.type) {
		case "text":
			return (
				<div className={`text-base whitespace-pre-wrap ${view.tone ? TONES[view.tone] : "text-ink"}`}>{view.text}</div>
			);
		case "markdown":
			return <Markdown text={view.markdown} />;
		case "stack":
			return (
				<div className={view.direction === "horizontal" ? "flex flex-wrap items-center gap-3" : "flex flex-col gap-2"}>
					{view.children.map((child, i) => (
						<ViewNode key={i} view={child} onEvent={onEvent} />
					))}
				</div>
			);
		case "list":
			return (
				<ul className="list-disc ps-5">
					{view.items.map((item, i) => (
						<li key={i}>
							<ViewNode view={item} onEvent={onEvent} />
						</li>
					))}
				</ul>
			);
		case "table":
			return (
				<div className="kc-markdown">
					<div className="kc-md-table">
						<table>
							<thead>
								<tr>
									{view.columns.map((column, i) => (
										<th key={i}>{column}</th>
									))}
								</tr>
							</thead>
							<tbody>
								{view.rows.map((row, r) => (
									<tr key={r}>
										{row.map((cell, c) => (
											<td key={c}>{cell}</td>
										))}
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			);
		case "progress": {
			const percent = Math.min(100, (view.value / view.max) * 100);
			return (
				<div className="flex items-center gap-2">
					<div
						role="progressbar"
						aria-label={view.label}
						aria-valuenow={view.value}
						aria-valuemax={view.max}
						className="h-1.5 w-40 overflow-hidden rounded-full bg-surface-secondary"
					>
						<div className="h-full bg-accent" style={{ width: `${percent}%` }} />
					</div>
					{view.label ? <span className="text-sm text-secondary">{view.label}</span> : null}
				</div>
			);
		}
		case "button":
			return (
				<Button variant="soft" size="sm" disabled={!onEvent} onClick={() => onEvent?.(view.id)} className="w-fit">
					{view.label}
				</Button>
			);
		case "field":
			return <FieldNode field={view} onEvent={onEvent} />;
	}
}

function WidgetBody({ widget, onEvent }: { widget: Widget; onEvent: OnEvent }) {
	if ("view" in widget) return <ViewNode view={widget.view} onEvent={onEvent} />;
	const shown = widget.lines.slice(0, MAX_WIDGET_LINES);
	return (
		<div className="font-code text-code whitespace-pre-wrap text-secondary">
			{shown.map((line, i) => (
				<div key={i}>{line || " "}</div>
			))}
			{widget.lines.length > MAX_WIDGET_LINES ? <div className="text-tertiary">… (widget truncated)</div> : null}
		</div>
	);
}

/**
 * The widget panel above the composer; nothing without widgets. Props, not the store: `useStore` has no server
 * snapshot, so a store-bound component cannot be rendered by `renderToStaticMarkup` in the tests, and `view.tsx`
 * does not import `store.ts`, which registers window listeners when imported.
 */
export function WidgetPanel({
	widgets,
	onEvent,
}: {
	widgets: Widget[];
	onEvent: (widgetKey: string, id: string, value?: string | boolean) => void;
}): ReactNode {
	if (widgets.length === 0) return null;
	// As the terminal stacks them: those above the editor first, then those below, each in the order they were set.
	const ordered = [
		...widgets.filter((w) => w.placement === "aboveEditor"),
		...widgets.filter((w) => w.placement === "belowEditor"),
	];
	return (
		<div className="mx-auto w-full max-w-3xl px-4 pb-2">
			<div className="flex max-h-48 flex-col gap-3 overflow-y-auto rounded-lg bg-card-soft px-3 py-2.5 shadow-[0_0_0_0.5px_var(--kc-border-strong)]">
				{ordered.map((widget) => (
					<WidgetBody key={widget.key} widget={widget} onEvent={(id, value) => onEvent(widget.key, id, value)} />
				))}
			</div>
		</div>
	);
}
