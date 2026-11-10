import type { ClaimVerdict } from "@kin/domain";

/** What a verdict is called on screen: the domain's three, and the one `no_match` that has its own name. */
export type ShownVerdict = ClaimVerdict | "already_paid";

/**
 * The name to show for a verdict. The domain says `no_match` both for a name
 * nobody knows and for a known payee already paid (`checkClaim`); only the
 * second has a payee, so a payee on a `no_match` is how a stored check tells
 * the two apart.
 */
export function shownVerdict(verdict: ClaimVerdict, payeeId: string | null): ShownVerdict {
  return verdict === "no_match" && payeeId !== null ? "already_paid" : verdict;
}
