import { authConfig } from "@/server/auth/config";
import { openApiDocument } from "@/server/open-kin/openapi";

/** Kin's OpenAPI 3.1 document, built from the schemas the API checks requests against. */
export function GET(): Response {
  return Response.json(openApiDocument(authConfig().webOrigin), { headers: { "cache-control": "public, max-age=600", "access-control-allow-origin": "*" } });
}
