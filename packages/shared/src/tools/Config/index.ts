import { z } from "zod";
import { defineTool } from "../defineTool";

const input_schema = z.object({
  setting: z
    .string()
    .describe('The setting key (e.g., "theme", "model", "defaultMode")'),
  value: z
    .union([z.string(), z.boolean(), z.number()])
    .optional()
    .describe("The new value. Omit to get the current value."),
});

export const Config = defineTool({
  name: "Config",
  is_read_only: false,
  is_concurrency_safe: true,
  is_deferred: true,
  visibility: "always",
  search_hint: "get or set knightcode settings (theme, model)",
  input_schema,
  description: `Get or set a knightcode setting in ~/.knightcode/settings.json.

- Omit "value" to read the current value (auto-allowed).
- Provide "value" to change it (requires confirmation).

Returns { success, operation, setting, value | previousValue/newValue, error }.`,
});

export type ConfigInput = z.infer<typeof input_schema>;
