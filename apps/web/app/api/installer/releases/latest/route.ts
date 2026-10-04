import { resolveLatestInstallerVersion } from "@/lib/installer-release"

// install.sh reads .version from this document. The version is one whose
// package-lock.json this site can serve, so a release that is on npm but not
// yet attached to its GitHub Release is not offered.
export async function GET() {
  const version = await resolveLatestInstallerVersion()
  if (!version) return new Response(null, { status: 404 })

  return Response.json(
    { schemaVersion: 1, version },
    {
      headers: {
        "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    }
  )
}
