import { authConfig } from "@/server/auth/config";
import { mcpMetadata } from "@/server/open-kin/mcp";
import { OPEN_CORS } from "@/server/open-kin/oauth";

/** The same document at the origin's root, for a client that looks there first. Kin's only protected resource is its MCP endpoint. */
export function GET(): Response {
  return Response.json(mcpMetadata(authConfig().webOrigin), { headers: { ...OPEN_CORS, "cache-control": "public, max-age=3600" } });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: OPEN_CORS });
}
