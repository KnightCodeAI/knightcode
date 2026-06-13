// TODO: the message-action surface (hover/select/expand controls for transcript
// rows) lands with the transcript renderer. Only the context flag that tells
// children whether they render inside a virtualized list lives here for now.

import * as React from 'react'

/** True when descendants render inside a virtualized message list. */
export const InVirtualListContext = React.createContext(false)

/** True when the enclosing message row is the selected one. */
export const MessageActionsSelectedContext = React.createContext(false)

// Background key for the selected row; consumers put it on the Box that owns
// the marginTop so the margin stays outside the painted background.
export function useSelectedMessageBg(): 'messageActionsBackground' | undefined {
  return React.useContext(MessageActionsSelectedContext)
    ? 'messageActionsBackground'
    : undefined
}
