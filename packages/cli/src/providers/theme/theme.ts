export type ThemeColors = {
  primary: string;
  primaryShimmer: string;
  planMode: string;
  autoMode: string;
  autoModeShimmer: string;
  fastMode: string;
  fastModeShimmer: string;
  permission: string;
  permissionShimmer: string;
  selection: string;
  thinking: string;

  success: string;
  error: string;
  warning: string;
  warningShimmer: string;
  merged: string;
  remember: string;

  text: string;
  inverseText: string;
  dimSeparator: string;
  dimSeparatorShimmer: string;
  subtle: string;
  promptBorder: string;
  promptBorderShimmer: string;
  bashBorder: string;
  info: string;

  background: string;
  surface: string;
  surfaceHover: string;
  dialogSurface: string;
  messageActions: string;
  selectionBg: string;
  bashMessageBg: string;
  memoryBg: string;
  thinkingBorder: string;

  diffAdded: string;
  diffRemoved: string;
  diffAddedDimmed: string;
  diffRemovedDimmed: string;
  diffAddedWord: string;
  diffRemovedWord: string;

  rateLimitFill: string;
  rateLimitEmpty: string;

  briefLabelYou: string;
  briefLabelAssistant: string;
};

export type Theme = {
  name: string;
  colors: ThemeColors;
};

// ── Helper: rgb → hex ─────────────────────────────────────────────────
function rgb(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()
  );
}

