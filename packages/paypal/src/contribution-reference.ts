/**
 * Which circle and member a top-up belongs to, carried on the PayPal order as
 * its `custom_id`. Kin's server sets it when it creates the order, PayPal
 * copies it onto the capture, and Kin trusts it only after reading the capture
 * back from PayPal. The payer never sees or edits it.
 */
export type ContributionReference = { readonly circleId: string; readonly memberId: string };

const VERSION = "kin1";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SHAPE = new RegExp(`^${VERSION}:(${UUID}):(${UUID})$`);

export function encodeContributionReference(reference: ContributionReference): string {
  const text = `${VERSION}:${reference.circleId}:${reference.memberId}`;
  if (!SHAPE.test(text)) throw new Error("A contribution reference needs a circle ID and a member ID");
  return text;
}

/** The reference in a `custom_id`, or `null` when it is not one of Kin's. */
export function parseContributionReference(customId: string | null): ContributionReference | null {
  const match = customId === null ? null : SHAPE.exec(customId);
  const circleId = match?.[1];
  const memberId = match?.[2];
  return circleId === undefined || memberId === undefined ? null : { circleId, memberId };
}
