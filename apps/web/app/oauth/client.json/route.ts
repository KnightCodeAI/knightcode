import { clientMetadataResponse } from "@/lib/oauth-client"

export function GET() {
  return clientMetadataResponse()
}
