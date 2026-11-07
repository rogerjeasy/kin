/** What the demo pharmacy sells. A stand-in for a real seller, and labelled so wherever it appears. */
export const SELLER_NAME = "Elm Street Pharmacy (Kin demo)";

export type CatalogItem = { readonly sku: string; readonly name: string; readonly priceCents: number; readonly currency: "USD" };

export const CATALOG: readonly CatalogItem[] = [
  { sku: "refill-30", name: "Monthly prescription refill (30 days)", priceCents: 6400, currency: "USD" },
  { sku: "incontinence-pack", name: "Incontinence supplies, monthly pack", priceCents: 3800, currency: "USD" },
];

/** The item an order names, by its exact name and price, or `null` if the pharmacy does not sell it so. */
export function itemOf(order: { readonly item: string; readonly cents: number; readonly currency: string }): CatalogItem | null {
  return CATALOG.find((each) => each.name === order.item && each.priceCents === order.cents && each.currency === order.currency) ?? null;
}
