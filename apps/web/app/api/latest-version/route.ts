import { NPM_PACKAGE } from "@/lib/site"
import { getNpmLatestVersion } from "@/lib/version"

// Update source of truth for packages/cli/src/utils/version-check.ts, which
// backs both the "new version" banner and `knightcode update --self`. The
// registry, not the changelog: the update installs `<packageName>@<version>`
// from npm, so a version npm does not serve yet would fail the install.
export async function GET() {
  const version = await getNpmLatestVersion()
  // A non-2xx means "latest version unknown" to the client, which then keeps
  // the version it has instead of reporting a downgrade. Do not cache that.
  if (!version) return new Response(null, { status: 502 })

  // packageName lets a future package rename migrate installs: the client
  // reinstalls under the returned name when it differs from its own.
  return Response.json(
    { version, packageName: NPM_PACKAGE },
    {
      headers: {
        "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    }
  )
}
