// TODO: overage-credit upsell is out of scope (account/billing UX).
import type * as React from 'react'
import type { FeedConfig } from './Feed.js'

export function isEligibleForOverageCreditGrant(): boolean {
  return false
}

export function shouldShowOverageCreditUpsell(): boolean {
  return false
}

export function maybeRefreshOverageCreditCache(): void {}

export function useShowOverageCreditUpsell(): boolean {
  return false
}

export function incrementOverageCreditUpsellSeenCount(): void {}

export function OverageCreditUpsell(_props: {
  maxWidth?: number
  twoLine?: boolean
}): React.ReactNode {
  return null
}

export function createOverageCreditFeed(): FeedConfig {
  return { title: '', lines: [] }
}
