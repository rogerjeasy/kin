/**
 * The lines a person pastes to connect an assistant or an agency, built from
 * the endpoint and the credential. One place, so the screen that shows a new
 * token and the developer page show the same commands.
 */

/** Claude Code's command for a remote MCP server over Streamable HTTP, with the token as a header. */
export const claudeCodeCommand = (endpoint: string, token: string) => `claude mcp add --transport http kin ${endpoint} --header "Authorization: Bearer ${token}"`;

/** Claude Code's command with no token: it finds Kin's authorization server from the 401 and opens the consent screen in the browser. */
export const claudeCodeOAuthCommand = (endpoint: string) => `claude mcp add --transport http kin ${endpoint}`;

/** The `.mcp.json` shape Claude Code and clients that share it read. */
export const mcpJsonConfig = (endpoint: string, token: string) =>
  JSON.stringify({ mcpServers: { kin: { type: "http", url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);

/** Lists the tools with curl, in the stateless 2026-07-28 revision. */
export const curlToolsList = (endpoint: string, token: string) =>
  [
    `curl -s ${endpoint} \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\`,
    `  -H "MCP-Protocol-Version: 2026-07-28" -H "Mcp-Method: tools/list" \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'`,
  ].join("\n");

/** Signs and sends one visit, with openssl and curl. */
export const curlVisit = (origin: string, keyId: string, secret: string, caregiver: string) =>
  [
    `BODY='{"externalId":"visit-1042","caregiver":${JSON.stringify(caregiver).replaceAll("'", "'\\''")},"kind":"aide","startsAt":"2026-11-09T09:00:00-05:00","endsAt":"2026-11-09T13:00:00-05:00","checkedInAt":"2026-11-09T09:02:00-05:00","checkedOutAt":"2026-11-09T13:00:00-05:00"}'`,
    `T=$(date +%s)`,
    `SIG=$(printf '%s.%s' "$T" "$BODY" | openssl dgst -sha256 -hmac '${secret}' | sed 's/^.* //')`,
    `curl -s ${origin}/api/v1/visits \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -H "Kin-Agency-Key: ${keyId}" \\`,
    `  -H "Kin-Signature: t=$T,v1=$SIG" \\`,
    `  -d "$BODY"`,
  ].join("\n");
