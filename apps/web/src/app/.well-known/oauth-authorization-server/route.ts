import { authConfig } from "@/server/auth/config";
import { OPEN_CORS, authorizationServerMetadata } from "@/server/open-kin/oauth";

/** The authorization server metadata (RFC 8414) an MCP client reads after the protected resource metadata names Kin. */
export function GET(): Response {
  return Response.json(authorizationServerMetadata(authConfig().webOrigin), { headers: { ...OPEN_CORS, "cache-control": "public, max-age=3600" } });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: OPEN_CORS });
}
