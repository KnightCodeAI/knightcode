import type { Command } from "../../commands.js";

// TODO: GitHub app installation. Hidden, disabled inert stub so the registry still lists the name.
const command: Command = {
  type: "local",
  name: "install-github-app",
  description: "install-github-app",
  isEnabled: () => false,
  isHidden: true,
  supportsNonInteractive: false,
  load: async () => ({ call: async () => ({ type: "text", value: "" }) }),
};

export default command;