export const THEMES: Theme[] = [
  // ── Dark ────────────────────────────────────────────────────────────
  {
    name: "Dark",
    colors: {
      primary: rgb(215, 119, 87), // the reference TUI
      primaryShimmer: rgb(235, 159, 127), // brandShimmer
      planMode: rgb(72, 150, 140), // planMode
      autoMode: rgb(175, 135, 255), // autoAccept
      autoModeShimmer: rgb(205, 165, 255), // derived lighter
      fastMode: rgb(255, 120, 20), // fastMode
      fastModeShimmer: rgb(255, 165, 70), // fastModeShimmer

      permission: rgb(177, 185, 249), // permission
      permissionShimmer: rgb(207, 215, 255), // permissionShimmer
      selection: rgb(177, 185, 249), // suggestion
      thinking: rgb(177, 185, 249), // permission (same as the reference TUI)

      success: rgb(78, 186, 101), // success
      error: rgb(255, 107, 128), // error
      warning: rgb(255, 193, 7), // warning
      warningShimmer: rgb(255, 223, 57), // warningShimmer
      merged: rgb(175, 135, 255), // merged
      remember: rgb(177, 185, 249), // remember

      text: rgb(255, 255, 255), // text
      inverseText: rgb(0, 0, 0), // inverseText
      dimSeparator: rgb(153, 153, 153), // inactive
      dimSeparatorShimmer: rgb(193, 193, 193), // inactiveShimmer
      subtle: rgb(80, 80, 80), // subtle
      promptBorder: rgb(136, 136, 136), // promptBorder
      promptBorderShimmer: rgb(166, 166, 166), // promptBorderShimmer
      bashBorder: rgb(253, 93, 177), // bashBorder
      info: rgb(71, 130, 200), // ide

      background: "#0D0D0D", // derived
      surface: rgb(55, 55, 55), // userMessageBackground
      surfaceHover: rgb(70, 70, 70), // userMessageBackgroundHover
      dialogSurface: "#1C1C1C", // derived
      messageActions: rgb(44, 50, 62), // messageActionsBackground
      selectionBg: rgb(38, 79, 120), // selectionBg
      bashMessageBg: rgb(65, 60, 65), // bashMessageBackgroundColor
      memoryBg: rgb(55, 65, 70), // memoryBackgroundColor
      thinkingBorder: rgb(80, 80, 80), // subtle (same as the reference TUI)

      diffAdded: rgb(34, 92, 43), // diffAdded
      diffRemoved: rgb(122, 41, 54), // diffRemoved
      diffAddedDimmed: rgb(71, 88, 74), // diffAddedDimmed
      diffRemovedDimmed: rgb(105, 72, 77), // diffRemovedDimmed
      diffAddedWord: rgb(56, 166, 96), // diffAddedWord
      diffRemovedWord: rgb(179, 89, 107), // diffRemovedWord

      rateLimitFill: rgb(177, 185, 249), // rate_limit_fill
      rateLimitEmpty: rgb(80, 83, 112), // rate_limit_empty

      briefLabelYou: rgb(122, 180, 232), // briefLabelYou
      briefLabelAssistant: rgb(215, 119, 87), // briefLabelAssistant
    },
  },

  // ── Light ───────────────────────────────────────────────────────────
  {
    name: "Light",
    colors: {
      primary: rgb(215, 119, 87), // the reference TUI
      primaryShimmer: rgb(245, 149, 117), // brandShimmer
      planMode: rgb(0, 102, 102), // planMode
      autoMode: rgb(135, 0, 255), // autoAccept
      autoModeShimmer: rgb(165, 50, 255), // derived lighter
      fastMode: rgb(255, 106, 0), // fastMode
      fastModeShimmer: rgb(255, 150, 50), // fastModeShimmer

      permission: rgb(87, 105, 247), // permission
      permissionShimmer: rgb(137, 155, 255), // permissionShimmer
      selection: rgb(87, 105, 247), // suggestion
      thinking: rgb(87, 105, 247), // permission (same as the reference TUI)

      success: rgb(44, 122, 57), // success
      error: rgb(171, 43, 63), // error
      warning: rgb(150, 108, 30), // warning
      warningShimmer: rgb(200, 158, 80), // warningShimmer
      merged: rgb(135, 0, 255), // merged
      remember: rgb(0, 0, 255), // remember

      text: rgb(0, 0, 0), // text
      inverseText: rgb(255, 255, 255), // inverseText
      dimSeparator: rgb(102, 102, 102), // inactive
      dimSeparatorShimmer: rgb(142, 142, 142), // inactiveShimmer
      subtle: rgb(175, 175, 175), // subtle
      promptBorder: rgb(153, 153, 153), // promptBorder
      promptBorderShimmer: rgb(183, 183, 183), // promptBorderShimmer
      bashBorder: rgb(255, 0, 135), // bashBorder
      info: rgb(71, 130, 200), // ide

      background: "#FFFFFF", // derived
      surface: rgb(240, 240, 240), // userMessageBackground
      surfaceHover: rgb(252, 252, 252), // userMessageBackgroundHover
      dialogSurface: "#FAFAFA", // derived
      messageActions: rgb(232, 236, 244), // messageActionsBackground
      selectionBg: rgb(180, 213, 255), // selectionBg
      bashMessageBg: rgb(250, 245, 250), // bashMessageBackgroundColor
      memoryBg: rgb(230, 245, 250), // memoryBackgroundColor
      thinkingBorder: rgb(175, 175, 175), // subtle (same as the reference TUI)

      diffAdded: rgb(105, 219, 124), // diffAdded
      diffRemoved: rgb(255, 168, 180), // diffRemoved
      diffAddedDimmed: rgb(199, 225, 203), // diffAddedDimmed
      diffRemovedDimmed: rgb(253, 210, 216), // diffRemovedDimmed
      diffAddedWord: rgb(47, 157, 68), // diffAddedWord
      diffRemovedWord: rgb(209, 69, 75), // diffRemovedWord

      rateLimitFill: rgb(87, 105, 247), // rate_limit_fill
      rateLimitEmpty: rgb(39, 47, 111), // rate_limit_empty

      briefLabelYou: rgb(37, 99, 235), // briefLabelYou
      briefLabelAssistant: rgb(215, 119, 87), // briefLabelAssistant
    },
  },

  // ── Dark Daltonized ─────────────────────────────────────────────────
  {
    name: "Dark Daltonized",
    colors: {
      primary: rgb(255, 153, 51), // the reference TUI
      primaryShimmer: rgb(255, 183, 101), // brandShimmer
      planMode: rgb(102, 153, 153), // planMode
      autoMode: rgb(175, 135, 255), // autoAccept
      autoModeShimmer: rgb(205, 165, 255), // derived lighter
      fastMode: rgb(255, 120, 20), // fastMode
      fastModeShimmer: rgb(255, 165, 70), // fastModeShimmer

      permission: rgb(153, 204, 255), // permission
      permissionShimmer: rgb(183, 224, 255), // permissionShimmer
      selection: rgb(153, 204, 255), // suggestion
      thinking: rgb(153, 204, 255), // permission

      success: rgb(51, 153, 255), // success (blue, not green)
      error: rgb(255, 102, 102), // error
      warning: rgb(255, 204, 0), // warning
      warningShimmer: rgb(255, 234, 50), // warningShimmer
      merged: rgb(175, 135, 255), // merged
      remember: rgb(153, 204, 255), // remember

      text: rgb(255, 255, 255), // text
      inverseText: rgb(0, 0, 0), // inverseText
      dimSeparator: rgb(153, 153, 153), // inactive
      dimSeparatorShimmer: rgb(193, 193, 193), // inactiveShimmer
      subtle: rgb(80, 80, 80), // subtle
      promptBorder: rgb(136, 136, 136), // promptBorder
      promptBorderShimmer: rgb(166, 166, 166), // promptBorderShimmer
      bashBorder: rgb(51, 153, 255), // bashBorder
      info: rgb(71, 130, 200), // ide

      background: "#0D0D0D", // derived
      surface: rgb(55, 55, 55), // userMessageBackground
      surfaceHover: rgb(70, 70, 70), // userMessageBackgroundHover
      dialogSurface: "#1C1C1C", // derived
      messageActions: rgb(44, 50, 62), // messageActionsBackground
      selectionBg: rgb(38, 79, 120), // selectionBg
      bashMessageBg: rgb(65, 60, 65), // bashMessageBackgroundColor
      memoryBg: rgb(55, 65, 70), // memoryBackgroundColor
      thinkingBorder: rgb(80, 80, 80), // subtle

      diffAdded: rgb(0, 68, 102), // diffAdded (blue)
      diffRemoved: rgb(102, 0, 0), // diffRemoved
      diffAddedDimmed: rgb(62, 81, 91), // diffAddedDimmed
      diffRemovedDimmed: rgb(62, 44, 44), // diffRemovedDimmed
      diffAddedWord: rgb(0, 119, 179), // diffAddedWord
      diffRemovedWord: rgb(179, 0, 0), // diffRemovedWord

      rateLimitFill: rgb(153, 204, 255), // rate_limit_fill
      rateLimitEmpty: rgb(69, 92, 115), // rate_limit_empty

      briefLabelYou: rgb(122, 180, 232), // briefLabelYou
      briefLabelAssistant: rgb(255, 153, 51), // briefLabelAssistant
    },
  },

  // ── Light Daltonized ────────────────────────────────────────────────
  {
    name: "Light Daltonized",
    colors: {
      primary: rgb(255, 153, 51), // the reference TUI
      primaryShimmer: rgb(255, 183, 101), // brandShimmer
      planMode: rgb(51, 102, 102), // planMode
      autoMode: rgb(135, 0, 255), // autoAccept
      autoModeShimmer: rgb(165, 50, 255), // derived lighter
      fastMode: rgb(255, 106, 0), // fastMode
      fastModeShimmer: rgb(255, 150, 50), // fastModeShimmer

      permission: rgb(51, 102, 255), // permission
      permissionShimmer: rgb(101, 152, 255), // permissionShimmer
      selection: rgb(51, 102, 255), // suggestion
      thinking: rgb(51, 102, 255), // permission

      success: rgb(0, 102, 153), // success (blue)
      error: rgb(204, 0, 0), // error
      warning: rgb(255, 153, 0), // warning
      warningShimmer: rgb(255, 183, 50), // warningShimmer
      merged: rgb(135, 0, 255), // merged
      remember: rgb(51, 102, 255), // remember

      text: rgb(0, 0, 0), // text
      inverseText: rgb(255, 255, 255), // inverseText
      dimSeparator: rgb(102, 102, 102), // inactive
      dimSeparatorShimmer: rgb(142, 142, 142), // inactiveShimmer
      subtle: rgb(175, 175, 175), // subtle
      promptBorder: rgb(153, 153, 153), // promptBorder
      promptBorderShimmer: rgb(183, 183, 183), // promptBorderShimmer
      bashBorder: rgb(0, 102, 204), // bashBorder
      info: rgb(71, 130, 200), // ide

      background: "#FFFFFF", // derived
      surface: rgb(220, 220, 220), // userMessageBackground
      surfaceHover: rgb(232, 232, 232), // userMessageBackgroundHover
      dialogSurface: "#FAFAFA", // derived
      messageActions: rgb(210, 216, 226), // messageActionsBackground
      selectionBg: rgb(180, 213, 255), // selectionBg
      bashMessageBg: rgb(250, 245, 250), // bashMessageBackgroundColor
      memoryBg: rgb(230, 245, 250), // memoryBackgroundColor
      thinkingBorder: rgb(175, 175, 175), // subtle

      diffAdded: rgb(153, 204, 255), // diffAdded (light blue)
      diffRemoved: rgb(255, 204, 204), // diffRemoved
      diffAddedDimmed: rgb(209, 231, 253), // diffAddedDimmed
      diffRemovedDimmed: rgb(255, 233, 233), // diffRemovedDimmed
      diffAddedWord: rgb(51, 102, 204), // diffAddedWord
      diffRemovedWord: rgb(153, 51, 51), // diffRemovedWord

      rateLimitFill: rgb(51, 102, 255), // rate_limit_fill
      rateLimitEmpty: rgb(23, 46, 114), // rate_limit_empty

      briefLabelYou: rgb(37, 99, 235), // briefLabelYou
      briefLabelAssistant: rgb(255, 153, 51), // briefLabelAssistant
    },
  },

  // ── Dark ANSI ───────────────────────────────────────────────────────
  {
    name: "Dark ANSI",
    colors: {
      primary: "#FF0000", // the reference TUI = ansi:redBright
      primaryShimmer: "#FF6666", // derived lighter
      planMode: "#00FFFF", // planMode = ansi:cyanBright
      autoMode: "#FF00FF", // autoAccept = ansi:magentaBright
      autoModeShimmer: "#FF99FF", // derived lighter
      fastMode: "#FF0000", // fastMode = ansi:redBright
      fastModeShimmer: "#FF6666", // derived lighter

      permission: "#5C5CFF", // permission = ansi:blueBright
      permissionShimmer: "#5C5CFF", // ansi:blueBright
      selection: "#5C5CFF", // suggestion = ansi:blueBright
      thinking: "#5C5CFF", // permission = ansi:blueBright

      success: "#00FF00", // success = ansi:greenBright
      error: "#FF0000", // error = ansi:redBright
      warning: "#FFFF00", // warning = ansi:yellowBright
      warningShimmer: "#FFFF00", // ansi:yellowBright
      merged: "#FF00FF", // merged = ansi:magentaBright
      remember: "#5C5CFF", // remember = ansi:blueBright

      text: "#E5E5E5", // text = ansi:whiteBright
      inverseText: "#000000", // inverseText = ansi:black
      dimSeparator: "#E5E5E5", // inactive = ansi:white
      dimSeparatorShimmer: "#E5E5E5", // ansi:white
      subtle: "#E5E5E5", // subtle = ansi:white
      promptBorder: "#E5E5E5", // promptBorder = ansi:white
      promptBorderShimmer: "#E5E5E5", // ansi:white
      bashBorder: "#FF00FF", // bashBorder = ansi:magentaBright
      info: "#0000EE", // ide = ansi:blue

      background: "#000000", // derived (ansi:black)
      surface: "#2B2B2B", // derived (usable dark panel)
      surfaceHover: "#3A3A3A", // derived
      dialogSurface: "#000000", // clawd_background = ansi:black
      messageActions: "#2B2B2B", // derived
      selectionBg: "#0000EE", // selectionBg = ansi:blue
      bashMessageBg: "#000000", // ansi:black
      memoryBg: "#2B2B2B", // derived
      thinkingBorder: "#E5E5E5", // subtle = ansi:white

      diffAdded: "#00CD00", // diffAdded = ansi:green
      diffRemoved: "#CD0000", // diffRemoved = ansi:red
      diffAddedDimmed: "#00CD00", // diffAdded = ansi:green
      diffRemovedDimmed: "#CD0000", // diffRemoved = ansi:red
      diffAddedWord: "#00FF00", // diffAddedWord = ansi:greenBright
      diffRemovedWord: "#FF0000", // diffRemovedWord = ansi:redBright

      rateLimitFill: "#FFFF00", // rate_limit_fill = ansi:yellow
      rateLimitEmpty: "#E5E5E5", // rate_limit_empty = ansi:white

      briefLabelYou: "#5C5CFF", // briefLabelYou = ansi:blueBright
      briefLabelAssistant: "#FF0000", // briefLabelAssistant = ansi:redBright
    },
  },

  // ── Light ANSI ──────────────────────────────────────────────────────
  {
    name: "Light ANSI",
    colors: {
      primary: "#FF0000", // the reference TUI = ansi:redBright
      primaryShimmer: "#FF6666", // derived lighter
      planMode: "#00CDCD", // planMode = ansi:cyan
      autoMode: "#CD00CD", // autoAccept = ansi:magenta
      autoModeShimmer: "#E066E0", // derived lighter
      fastMode: "#FF0000", // fastMode = ansi:redBright
      fastModeShimmer: "#FF6666", // derived lighter

      permission: "#0000EE", // permission = ansi:blue
      permissionShimmer: "#5C5CFF", // ansi:blueBright
      selection: "#0000EE", // suggestion = ansi:blue
      thinking: "#0000EE", // permission = ansi:blue

      success: "#00CD00", // success = ansi:green
      error: "#CD0000", // error = ansi:red
      warning: "#CDCD00", // warning = ansi:yellow
      warningShimmer: "#CDCD00", // ansi:yellow
      merged: "#CD00CD", // merged = ansi:magenta
      remember: "#0000EE", // remember = ansi:blue

      text: "#000000", // text = ansi:black
      inverseText: "#E5E5E5", // inverseText = ansi:whiteBright
      dimSeparator: "#7F7F7F", // inactive = ansi:blackBright
      dimSeparatorShimmer: "#7F7F7F", // ansi:blackBright
      subtle: "#7F7F7F", // subtle = ansi:blackBright
      promptBorder: "#7F7F7F", // promptBorder = ansi:blackBright
      promptBorderShimmer: "#7F7F7F", // ansi:blackBright
      bashBorder: "#CD00CD", // bashBorder = ansi:magenta
      info: "#5C5CFF", // ide = ansi:blueBright

      background: "#FFFFFF", // derived
      surface: "#F0F0F0", // derived (usable light panel)
      surfaceHover: "#F8F8F8", // derived
      dialogSurface: "#FAFAFA", // derived
      messageActions: "#F0F0F0", // derived
      selectionBg: "#00CDCD", // selectionBg = ansi:cyan
      bashMessageBg: "#FFFFFF", // derived
      memoryBg: "#F0F0F0", // derived
      thinkingBorder: "#7F7F7F", // subtle = ansi:blackBright

      diffAdded: "#00CD00", // diffAdded = ansi:green
      diffRemoved: "#CD0000", // diffRemoved = ansi:red
      diffAddedDimmed: "#00CD00", // diffAdded = ansi:green
      diffRemovedDimmed: "#CD0000", // diffRemoved = ansi:red
      diffAddedWord: "#00FF00", // diffAddedWord = ansi:greenBright
      diffRemovedWord: "#FF0000", // diffRemovedWord = ansi:redBright

      rateLimitFill: "#CDCD00", // rate_limit_fill = ansi:yellow
      rateLimitEmpty: "#7F7F7F", // rate_limit_empty = ansi:blackBright

      briefLabelYou: "#0000EE", // briefLabelYou = ansi:blue
      briefLabelAssistant: "#FF0000", // briefLabelAssistant = ansi:redBright
    },
  },
];

export const DEFAULT_THEME = THEMES.find((t) => t.name === "Dark")!;
