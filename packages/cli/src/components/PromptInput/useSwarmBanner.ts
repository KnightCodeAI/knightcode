// TODO: swarm/teammate banner — the input banner identifying the active
// teammate/standalone agent and its color. The multi-agent swarm subsystem is
// not part of this build, so a solo session has no banner; returns null.
import type { Theme } from '../../utils/theme.js'

type SwarmBannerInfo = {
  text: string
  bgColor: keyof Theme
} | null

export function useSwarmBanner(): SwarmBannerInfo {
  return null
}
