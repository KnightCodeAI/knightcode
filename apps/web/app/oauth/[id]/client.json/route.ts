import { clientMetadataResponse, isCallbackId } from "@/lib/oauth-client"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!isCallbackId(id)) return new Response(null, { status: 404 })
  return clientMetadataResponse(id)
}
