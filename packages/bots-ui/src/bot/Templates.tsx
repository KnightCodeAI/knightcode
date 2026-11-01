// The template gallery, grouped by area, with importing an agent from another app at the top.
import type { Template } from "@knightcode/bots-protocol";
import { ArrowDownToLine, ChevronRight } from "lucide-react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { useResource } from "../state/store.ts";
import { TEMPLATE_AREAS } from "./templates-data.ts";

/** Picking a template fills the create form; nothing is created until the user presses Create. */
export function Templates({ onPick, onImport }: { onPick: (template: Template) => void; onImport: () => void }) {
	const { data } = useResource("templates", (api) => api.listTemplates({}));
	const templates = data?.templates ?? [];
	const areas = [...TEMPLATE_AREAS, ...new Set(templates.map((t) => t.area))].filter(
		(area, i, all) => all.indexOf(area) === i,
	);
	return (
		<div className="kb-dialog__body kb-create__body kb-templates">
			<button type="button" className="kb-templates__import" onClick={onImport}>
				<span className="kb-templates__import-icon" aria-hidden>
					<ArrowDownToLine size={16} strokeWidth={1.75} />
				</span>
				<span className="kb-templates__text">
					<span className="kb-templates__name">Import an agent</span>
					<span className="kb-templates__description">Bring a bot over from another app</span>
				</span>
				<ChevronRight size={14} className="kb-templates__chevron" aria-hidden />
			</button>
			{areas.map((area) => {
				const inArea = templates.filter((t) => t.area === area);
				if (inArea.length === 0) return null;
				return (
					<section key={area} className="kb-templates__area" aria-labelledby={`area-${area}`}>
						<h3 className="kb-templates__heading" id={`area-${area}`}>
							{area}
						</h3>
						<ul className="kb-templates__list">
							{inArea.map((template) => (
								<li key={template.id}>
									<button type="button" className="kb-templates__item" onClick={() => onPick(template)}>
										<span className="kb-templates__avatar" data-avatar-box="">
											<BotAvatarView shape={template.avatar.shape} color={template.avatar.color} size={32} />
										</span>
										<span className="kb-templates__text">
											<span className="kb-templates__name">{template.name}</span>
											<span className="kb-templates__description">{template.description}</span>
										</span>
									</button>
								</li>
							))}
						</ul>
					</section>
				);
			})}
		</div>
	);
}
