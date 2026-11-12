import { agentToolkit } from "@/server/agent-toolkit";
import { paypalReader } from "@/server/ask-kin/world";
import { authConfig } from "@/server/auth/config";
import { databases } from "@/server/database";
import { serveMcp } from "@/server/open-kin/mcp";
import { topUpServices } from "@/server/paypal";

/**
 * Kin's MCP server: a member's own assistant, under the delegation they
 * granted. The protocol and its boundary are in packages/agent; the wiring is
 * in server/open-kin/mcp.ts. Every method is answered there, so a GET or a
 * DELETE gets the transport's own 405.
 */
function serve(request: Request): Promise<Response> {
  const services = topUpServices();
  return serveMcp(request, { db: databases().app, origin: authConfig().webOrigin, paypal: services === null ? null : paypalReader(services.pool, agentToolkit()) });
}

export const POST = serve;
export const GET = serve;
export const DELETE = serve;
export const PUT = serve;
export const PATCH = serve;
