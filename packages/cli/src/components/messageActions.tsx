// TODO: the message-action surface (hover/select/expand controls for transcript
// rows) lands with the transcript renderer. Only the context flag that tells
// children whether they render inside a virtualized list lives here for now.

import * as React from 'react'

/** True when descendants render inside a virtualized message list. */
export const InVirtualListContext = React.createContext(false)
