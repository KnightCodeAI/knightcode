import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";

/**
 * A visible in-chat line shown above the assistant reply when skill
 * auto-discovery (or path-matching) surfaced relevant skills this turn —
 * claude-code's skill_discovery / dynamic_skill attachment line. Not a toast.
 */
export function SkillSurfacedNotice({ skills }: { skills: string[] }) {
  const { colors } = useTheme();
  if (!skills || skills.length === 0) return null;
  return (
    <box flexDirection="row" gap={1} marginTop={1}>
      <text fg={colors.primary} attributes={TextAttributes.BOLD}>
        ↳ Relevant skill{skills.length === 1 ? "" : "s"}:
      </text>
      <text fg={colors.text}>{skills.join(", ")}</text>
    </box>
  );
}
