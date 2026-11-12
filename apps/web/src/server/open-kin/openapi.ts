import { ASK_KIN_TOOLS, ASK_KIN_TOOL_NAMES, MCP_SERVER_INSTRUCTIONS, MCP_SUPPORTED_VERSIONS, type JsonValue } from "@kin/agent";
import { AGENCY_SIGNATURE_WINDOW_SECONDS, DELEGATION_OAUTH_SCOPES } from "@kin/auth";
import { AGENCY_INVOICE_REFUSALS } from "@kin/db";
import { AGENCY_INVOICE_SCHEMA, AGENCY_INVOICE_STATUSES, EXECUTION_TRANSITIONS, VISIT_REPORT_SCHEMA } from "@kin/domain";

import { routes } from "@/content/site-routes";

import { MCP_METADATA_PATH, MCP_PATH } from "./mcp";

/**
 * Kin's published OpenAPI 3.1 document, built from the schemas the API itself
 * checks requests against: the visit report's and the invoice's JSON Schemas from packages/domain
 * and every MCP tool's input schema from the tool catalogue in packages/agent.
 * Nothing in it is a hand-copied shape, so the document cannot drift from
 * what the server accepts.
 */

const error = { type: "object", required: ["error", "message"], properties: { error: { type: "string" }, message: { type: "string" } } } as const;
/** A valid invoice, as the OpenAPI document shows it; the API's own test holds it to the schema the server checks. */
export const INVOICE_EXAMPLE = {
  invoiceNumber: "INV-1042",
  periodStart: "2026-11-01",
  periodEnd: "2026-11-30",
  lines: [
    { visitId: "visit-1042", minutes: 240, amountCents: 11_200, currency: "USD" },
    { visitId: "visit-1043", minutes: 180, amountCents: 8_400, currency: "USD" },
  ],
  totalCents: 19_600,
  currency: "USD",
  dueOn: "2026-12-15",
  paypalEmail: "billing@agency.example",
} as const;

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
        "Two ways in. A member's assistant speaks the Model Context Protocol at /api/mcp with a delegation token the member granted in Kin; it reads the verified record and may propose, never approve. A home-care agency's software reports visits at /api/v1/visits and sends invoices for them at /api/v1/invoices, signed with its key; a report is evidence beside the family's calendar, an invoice is a bill a person reviews, and neither pays anything by itself. Every payment waits for a person in Kin, with a fresh multi-factor check. PayPal's own tools stay behind Kin.",
      license: { name: "MIT", identifier: "MIT" },
    },
    servers: [{ url: origin }],
    externalDocs: { description: "How to connect", url: `${origin}${routes.developers}` },
    tags: [
      { name: "Agency", description: "A home-care agency's software: visits as evidence, invoices as bills a person reviews. Signed with the agency's key; nothing here pays." },
      { name: "MCP", description: "A family member's own AI assistant, under a delegation the member granted. It reads and proposes, never approves." },
    ],
    paths: {
      "/api/v1/visits": {
        post: {
          operationId: "reportVisit",
          tags: ["Agency"],
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
      "/api/v1/invoices": {
        post: {
          operationId: "submitInvoice",
          tags: ["Agency"],
          summary: "Send an invoice for visits the agency reported",
          description: `Kept as a bill on the family's Bills screen, checked against the visits the family confirmed. It pays nothing by itself: a person reviews it, and only after every yes the family's agreement asks for is it paid, through PayPal Payouts to the address the family confirms (paypalEmail starts the review). Kin adds the lines up in integer minor units and refuses a total that differs. Signed exactly like a visit: Kin-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>" with the key's secret>, within ${AGENCY_SIGNATURE_WINDOW_SECONDS} seconds of Kin's clock. Sending the same invoiceNumber and body again is idempotent.`,
          security: [{ agencyKey: [], agencySignature: [] }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AgencyInvoice" } } } },
          responses: {
            "201": response("Kept as a bill for the family to review. Nothing is paid.", { $ref: "#/components/schemas/InvoiceReceipt" }),
            "200": response("The same invoice was already kept; nothing changed.", { $ref: "#/components/schemas/InvoiceReceipt" }),
            "401": response("The key is unknown or revoked, or the signature does not match."),
            "409": response("This invoiceNumber was sent before with a different body."),
            "413": response("The body is larger than 64 KB."),
            "415": response("The body is not application/json."),
            "422": response("The body was kept as sent but refused, with why and the agency's visit IDs at fault.", { $ref: "#/components/schemas/InvoiceRefusal" }),
            "429": response("Too many invoices from this key today."),
            "503": response("Agency reporting is not switched on in this deployment."),
          },
        },
      },
      "/api/v1/invoices/{number}": {
        get: {
          operationId: "getInvoiceStatus",
          tags: ["Agency"],
          summary: "Where one of the agency's invoices stands",
          description: `received, under_review, approved, paid or declined, with PayPal's payout item status once Kin has read it back from PayPal. Nothing about the family beyond that. Signed like a POST, with the request's path in place of the body: v1=<hex HMAC-SHA256 of "<t>./api/v1/invoices/<number>">.`,
          security: [{ agencyKey: [], agencySignature: [] }],
          parameters: [{ name: "number", in: "path", required: true, description: "The agency's own invoice number, as it was sent.", example: "INV-1042", schema: AGENCY_INVOICE_SCHEMA.properties.invoiceNumber as unknown as JsonValue }],
          responses: {
            "200": response("Where the invoice stands.", { $ref: "#/components/schemas/InvoiceStatus" }),
            "401": response("The key is unknown or revoked, or the signature does not match."),
            "404": response("No invoice from this key has that number."),
            "503": response("Agency reporting is not switched on in this deployment."),
          },
        },
      },
      [MCP_PATH]: {
        post: {
          operationId: "mcp",
          tags: ["MCP"],
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
        get: { operationId: "protectedResourceMetadata", tags: ["MCP"], summary: "OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint", security: [], responses: { "200": { description: "The metadata document.", content: { "application/json": { schema: { type: "object" } } } } } },
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
        AgencyInvoice: { ...AGENCY_INVOICE_SCHEMA, examples: [INVOICE_EXAMPLE] } as unknown as JsonValue,
        InvoiceReceipt: {
          type: "object",
          description: "The invoice was kept as a bill for the family to review. It pays nothing by itself.",
          examples: [{ id: "6f1d1c52-5d0e-4c8e-9a35-2a7f0b8e6c11", status: "received", duplicate: false, note: "Kept as a bill for the family to review against the visits it confirmed." }],
          required: ["id", "status", "duplicate", "note"],
          properties: { id: { type: "string", format: "uuid" }, status: { const: "received" }, duplicate: { type: "boolean" }, note: { type: "string" } },
        },
        InvoiceRefusal: {
          type: "object",
          description: "The body was kept as sent and refused: why, and the agency's own visit IDs at fault when a line was the reason.",
          examples: [{ id: "0b6a4f1e-3c1d-4a8e-8f0a-6d2c1e9b7a55", status: "refused", reason: "unknown_visit", visits: ["visit-1043"], message: "A line names a visit this agency never reported to the circle." }],
          required: ["id", "status", "reason", "visits", "message"],
          properties: { id: { type: "string", format: "uuid" }, status: { const: "refused" }, reason: { type: "string", enum: [...AGENCY_INVOICE_REFUSALS] }, visits: { type: "array", items: { type: "string" } }, message: { type: "string" } },
        },
        InvoiceStatus: {
          type: "object",
          description: "Where an invoice stands, and nothing else about the family.",
          examples: [{ invoiceNumber: "INV-1042", status: "paid", totalCents: 19_600, currency: "USD", receivedAt: "2026-12-01T15:04:05.000Z", payout: { state: "confirmed", paypalItemStatus: "SUCCESS", simulated: false } }],
          required: ["invoiceNumber", "status", "totalCents", "currency", "receivedAt", "payout"],
          properties: {
            invoiceNumber: { type: "string" },
            status: { type: "string", enum: [...AGENCY_INVOICE_STATUSES] },
            totalCents: { type: "integer" },
            currency: { type: "string" },
            receivedAt: { type: "string", format: "date-time" },
            payout: {
              description: "null until Kin has asked PayPal to pay.",
              type: ["object", "null"],
              required: ["state", "paypalItemStatus", "simulated"],
              properties: {
                state: { type: "string", enum: Object.keys(EXECUTION_TRANSITIONS) },
                paypalItemStatus: { type: ["string", "null"], enum: ["SUCCESS", null], description: "PayPal's payout item status, named only once PayPal confirmed a real payout." },
                simulated: { type: "boolean", description: "A demo circle's payout, simulated and labelled so." },
              },
            },
          },
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
