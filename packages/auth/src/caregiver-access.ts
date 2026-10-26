import type { AccountType } from "./account-types.ts";
import { authorize, type Seat } from "./circle-access.ts";

export type CaregiverAction = "caregiver_rate.manage" | "caregiver_bill.submit" | "caregiver_bill.review" | "caregiver_receiver.set";
export type BillingAccount = readonly AccountType[] | "demo";

/** The account layer and circle role must independently permit the operation. */
export function caregiverAccess(seat: Seat | null, action: CaregiverAction, account: BillingAccount): boolean {
  if (!authorize(seat, action).allowed) return false;
  if (account === "demo") return true;
  const caregiverOwn = action === "caregiver_bill.submit" || action === "caregiver_receiver.set";
  const groups: readonly AccountType[] = caregiverOwn ? ["caregiver", "administrator"] : ["family_member", "professional", "administrator"];
  return groups.some((group) => account.includes(group));
}
