import {
  DESKTOP_RELEASE_REVALIDATE_SECONDS,
  fetchDesktopReleases,
  latestDesktopRelease,
  squirrelReleases,
} from "@/lib/desktop-release"

// Squirrel.Windows' update check: the app's feed URL is
// /api/desktop/update/win32-x64/<version>, and Squirrel appends /RELEASES.
// The newest published release's RELEASES, pointing at its packages; Squirrel
// itself decides whether that is newer than what it runs. A missing release
// or file is a 404, which Squirrel reports as a failed check.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ platform: string; version: string }> }
) {
  const { platform } = await params
  if (platform !== "win32-x64") return new Response(null, { status: 404 })

  const releases = await fetchDesktopReleases()
  if (!releases) return new Response(null, { status: 502 })
  const latest = latestDesktopRelease(releases)
  const file = latest?.release.assets.find((asset) => asset.name === "RELEASES")
  if (!latest || !file) return new Response(null, { status: 404 })

  try {
    const res = await fetch(file.browser_download_url, {
      next: { revalidate: DESKTOP_RELEASE_REVALIDATE_SECONDS },
    })
    if (!res.ok) return new Response(null, { status: 502 })
    return new Response(squirrelReleases(await res.text(), latest.release), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": `public, s-maxage=${DESKTOP_RELEASE_REVALIDATE_SECONDS}, stale-while-revalidate=3600`,
      },
    })
  } catch {
    return new Response(null, { status: 502 })
  }
}
