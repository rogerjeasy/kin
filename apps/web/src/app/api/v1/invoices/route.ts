import { databases } from "@/server/database";
import { agencySigningKey } from "@/server/open-kin/agency";
import { receiveInvoice } from "@/server/open-kin/agency-invoices";

/** A home-care agency's software sends one invoice, signed with its key. It becomes a bill for the family to review; it pays nothing by itself. */
export async function POST(request: Request): Promise<Response> {
  try {
    return await receiveInvoice(request, { db: databases().app, signingKey: agencySigningKey() });
  } catch (error) {
    console.error(JSON.stringify({ message: "agency.invoice.unavailable", error: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ error: "unavailable", message: "Kin could not keep the invoice just now. Nothing was stored; send it again." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
