// Builds the human-readable "why is this being asked?" string for a permission
// decision. This is the display side of the decision engine; the interactive
// dispatch that produces the decisions lives in the harness permission layer.

import type {
  PermissionDecisionReason,
  PermissionRuleSource,
} from '../../types/permissions.js'
import { extractOutputRedirections } from '../bash/commands.js'
import { plural } from '../stringUtils.js'
import { getSettingSourceDisplayNameLowercase } from '../settings/constants.js'
import { permissionModeTitle } from './PermissionMode.js'
import { permissionRuleValueToString } from './permissionRuleParser.js'

export function permissionRuleSourceDisplayString(
  source: PermissionRuleSource,
): string {
  return getSettingSourceDisplayNameLowercase(source)
}

export function createPermissionRequestMessage(
  toolName: string,
  decisionReason?: PermissionDecisionReason,
): string {
  // Handle different decision reason types
  if (decisionReason) {
    switch (decisionReason.type) {
      case 'classifier':
        return `Classifier '${decisionReason.classifier}' requires approval for this ${toolName} command: ${decisionReason.reason}`
      case 'hook': {
        const hookMessage = decisionReason.reason
          ? `Hook '${decisionReason.hookName}' blocked this action: ${decisionReason.reason}`
          : `Hook '${decisionReason.hookName}' requires approval for this ${toolName} command`
        return hookMessage
      }
      case 'rule': {
        const ruleString = permissionRuleValueToString(
          decisionReason.rule.ruleValue,
        )
        const sourceString = permissionRuleSourceDisplayString(
          decisionReason.rule.source,
        )
        return `Permission rule '${ruleString}' from ${sourceString} requires approval for this ${toolName} command`
      }
      case 'subcommandResults': {
        const needsApproval: string[] = []
        for (const [cmd, result] of decisionReason.reasons) {
          if (result.behavior === 'ask' || result.behavior === 'passthrough') {
            // Strip output redirections for display to avoid showing filenames as commands.
            // Only do this for Bash tool to avoid affecting other tools.
            if (toolName === 'Bash') {
              const { commandWithoutRedirections, redirections } =
                extractOutputRedirections(cmd)
              const displayCmd =
                redirections.length > 0 ? commandWithoutRedirections : cmd
              needsApproval.push(displayCmd)
            } else {
              needsApproval.push(cmd)
            }
          }
        }
        if (needsApproval.length > 0) {
          const n = needsApproval.length
          return `This ${toolName} command contains multiple operations. The following ${plural(n, 'part')} ${plural(n, 'requires', 'require')} approval: ${needsApproval.join(', ')}`
        }
        return `This ${toolName} command contains multiple operations that require approval`
      }
      case 'permissionPromptTool':
        return `Tool '${decisionReason.permissionPromptToolName}' requires approval for this ${toolName} command`
      case 'sandboxOverride':
        return 'Run outside of the sandbox'
      case 'workingDir':
        return decisionReason.reason
      case 'safetyCheck':
      case 'other':
        return decisionReason.reason
      case 'mode': {
        const modeTitle = permissionModeTitle(decisionReason.mode)
        return `Current permission mode (${modeTitle}) requires approval for this ${toolName} command`
      }
      case 'asyncAgent':
        return decisionReason.reason
    }
  }

  // Default message without listing allowed commands
  return `The model requested permissions to use ${toolName}, but you haven't granted it yet.`
}
