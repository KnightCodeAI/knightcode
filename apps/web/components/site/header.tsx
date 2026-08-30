import { formatStars, getRepoStars } from "@/lib/github"
import { HeaderShell } from "./header-shell"

export async function SiteHeader() {
  const stars = await getRepoStars()
  return (
    <HeaderShell
      stars={stars != null ? formatStars(stars) : null}
      rawStars={stars}
    />
  )
}
