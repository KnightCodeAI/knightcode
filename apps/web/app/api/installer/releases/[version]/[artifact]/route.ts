import {
  installerPackageJson,
  parseInstallerVersion,
  validateInstallerPackageJson,
} from "@/lib/installer-lock"
import { loadInstallerLock } from "@/lib/installer-release"

// A published lock never changes. install.sh and `knightcode update` both
// request these two paths.
const IMMUTABLE = "public, max-age=31536000, immutable"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ version: string; artifact: string }> }
) {
  const { version: rawVersion, artifact } = await params
  if (artifact !== "package.json" && artifact !== "package-lock.json") {
    return new Response(null, { status: 404 })
  }
  const version = parseInstallerVersion(rawVersion)
  if (!version) return new Response(null, { status: 404 })

  const lock = await loadInstallerLock(version)
  if (!lock.ok) return new Response(null, { status: lock.status })

  if (artifact === "package-lock.json") {
    return new Response(lock.body, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": IMMUTABLE,
      },
    })
  }

  const manifest = installerPackageJson(version)
  if (validateInstallerPackageJson(manifest, version)) {
    return new Response(null, { status: 502 })
  }
  return Response.json(manifest, { headers: { "cache-control": IMMUTABLE } })
}
