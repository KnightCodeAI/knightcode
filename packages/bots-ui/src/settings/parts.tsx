// The pieces every settings page is built from, as measured: a section with a small heading, a card, and rows with a
// title, an optional hint, and a control on the right. Titles carry a "copy link" button that shows on hover.
import { Link } from "lucide-react";
import { type ReactNode, useState } from "react";

/** A stable anchor id for a title. */
export const anchorOf = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** Copies a link to this setting (the page with its anchor); a check shows briefly. */
export function CopyLink({ anchor, label }: { anchor: string; label: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			className="kb-copy-link"
			data-copied={copied ? "" : undefined}
			aria-label={`Copy link to the ${label} setting`}
			onClick={() => {
				void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#${anchor}`);
				setCopied(true);
				setTimeout(() => setCopied(false), 1200);
			}}
		>
			<Link size={14} />
		</button>
	);
}

/** A titled group; `action` sits at the right of the heading (Add rule). */
export function SettingsSection({
	title,
	hint,
	action,
	children,
}: {
	title?: string;
	hint?: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="kb-set-section" id={title ? anchorOf(title) : undefined}>
			{(title || action) && (
				<div className={hint ? "kb-set-section__head kb-set-section__head--hint" : "kb-set-section__head"}>
					<div className="kb-set-section__titles">
						{title && (
							<div className="kb-set-section__title-row">
								<h3 className="kb-set-section__title">{title}</h3>
								<CopyLink anchor={anchorOf(title)} label={title} />
							</div>
						)}
						{hint && <p className="kb-set-section__hint">{hint}</p>}
					</div>
					{action}
				</div>
			)}
			{children}
		</section>
	);
}

/** The rounded card rows sit in. */
export function SettingsCard({ children }: { children: ReactNode }) {
	return <div className="kb-set-card">{children}</div>;
}

/** One row. The first row on a page carries the measured refs. */
export function SettingsRow({
	title,
	hint,
	control,
	first,
}: {
	title: ReactNode;
	hint?: ReactNode;
	control?: ReactNode;
	first?: boolean;
}) {
	const anchor = typeof title === "string" ? anchorOf(title) : undefined;
	return (
		<div className="kb-set-row" id={anchor} data-ref={first ? "settings-row" : undefined}>
			<div className="kb-set-row__copy" data-ref={first ? "settings-copy" : undefined}>
				<div className="kb-set-row__title">
					<span>{title}</span>
					{anchor && <CopyLink anchor={anchor} label={title as string} />}
				</div>
				{hint && <span className="kb-set-row__hint">{hint}</span>}
			</div>
			{control && (
				<div className="kb-set-row__control" data-ref={first ? "settings-control" : undefined}>
					{control}
				</div>
			)}
		</div>
	);
}
