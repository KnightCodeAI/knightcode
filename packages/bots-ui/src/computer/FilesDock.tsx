// Files the bot made on its computer and saved to the user's file store, each opening a preview.
import { useResource } from "../state/store.ts";
import { FileList } from "../chat/FilePreview.tsx";

/** The list, newest first. */
export function FilesDock({ botId, onClose }: { botId: string; onClose: () => void }) {
	const { data } = useResource(`files:${botId}:bot-output`, (api) => api.listFiles({ botId, kind: "bot-output" }));
	const files = data?.files ?? [];
	return (
		<section className="kb-dock" aria-label="Files">
			<header className="kb-dock__head">
				<span>Files</span>
				<button type="button" className="kb-link-button" onClick={onClose}>
					Close
				</button>
			</header>
			<div className="kb-dock__body">
				{files.length === 0 ? (
					<p className="kb-settings__hint">Files this bot makes show up here.</p>
				) : (
					<FileList files={files} />
				)}
			</div>
		</section>
	);
}
