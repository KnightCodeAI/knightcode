// TODO: guest-passes referral upsell is out of scope (account/billing UX).
import type * as React from 'react'

export function useShowGuestPassesUpsell(): boolean {
  return false
}

export function incrementGuestPassesSeenCount(): void {}

export function GuestPassesUpsell(): React.ReactNode {
  return null
}
