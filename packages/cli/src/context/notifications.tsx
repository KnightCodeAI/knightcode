// TODO: the notification queue provider lands with the REPL; only the
// notification payload types live here for now.

import type * as React from 'react'
import type { Theme } from '../utils/theme.js'

type Priority = 'low' | 'medium' | 'high' | 'immediate'

type BaseNotification = {
  key: string
  /** Keys of notifications that this notification invalidates. */
  invalidates?: string[]
  priority: Priority
  timeoutMs?: number
  /** Combine notifications with the same key, like Array.reduce(). */
  fold?: (accumulator: Notification, incoming: Notification) => Notification
}

type TextNotification = BaseNotification & {
  text: string
  color?: keyof Theme
}

type JSXNotification = BaseNotification & {
  jsx: React.ReactNode
}

export type Notification = TextNotification | JSXNotification
