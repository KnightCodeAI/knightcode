import { AlertTriangle, Bug, Download, FileText, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { TopBar } from "@/components/glass";
import { type BugReport, bugReportFileUrl, fetchBugReports, formatSize } from "@/lib/api";
import { fullTime, shortAge } from "@/lib/time";

/** Always present in a bundle; the other two only when the reporter opted in. */
const ALWAYS = ["report.json", "diagnostics.json"] as const;

function Files({ report }: { report: BugReport }): React.JSX.Element {
	const files = [
		...ALWAYS,
		...(report.has_session ? (["session.jsonl"] as const) : []),
		...(report.has_summary ? (["summary.md"] as const) : []),
	];
	return (
		<span className="flex flex-wrap gap-2">
			{files.map((file) => (
				<a
					key={file}
					className="flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1 text-[13px] text-label-2 transition-colors hover:bg-raised-hover hover:text-label"
					href={bugReportFileUrl(report.id, file)}
				>
					<Download className="size-3.5 flex-none" aria-hidden="true" />
					{file}
				</a>
			))}
		</span>
	);
}

function ReportRow({ report }: { report: BugReport }): React.JSX.Element {
	const where = [report.version, report.platform, report.arch, report.runtime].filter(Boolean).join(" · ");
	return (
		<li className="flex flex-col gap-2.5 rounded-[1.25rem] bg-raised px-4 py-3.5 text-label">
			<span className="flex items-start gap-3">
				<span className="flex min-w-0 flex-1 flex-col gap-1">
					<span className="text-[17px] leading-snug font-medium">
						{report.description ?? <span className="text-label-3">No description</span>}
					</span>
					<span className="flex flex-wrap items-center gap-1.5 text-[14px] text-label-2">
						<span className="font-mono text-[13px]">{report.id}</span>
						{where ? (
							<>
								<span aria-hidden="true">·</span>
								<span>{where}</span>
							</>
						) : null}
						<span aria-hidden="true">·</span>
						<span>{formatSize(report.size_bytes)}</span>
					</span>
				</span>
				<time
					className="flex-none self-start pt-0.5 text-[14px] text-label-3 tabular-nums"
					dateTime={new Date(report.created_at).toISOString()}
					title={fullTime(report.created_at)}
				>
					{shortAge(report.created_at)}
				</time>
			</span>
			<span className="flex flex-wrap items-center gap-2 text-[13px] text-label-2">
				{report.has_session ? (
					<span className="flex items-center gap-1.5">
						<ScrollText className="size-3.5" aria-hidden="true" />
						transcript
					</span>
				) : null}
				{report.has_summary ? (
					<span className="flex items-center gap-1.5">
						<FileText className="size-3.5" aria-hidden="true" />
						summary
					</span>
				) : null}
				{report.crash_count > 0 ? (
					<span className="flex items-center gap-1.5 text-warn">
						<AlertTriangle className="size-3.5" aria-hidden="true" />
						{report.crash_count} {report.crash_count === 1 ? "crash" : "crashes"}
					</span>
				) : null}
			</span>
			<Files report={report} />
		</li>
	);
}

/**
 * Reports are uploaded anonymously by `/bug` and read only by a login in ADMIN_LOGINS.
 * The Worker answers 404 to everyone else, including signed-in accounts, so a failure here
 * is a real failure rather than a sign-in prompt.
 */
export function Bugs(): React.JSX.Element {
	const [reports, setReports] = useState<BugReport[]>();
	const [error, setError] = useState<string>();

	useEffect(() => {
		const controller = new AbortController();
		fetchBugReports(controller.signal).then(setReports, (cause: unknown) => {
			if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
		});
		return () => {
			controller.abort();
		};
	}, []);

	return (
		<div className="relative min-h-dvh">
			<TopBar center={<span className="text-[17px] font-semibold">Bug reports</span>} />
			<main className="mx-auto max-w-3xl px-3 pb-10" style={{ paddingTop: "calc(var(--safe-top) + var(--topbar))" }}>
				{error ? <p className="px-3 pt-[20vh] text-center text-label-2">{error}</p> : null}
				{!error && reports === undefined ? (
					<p className="px-3 pt-[20vh] text-center text-label-2">Loading reports…</p>
				) : null}
				{reports?.length === 0 ? (
					<p className="flex flex-col items-center gap-2 px-3 pt-[20vh] text-center text-label-2">
						<Bug className="size-6" aria-hidden="true" />
						No reports yet. <code>/bug</code> in KnightCode files one.
					</p>
				) : null}
				{reports?.length ? (
					<ul className="flex flex-col gap-2.5">
						{reports.map((report) => (
							<ReportRow key={report.id} report={report} />
						))}
					</ul>
				) : null}
			</main>
		</div>
	);
}
