import { authConfig } from "@/server/auth/config";
import { mcpMetadata } from "@/server/open-kin/mcp";

/** The protected resource metadata (RFC 9728) an MCP client finds from the 401's WWW-Authenticate header. */
export function GET(): Response {
  return Response.json(mcpMetadata(authConfig().webOrigin), { headers: { "cache-control": "public, max-age=3600" } });
}
