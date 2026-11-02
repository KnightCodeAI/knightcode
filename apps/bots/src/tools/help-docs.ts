// The bundled help documents, imported as text modules (wrangler's Text rule for .md).
import approvals from "../../docs/help/approvals.md";
import billing from "../../docs/help/billing.md";
import gettingStarted from "../../docs/help/getting-started.md";
import memory from "../../docs/help/memory.md";
import routines from "../../docs/help/routines.md";
import type { HelpDocs } from "./help-skill.ts";

export const HELP_DOCS: HelpDocs = { approvals, billing, "getting-started": gettingStarted, memory, routines };
