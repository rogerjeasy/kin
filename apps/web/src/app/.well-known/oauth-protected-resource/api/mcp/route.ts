import { authConfig } from "@/server/auth/config";
import { mcpMetadata } from "@/server/open-kin/mcp";
import { OPEN_CORS } from "@/server/open-kin/oauth";

/** The protected resource metadata (RFC 9728) an MCP client finds from the 401's WWW-Authenticate header. */
export function GET(): Response {
  return Response.json(mcpMetadata(authConfig().webOrigin), { headers: { ...OPEN_CORS, "cache-control": "public, max-age=3600" } });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: OPEN_CORS });
}
