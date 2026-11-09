import { authConfig } from "@/server/auth/config";
import { mcpMetadata } from "@/server/open-kin/mcp";

/** The same document at the origin's root, for a client that looks there first. Kin's only protected resource is its MCP endpoint. */
export function GET(): Response {
  return Response.json(mcpMetadata(authConfig().webOrigin), { headers: { "cache-control": "public, max-age=3600" } });
}
