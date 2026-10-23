import {
  DESKTOP_RELEASE_REVALIDATE_SECONDS,
  fetchDesktopReleases,
  latestDesktopRelease,
  macUpdate,
} from "@/lib/desktop-release"

// The macOS app's update check (apps/desktop/src/main/updates.ts): 200 with
// { version, url, notes, pub_date } for a newer published release that has a
// build for the Mac's architecture, 204 when it is up to date. Windows asks
// RELEASES under this path instead (./RELEASES/route.ts).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ platform: string; version: string }> }
) {
  const { platform, version } = await params
  const arch = /^darwin-(arm64|x64)$/.exec(platform)?.[1]
  if (!arch) return new Response(null, { status: 404 })

  const releases = await fetchDesktopReleases()
  if (!releases) return new Response(null, { status: 502 })
  const latest = latestDesktopRelease(releases)
  const update = latest && macUpdate(latest, version, arch)
  const cache = {
    "cache-control": `public, s-maxage=${DESKTOP_RELEASE_REVALIDATE_SECONDS}, stale-while-revalidate=3600`,
  }
  if (!update) return new Response(null, { status: 204, headers: cache })
  return Response.json(update, { headers: cache })
}
