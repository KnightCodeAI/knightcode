// TODO: the Tmux/Tungsten session pill is an internal coordinator-session footer
// affordance gated to a build target this fork never ships. It renders nothing;
// its call site is behind a permanently-false guard.
import type * as React from 'react'

export function TungstenPill(_props: { selected: boolean }): React.ReactNode {
  return null
}
