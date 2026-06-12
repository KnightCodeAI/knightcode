/** A keybinding context, e.g. 'Global', 'Chat'. Contexts scope bindings so
 *  the same chord can mean different things in different UI areas. */
export type KeybindingContextName = string

/** An action name, e.g. 'app:toggleTranscript' or 'confirm:no'. */
export type KeybindingAction = string

/** A single keystroke parsed from a string like "ctrl+shift+k". */
export type ParsedKeystroke = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
  super: boolean
}

/** A sequence of keystrokes, e.g. "ctrl+k ctrl+s" parses to two entries. */
export type Chord = ParsedKeystroke[]

/** One binding: a chord mapped to an action within a context.
 *  `action: null` explicitly unbinds the chord. */
export type ParsedBinding = {
  chord: Chord
  action: KeybindingAction | null
  context: KeybindingContextName
}

/** A block of bindings from JSON config, keyed by chord string. */
export type KeybindingBlock = {
  context: KeybindingContextName
  bindings: Record<string, KeybindingAction | null>
}
