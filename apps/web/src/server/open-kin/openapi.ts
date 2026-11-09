import { ASK_KIN_TOOLS, ASK_KIN_TOOL_NAMES, MCP_SERVER_INSTRUCTIONS, MCP_SUPPORTED_VERSIONS, type JsonValue } from "@kin/agent";
import { AGENCY_SIGNATURE_WINDOW_SECONDS, DELEGATION_OAUTH_SCOPES } from "@kin/auth";
import { VISIT_REPORT_SCHEMA } from "@kin/domain";

import { routes } from "@/content/site-routes";

import { MCP_METADATA_PATH, MCP_PATH } from "./mcp";

/**
 * Kin's published OpenAPI 3.1 document, built from the schemas the API itself
 * checks requests against: the visit report's JSON Schema from packages/domain
 * and every MCP tool's input schema from the tool catalogue in packages/agent.
 * Nothing in it is a hand-copied shape, so the document cannot drift from
 * what the server accepts.
 */

const error = { type: "object", required: ["error", "message"], properties: { error: { type: "string" }, message: { type: "string" } } } as const;
const response = (description: string, schema: JsonValue = { $ref: "#/components/schemas/Error" }) => ({ description, content: { "application/json": { schema } } });

export function openApiDocument(origin: string): JsonValue {
  const tools = Object.fromEntries(
    ASK_KIN_TOOL_NAMES.map((name) => [name, { description: ASK_KIN_TOOLS[name].description, kind: ASK_KIN_TOOLS[name].kind, inputSchema: ASK_KIN_TOOLS[name].inputSchema as unknown as JsonValue }]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "Kin API",
      version: "1.0.0",
      summary: "Open Kin: a family member's own AI assistant and a home-care agency's software can work with a circle. None of them can approve.",
      description:
        "Two ways in. A member's assistant speaks the Model Context Protocol at /api/mcp with a delegation token the member granted in Kin; it reads the verified record and may propose, never approve. A home-care agency's software reports visits at /api/v1/visits, signed with its key; a report is evidence beside the family's calendar and pays nothing. Every payment waits for a person in Kin, with a fresh multi-factor check. PayPal's own tools stay behind Kin.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: origin }],
    externalDocs: { description: "How to connect", url: `${origin}${routes.developers}` },
    paths: {
      "/api/v1/visits": {
        post: {
          operationId: "reportVisit",
          summary: "Report one visit an aide made",
          description: `Kept as evidence beside the shift on Kin's calendar. The body is signed: Kin-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the key's secret>. A timestamp more than ${AGENCY_SIGNATURE_WINDOW_SECONDS} seconds from Kin's clock is refused. Sending the same externalId and body again is idempotent.`,
          security: [{ agencyKey: [], agencySignature: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VisitReport" } } } },
          responses: {
            "201": response("Kept, as evidence. Nothing is paid.", { $ref: "#/components/schemas/VisitReceipt" }),
            "200": response("The same visit was already kept; nothing changed.", { $ref: "#/components/schemas/VisitReceipt" }),
            "401": response("The key is unknown or revoked, or the signature does not match."),
            "409": response("This externalId was reported before with a different body."),
            "413": response("The body is larger than 16 KB."),
            "415": response("The body is not application/json."),
            "422": response("The body was kept as sent but is not a visit Kin can read."),
            "429": response("Too many visits from this key today."),
            "503": response("Agency reporting is not switched on in this deployment."),
          },
        },
      },
      [MCP_PATH]: {
        post: {
          operationId: "mcp",
          summary: "Kin's MCP server (Streamable HTTP)",
          description: `${MCP_SERVER_INSTRUCTIONS} Protocol versions: ${MCP_SUPPORTED_VERSIONS.join(", ")}. One JSON-RPC message per POST, answered with application/json; no session is minted. The tools and their input schemas are listed under x-kin-mcp-tools; tools/list returns only those the member's role and the delegation's scope allow.`,
          security: [{ delegationToken: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcRequest" } } } },
          responses: {
            "200": { description: "A JSON-RPC response.", content: { "application/json": { schema: { type: "object" } } } },
            "202": { description: "A notification was accepted." },
            "400": { description: "A JSON-RPC error: malformed, header mismatch, unsupported version, or an unknown tool such as any that would approve." },
            "401": { description: "No delegation token, or one that is unknown, expired or revoked. The WWW-Authenticate header points at the protected resource metadata." },
            "403": { description: "A browser on another origin." },
            "405": { description: "Only POST is served." },
            "429": { description: "Too many requests for this delegation." },
          },
        },
      },
      [MCP_METADATA_PATH]: {
        get: { operationId: "protectedResourceMetadata", summary: "OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint", security: [], responses: { "200": { description: "The metadata document.", content: { "application/json": { schema: { type: "object" } } } } } },
      },
    },
    components: {
      securitySchemes: {
        delegationToken: { type: "http", scheme: "bearer", description: `A delegation token a member granted in Kin (Connected assistants). Scopes: ${DELEGATION_OAUTH_SCOPES.read} (read the record) or ${DELEGATION_OAUTH_SCOPES.propose} (also raise a proposal that waits for the family). No scope approves.` },
        agencyKey: { type: "apiKey", in: "header", name: "Kin-Agency-Key", description: "The agency key's public ID, agk_…, created by the circle's organizer." },
        agencySignature: { type: "apiKey", in: "header", name: "Kin-Signature", description: "t=<unix seconds>,v1=<hex HMAC-SHA256(secret, \"<t>.<raw body>\")>." },
      },
      schemas: {
        VisitReport: VISIT_REPORT_SCHEMA as unknown as JsonValue,
        VisitReceipt: {
          type: "object",
          required: ["id", "status", "duplicate", "caregiverMatched", "note"],
          properties: { id: { type: "string", format: "uuid" }, status: { const: "received" }, duplicate: { type: "boolean" }, caregiverMatched: { type: "boolean" }, note: { type: "string" } },
        },
        JsonRpcRequest: {
          type: "object",
          required: ["jsonrpc", "method"],
          properties: { jsonrpc: { const: "2.0" }, id: { type: ["string", "integer"] }, method: { type: "string", enum: ["initialize", "notifications/initialized", "server/discover", "ping", "tools/list", "tools/call"] }, params: { type: "object" } },
        },
        Error: error as unknown as JsonValue,
      },
    },
    "x-kin-mcp-tools": tools,
  };
}
