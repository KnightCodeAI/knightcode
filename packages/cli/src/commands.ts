// TODO: the slash-command system (prompt/local/local-jsx commands, argument
// parsing, the command registry) lands with the commands phase. The Tool
// surface and a few renderers reference the Command type as an array element;
// only that shape lives here for now.

export type Command = {
  type: 'prompt' | 'local' | 'local-jsx'
  name: string
  aliases?: string[]
  description: string
  isEnabled: boolean
  isHidden: boolean
  userFacingName(): string
}
