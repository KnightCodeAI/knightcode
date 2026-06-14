import type { SettingSource } from '../../../utils/settings/constants.js';
import type { CustomAgentDefinition } from '../../../tools/AgentTool/loadAgentsDir.js';

// Reconstructed from the wizard steps' field usage — the upstream definition was
// not present in the vendored source. Fields are filled in step-by-step, so all
// are optional; the index signature satisfies the WizardProvider's
// `Record<string, unknown>` constraint.
export interface AgentWizardData {
  agentType?: string;
  whenToUse?: string;
  systemPrompt?: string;
  selectedModel?: string | null;
  selectedTools?: string[];
  location?: SettingSource;
  finalAgent?: CustomAgentDefinition;
  wasGenerated?: boolean;
  generationPrompt?: string;
  [key: string]: unknown;
}
