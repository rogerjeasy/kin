/** What the agreement form holds while it is being written: text, as typed. */
export type Draft = {
  readonly shares: Readonly<Record<string, string>>;
  readonly careOn: boolean;
  readonly careRate: string;
  readonly careCash: boolean;
  readonly parent: string;
  readonly second: string;
  readonly ceiling: string;
  readonly effectiveOn: string;
};

/** The draft as the server reads it. Nothing is computed here. */
export function draftRequest(draft: Draft, memberIds: readonly string[]) {
  return {
    shares: memberIds.filter((id) => (draft.shares[id] ?? "").trim() !== "").map((memberId) => ({ memberId, percent: draft.shares[memberId] ?? "" })),
    care: draft.careOn ? { rate: draft.careRate, paidInCash: draft.careCash } : null,
    approvals: { ceiling: draft.ceiling, second: draft.second, parent: draft.parent },
    effectiveOn: draft.effectiveOn,
  };
}
