import type { Skill } from "../../skills";
import { simplifySkill } from "./simplify";
import { rememberSkill } from "./remember";
import { stuckSkill } from "./stuck";
import { verifySkill } from "./verify";
import { loremSkill } from "./lorem";
import { batchSkill } from "./batch";
import { skillifySkill } from "./skillify";

const bundledSkills: Skill[] = [
  simplifySkill,
  rememberSkill,
  stuckSkill,
  verifySkill,
  loremSkill,
  batchSkill,
  skillifySkill,
];

export function getBundledSkills(): Skill[] {
  return [...bundledSkills];
}
