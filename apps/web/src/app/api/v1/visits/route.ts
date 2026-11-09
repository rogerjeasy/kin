import { databases } from "@/server/database";
import { agencySigningKey, receiveVisit } from "@/server/open-kin/agency";

/** A home-care agency's software reports one visit, signed with its key. Evidence for the family; it pays nothing. */
export async function POST(request: Request): Promise<Response> {
  try {
    return await receiveVisit(request, { db: databases().app, signingKey: agencySigningKey() });
  } catch (error) {
    console.error(JSON.stringify({ message: "agency.visit.unavailable", error: error instanceof Error ? error.name : "unknown" }));
    return Response.json({ error: "unavailable", message: "Kin could not keep the visit just now. Nothing was stored; send it again." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
