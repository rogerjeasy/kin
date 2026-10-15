import type { Payee } from "@kin/domain";

/** Who Rose's circle pays, by the ID its ledger uses. */
export const PAYEE_IDS = ["electricity", "gas", "water", "pharmacy", "amara", "stairlift"] as const;

export type PayeeId = (typeof PAYEE_IDS)[number];

export type DemoPayee = {
  readonly category: string;
  readonly payee: Payee;
};

const approved = (autoPay: Payee["autoPay"] = null): Payee => ({ status: "approved", member: null, autoPay });

/**
 * The circle's payees. The two utilities pay themselves inside the range the
 * family expects. The stairlift company is new, so every bill from it needs a
 * person and the whole circle is told.
 */
export const demoPayees: Record<PayeeId, DemoPayee> = {
  electricity: {
    category: "utilities",
    payee: approved({ ruleId: "standing-electricity", minCents: 7000, maxCents: 10000 }),
  },
  gas: {
    category: "utilities",
    payee: approved({ ruleId: "standing-gas", minCents: 4500, maxCents: 7000 }),
  },
  water: { category: "utilities", payee: approved() },
  pharmacy: { category: "pharmacy", payee: approved() },
  amara: {
    category: "care",
    payee: { status: "approved", member: { memberId: "amara", role: "caregiver" }, autoPay: null },
  },
  stairlift: { category: "repairs", payee: { status: "new", member: null, autoPay: null } },
};
