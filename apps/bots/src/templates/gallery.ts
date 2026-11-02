// The template gallery (spec section 5), served from the Worker: the same data the interface ships
// (packages/bots-ui/src/bot/templates-data.ts), so the two never drift. A template carries no files, credentials or
// memory; its routines arrive paused.
import type { Template } from "@knightcode/bots-protocol";
import { TEMPLATE_AREAS, TEMPLATES } from "@knightcode/bots-ui/templates";

export { TEMPLATE_AREAS };

export const listTemplates = (): Template[] => TEMPLATES;

export const templateById = (id: string): Template | undefined => TEMPLATES.find((template) => template.id === id);
