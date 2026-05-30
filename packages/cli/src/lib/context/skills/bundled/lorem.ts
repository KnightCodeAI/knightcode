import type { Skill } from "../../skills";

const LOREM_TEXT = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`;

export const loremSkill: Skill = {
  name: "lorem",
  description: "Generate placeholder lorem ipsum text.",
  userInvocable: true,
  disableModelInvocation: false,
  source: "bundled",
  dirPath: "",
  body: LOREM_TEXT,
};
