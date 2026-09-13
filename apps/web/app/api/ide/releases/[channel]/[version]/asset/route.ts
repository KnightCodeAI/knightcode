import {
  type GithubRelease,
  IDE_REPOSITORY,
  installerName,
  pickInstaller,
} from "@/lib/ide-release"

// The desktop IDE's update check: crates/auto_update in the IDE repository
// asks /api/ide/releases/stable/latest/asset?asset=knightcode&os=&arch= and
// deserializes { version, url, signature }. A non-2xx answer means "no update"
// to an automatic check, so every failure here is a plain status.
const RELEASE_REVALIDATE_SECONDS = 300
// A release's signature file never changes once published.
const SIGNATURE_REVALIDATE_SECONDS = 86_400

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channel: string; version: string }> }
) {
  const { channel, version } = await params
  const query = new URL(request.url).searchParams
  const name = installerName(query.get("os"), query.get("arch"))
  // Only the stable channel ships and only the newest release is offered. The
  // IDE also asks this path for an SSH remote server, which is not built.
  if (
    channel !== "stable" ||
    version !== "latest" ||
    query.get("asset") !== "knightcode" ||
    !name
  ) {
    return new Response(null, { status: 404 })
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${IDE_REPOSITORY}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "knightcode-website",
          ...(process.env.GITHUB_TOKEN
            ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
            : {}),
        },
        next: { revalidate: RELEASE_REVALIDATE_SECONDS },
      }
    )
    // GitHub answers 404 until the first non-prerelease release exists.
    if (res.status === 404) return new Response(null, { status: 404 })
    if (!res.ok) return new Response(null, { status: 502 })

    const files = pickInstaller((await res.json()) as GithubRelease, name)
    if (!files) return new Response(null, { status: 404 })

    const signature = await fetch(files.signatureUrl, {
      next: { revalidate: SIGNATURE_REVALIDATE_SECONDS },
    })
    if (!signature.ok) return new Response(null, { status: 502 })

    return Response.json(
      {
        version: files.version,
        url: files.url,
        signature: (await signature.text()).trim(),
      },
      {
        headers: {
          "cache-control": `public, s-maxage=${RELEASE_REVALIDATE_SECONDS}, stale-while-revalidate=3600`,
        },
      }
    )
  } catch {
    return new Response(null, { status: 502 })
  }
}
