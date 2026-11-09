import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { agencySigningKey, manageAgencyKey } from "@/server/open-kin/agency";

const MAX_BYTES = 1_024;

/** The organizer creates or revokes the key an agency's software reports visits with. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BYTES, label: "agency_keys" }, ({ viewer, circle }, input) => manageAgencyKey({ db: databases().app, userId: viewer.userId, circle, signingKey: agencySigningKey() }, input));
}
