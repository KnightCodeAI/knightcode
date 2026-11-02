// Live widgets (spec section 19): a widget reads its source directly (a routine's latest output, a connector read tool,
// a file) and refreshes on a schedule or when its routine runs. A refresh never calls a model, so it costs the user no
// tokens: the readers below are plain data reads, and nothing here takes a model.
import type { PageBlock } from "@knightcode/bots-protocol";

type Widget = Extract<PageBlock, { type: "widget" }>;

export interface WidgetReaders {
	/** The text of a routine's latest run result ("<botId>/<routineId>"). */
	routineOutput(ref: string): Promise<string | undefined>;
	/** A connector read tool's result ("<appId>/<tool>"). */
	connectorRead(ref: string): Promise<unknown>;
	/** A file's text by id. */
	file(ref: string): Promise<string | undefined>;
}

/** The widget's data as its view wants it: a number, a list, rows, or a chart spec when the data is one. */
function shape(view: Widget["view"], raw: unknown): unknown {
	if (view === "number") {
		const number = typeof raw === "number" ? raw : Number(String(raw ?? "").match(/-?\d+(\.\d+)?/)?.[0]);
		return Number.isFinite(number) ? number : null;
	}
	if (view === "list") return typeof raw === "string" ? raw.split("\n").map((line) => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean).slice(0, 100) : raw;
	if (typeof raw === "string") {
		try {
			return JSON.parse(raw) as unknown;
		} catch {
			return raw;
		}
	}
	return raw;
}

/** The widget with fresh data, or unchanged (with its old data) when its source cannot be read now. */
export async function refreshWidget(widget: Widget, readers: WidgetReaders, now = Date.now()): Promise<Widget> {
	let raw: unknown;
	try {
		raw =
			widget.source.kind === "routine"
				? await readers.routineOutput(widget.source.ref)
				: widget.source.kind === "connector"
					? await readers.connectorRead(widget.source.ref)
					: await readers.file(widget.source.ref);
	} catch {
		return widget;
	}
	if (raw === undefined) return widget;
	return { ...widget, data: shape(widget.view, raw) as never, refreshedAt: now };
}

/** Every widget of a page refreshed; other blocks unchanged. */
export async function refreshPage(blocks: PageBlock[], readers: WidgetReaders, now = Date.now()): Promise<PageBlock[]> {
	return Promise.all(blocks.map((block) => (block.type === "widget" ? refreshWidget(block, readers, now) : block)));
}
