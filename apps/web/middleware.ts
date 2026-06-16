import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

export function middleware(request: NextRequest) {
  const url = request.nextUrl.clone()
  const pathname = url.pathname

  // Check if it's a request to /docs/.../*.md
  if (pathname.startsWith("/docs/") && pathname.endsWith(".md")) {
    // Extract the slug by removing '/docs/' from start and '.md' from end
    const slug = pathname.slice(6, -3)
    // Rewrite to the api route
    url.pathname = "/api/docs-raw"
    url.searchParams.set("slug", slug)
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}

// Limit the middleware to run only on /docs paths
export const config = {
  matcher: "/docs/:path*",
}
