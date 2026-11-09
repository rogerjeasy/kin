import type { WishTrigger } from "@kin/domain";

import type { PayeeKey, PersonaKey } from "./roses-circle.ts";

/**
 * Rose's wishes, said in September and October while she could decide, each
 * confirmed by her and witnessed by Elena and Marcus. No recording of her own
 * voice exists for the demo, so each is read aloud by Kin's voice and labelled
 * so; nothing here passes a synthetic voice off as hers. Simulated, like the
 * rest of Rose's circle, and written around the template's clock.
 */

export type SubscriptionKey = "gym" | "magazine";

/** What Rose pays each month on her own, which her wishes name. Simulated: no PayPal subscription stands behind them. */
export const PARENT_SUBSCRIPTIONS: readonly { readonly key: SubscriptionKey; readonly name: string; readonly monthlyCents: number; readonly createdAt: Date }[] = [
  { key: "gym", name: "Lakeside Fitness", monthlyCents: 3900, createdAt: new Date("2026-09-08T15:00:00Z") },
  { key: "magazine", name: "Garden Monthly", monthlyCents: 1250, createdAt: new Date("2026-09-08T15:05:00Z") },
];

export type DemoWishRule =
  | { readonly kind: "keep_paying"; readonly payee: PayeeKey }
  | { readonly kind: "pause_discretionary" }
  | { readonly kind: "suspend_subscriptions"; readonly subscriptions: readonly SubscriptionKey[] }
  | { readonly kind: "new_payee_approvals"; readonly aboveCents: number; readonly approvers: readonly PersonaKey[] };

export type DemoWish = {
  readonly quote: string;
  readonly trigger: WishTrigger;
  readonly rule: DemoWishRule;
  /** When she said it and confirmed it; Elena and Marcus witnessed it after. */
  readonly saidAt: Date;
  readonly witnessedAt: readonly [Date, Date];
};

export const WISH_WITNESSES_IN_DEMO = ["elena", "marcus"] as const satisfies readonly PersonaKey[];

export const ROSES_WISHES: readonly DemoWish[] = [
  {
    quote: "Always keep paying Amara, even if I'm in hospital.",
    trigger: "either",
    rule: { kind: "keep_paying", payee: "amara" },
    saidAt: new Date("2026-09-12T15:10:00Z"),
    witnessedAt: [new Date("2026-09-12T19:00:00Z"), new Date("2026-09-13T08:30:00Z")],
  },
  {
    quote: "If I can't decide for myself, nothing over 200 dollars to anyone new unless Elena and Marcus both agree.",
    trigger: "either",
    rule: { kind: "new_payee_approvals", aboveCents: 20000, approvers: ["elena", "marcus"] },
    saidAt: new Date("2026-09-12T15:20:00Z"),
    witnessedAt: [new Date("2026-09-12T19:05:00Z"), new Date("2026-09-13T08:35:00Z")],
  },
  {
    quote: "If I'm in hospital or a home, stop the gym and the magazine until I'm back.",
    trigger: "either",
    rule: { kind: "suspend_subscriptions", subscriptions: ["gym", "magazine"] },
    saidAt: new Date("2026-09-20T16:00:00Z"),
    witnessedAt: [new Date("2026-09-20T18:30:00Z"), new Date("2026-09-21T09:00:00Z")],
  },
  {
    quote: "While I'm away, don't buy me things. The pharmacy can wait until I'm home.",
    trigger: "either",
    rule: { kind: "pause_discretionary" },
    saidAt: new Date("2026-10-03T15:40:00Z"),
    witnessedAt: [new Date("2026-10-03T20:00:00Z"), new Date("2026-10-04T08:15:00Z")],
  },
];
