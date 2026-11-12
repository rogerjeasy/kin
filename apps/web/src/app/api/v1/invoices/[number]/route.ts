import { databases } from "@/server/database";
import { agencySigningKey } from "@/server/open-kin/agency";
import { invoiceStatus } from "@/server/open-kin/agency-invoices";

/** Where one of the agency's invoices stands, signed over the request's path. Nothing about the family beyond it. */
export async function GET(request: Request, { params }: RouteContext<"/api/v1/invoices/[number]">): Promise<Response> {
  try {
    const { number } = await params;
    return await invoiceStatus(request, number, { db: databases().app, signingKey: agencySigningKey() });
  } catch (error) {
    console.error(JSON.stringify({ message: "agency.invoice_status.unavailable", error: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ error: "unavailable", message: "Kin could not read the invoice just now. Ask again." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
