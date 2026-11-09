import { describe, expect, it } from "vitest";

import { decideApprovals, type ApprovalVote, type PendingPlan } from "./approval-decision.ts";
import { planApprovals } from "./approval-plan.ts";
import type { CircleRole } from "./roles.ts";
import { NOW, approvalRequest, vote } from "./testing/approvals.ts";
import { forAll, type Random } from "./testing/property.ts";
import {
  SPEND_KINDS,
  TRIGGER_EVENTS,
  WISH_STATES,
  WISH_TRIGGERS,
  WishRuleError,
  checkWishDraft,
  discretionaryPause,
  wishApprovalFor,
  wishApprovalMet,
  wishEffects,
  wishHoldFor,
  wishMoveAllowed,
  witnessed,
  type ActiveTrigger,
  type InForceWish,
  type WishContext,
  type WishRule,
  type WishSignature,
} from "./wishes.ts";

const CONTEXT: WishContext = {
  members: [
    { id: "rose", role: "parent", active: true },
    { id: "elena", role: "organizer", active: true },
    { id: "marcus", role: "contributor", active: true },
    { id: "ana", role: "contributor", active: true },
    { id: "amara", role: "caregiver", active: true },
    { id: "daniel", role: "observer", active: true },
    { id: "gone", role: "contributor", active: false },
  ],
  caregiverPayeeIds: ["payee-amara"],
  subscriptionIds: ["gym", "magazine"],
};

const reason = (work: () => unknown): string => {
  try {
    work();
    return "no error";
  } catch (error) {
    return error instanceof WishRuleError ? error.reason : String(error);
  }
};

const wish = (rule: WishRule, change: Partial<InForceWish> = {}): InForceWish => ({
  id: `wish-${rule.kind}-${change.saidOn ?? "2026-09-12"}`,
  wishKey: `key-${rule.kind}`,
  version: 1,
  quote: "Her words",
  saidOn: "2026-09-12",
  trigger: "either",
  rule,
  ...change,
});

const HOSPITAL: ActiveTrigger = { id: "trigger", event: "hospital", activeAt: NOW };
const KEEP_AMARA = wish({ kind: "keep_paying", payeeId: "payee-amara" });
const PAUSE = wish({ kind: "pause_discretionary" });
const TWO = wish({ kind: "new_payee_approvals", aboveCents: 20_000, approverMemberIds: ["elena", "marcus"] });
const ROSES_WISHES = [KEEP_AMARA, PAUSE, TWO, wish({ kind: "suspend_subscriptions", subscriptionIds: ["gym", "magazine"] }, { trigger: "care_home" })];

describe("a wish drafted as a rule", () => {
  it("keeps her words clean and the rule as the record names it", () => {
    const draft = checkWishDraft({ quote: "  Always keep paying   Amara,\n even if I'm in hospital. ", trigger: "either", rule: { kind: "keep_paying", payeeId: "payee-amara" } }, CONTEXT);
    expect(draft.quote).toBe("Always keep paying Amara, even if I'm in hospital.");
    expect(draft.rule).toEqual({ kind: "keep_paying", payeeId: "payee-amara" });
  });

  it("refuses what the record cannot hold, with the reason", () => {
    const check = (rule: WishRule, quote = "Words") => reason(() => checkWishDraft({ quote, trigger: "hospital", rule }, CONTEXT));
    expect(check({ kind: "pause_discretionary" }, "")).toBe("quote");
    expect(check({ kind: "pause_discretionary" }, "x".repeat(501))).toBe("quote");
    expect(check({ kind: "pause_discretionary" }, "<b>pay me</b>")).toBe("quote");
    expect(check({ kind: "keep_paying", payeeId: "payee-gas" })).toBe("payee");
    expect(check({ kind: "suspend_subscriptions", subscriptionIds: [] })).toBe("subscriptions");
    expect(check({ kind: "suspend_subscriptions", subscriptionIds: ["gym", "gym"] })).toBe("subscriptions");
    expect(check({ kind: "suspend_subscriptions", subscriptionIds: ["netflix"] })).toBe("subscriptions");
    expect(check({ kind: "new_payee_approvals", aboveCents: 0, approverMemberIds: ["elena", "marcus"] })).toBe("amount");
    expect(check({ kind: "new_payee_approvals", aboveCents: 20.5, approverMemberIds: ["elena", "marcus"] })).toBe("amount");
    expect(check({ kind: "new_payee_approvals", aboveCents: 20_000, approverMemberIds: ["elena"] })).toBe("approvers");
    expect(check({ kind: "new_payee_approvals", aboveCents: 20_000, approverMemberIds: ["elena", "elena"] })).toBe("approvers");
    for (const other of ["rose", "amara", "daniel", "gone"]) expect(check({ kind: "new_payee_approvals", aboveCents: 20_000, approverMemberIds: ["elena", other] })).toBe("approvers");
    expect(check({ kind: "successor", memberId: "elena" })).toBe("successor");
    expect(check({ kind: "successor", memberId: "amara" })).toBe("successor");
    expect(check({ kind: "successor", memberId: "marcus" })).toBe("no error");
    expect(reason(() => checkWishDraft({ quote: "Words", trigger: "whenever" as never, rule: { kind: "pause_discretionary" } }, CONTEXT))).toBe("trigger");
    expect(check({ kind: "pay_my_nephew" } as never)).toBe("kind");
  });
});

describe("a wish's life", () => {
  it("moves only forward, and a superseded or withdrawn wish is final", () => {
    expect(wishMoveAllowed("draft", "confirmed")).toBe(true);
    expect(wishMoveAllowed("confirmed", "in_force")).toBe(true);
    expect(wishMoveAllowed("in_force", "superseded")).toBe(true);
    expect(wishMoveAllowed("draft", "in_force")).toBe(false);
    expect(wishMoveAllowed("in_force", "draft")).toBe(false);
    for (const to of WISH_STATES) {
      expect(wishMoveAllowed("superseded", to)).toBe(false);
      expect(wishMoveAllowed("withdrawn", to)).toBe(false);
    }
  });

  it("is witnessed by two family members who share the cost, never the parent, over its own digest", () => {
    const sig = (memberId: string, role: CircleRole, digest = "d1", capacity: WishSignature["capacity"] = "witness"): WishSignature => ({ memberId, role, digest, capacity });
    const target = { digest: "d1", rule: { kind: "pause_discretionary" } as WishRule };
    expect(witnessed(target, [sig("rose", "parent", "d1", "parent"), sig("elena", "organizer"), sig("marcus", "contributor")])).toBe(true);
    expect(witnessed(target, [sig("elena", "organizer"), sig("elena", "organizer")])).toBe(false);
    expect(witnessed(target, [sig("elena", "organizer"), sig("amara", "caregiver")])).toBe(false);
    expect(witnessed(target, [sig("elena", "organizer"), sig("daniel", "observer")])).toBe(false);
    expect(witnessed(target, [sig("elena", "organizer"), sig("marcus", "contributor", "d0")])).toBe(false);
    // A successor never witnesses the wish that names them.
    const succession = { digest: "d1", rule: { kind: "successor", memberId: "marcus" } as WishRule };
    expect(witnessed(succession, [sig("elena", "organizer"), sig("marcus", "contributor")])).toBe(false);
    expect(witnessed(succession, [sig("elena", "organizer"), sig("ana", "contributor")])).toBe(true);
  });
});

describe("what her wishes do while a trigger is active", () => {
  it("do nothing while nothing is active", () => {
    expect(wishEffects(ROSES_WISHES, null)).toBeNull();
    expect(discretionaryPause(null)).toEqual({ paused: false });
    expect(wishHoldFor(null, { kind: "purchase", payeeId: null })).toEqual({ held: false, protectedBy: null });
  });

  it("apply the wishes written for the event attested, and no others", () => {
    const hospital = wishEffects(ROSES_WISHES, HOSPITAL);
    expect(hospital?.keepPaying.map((each) => each.payeeId)).toEqual(["payee-amara"]);
    expect(hospital?.subscriptions).toEqual([]);
    const home = wishEffects(ROSES_WISHES, { ...HOSPITAL, event: "care_home" });
    expect(home?.subscriptions.map((each) => each.subscriptionId)).toEqual(["gym", "magazine"]);
  });

  it("keep Amara paid, cite the wish that says so, and hold the rest", () => {
    const effects = wishEffects(ROSES_WISHES, HOSPITAL);
    expect(wishHoldFor(effects, { kind: "caregiver_payout", payeeId: "payee-amara" })).toEqual({ held: false, protectedBy: KEEP_AMARA });
    expect(wishHoldFor(effects, { kind: "caregiver_payout", payeeId: "payee-other" })).toEqual({ held: true, by: PAUSE });
    expect(wishHoldFor(effects, { kind: "purchase", payeeId: "payee-pharmacy" })).toEqual({ held: true, by: PAUSE });
    expect(discretionaryPause(effects)).toEqual({ paused: true, wish: PAUSE, trigger: HOSPITAL });
  });

  it("let the latest successor she named decide", () => {
    const first = wish({ kind: "successor", memberId: "marcus" }, { saidOn: "2026-09-01" });
    const later = wish({ kind: "successor", memberId: "ana" }, { saidOn: "2026-10-01" });
    expect(wishEffects([later, first], HOSPITAL)?.successor?.memberId).toBe("ana");
  });

  it("never pause a caregiver's pay that a keep-paying wish covers, whatever else she wished", () => {
    forAll(
      (random) => ({ wishes: randomWishes(random), event: random.pick(TRIGGER_EVENTS), payee: random.pick(["payee-amara", "payee-other"] as const), kind: random.pick(SPEND_KINDS) }),
      ({ wishes, event, payee, kind }) => {
        const effects = wishEffects(wishes, { ...HOSPITAL, event });
        const hold = wishHoldFor(effects, { kind, payeeId: payee });
        const kept = wishes.some((each) => each.rule.kind === "keep_paying" && each.rule.payeeId === payee && (each.trigger === "either" || each.trigger === event));
        if (kind === "caregiver_payout" && kept) expect(hold.held).toBe(false);
        // Nothing is held unless a wish in force that applies holds it.
        const pauses = wishes.some((each) => each.rule.kind === "pause_discretionary" && (each.trigger === "either" || each.trigger === event));
        if (!pauses) expect(hold.held).toBe(false);
        expect(discretionaryPause(effects).paused).toBe(pauses);
      },
    );
  });
});

describe("a payment to someone new while her wish asks two people", () => {
  const plan = (cents: number, payeeMemberId: string | null = null): PendingPlan => {
    const made = planApprovals(approvalRequest({ cents, payee: { status: "new", member: payeeMemberId === null ? null : { memberId: payeeMemberId, role: "contributor" }, autoPay: null } }));
    if (made.outcome !== "needs_approval") throw new Error(made.outcome);
    return made;
  };
  const effects = wishEffects([TWO], HOSPITAL);

  it("applies only to a new payee above her amount", () => {
    expect(wishApprovalFor(effects, { cents: 20_000, payeeStatus: "new" })).toBeNull();
    expect(wishApprovalFor(effects, { cents: 20_001, payeeStatus: "approved" })).toBeNull();
    expect(wishApprovalFor(null, { cents: 90_000, payeeStatus: "new" })).toBeNull();
    expect(wishApprovalFor(effects, { cents: 35_000, payeeStatus: "new" })).toEqual({ memberIds: ["elena", "marcus"], wishIds: [TWO.id] });
  });

  it("waits for Elena and Marcus both, where the family's terms would have taken Elena alone", () => {
    const wishApproval = wishApprovalFor(effects, { cents: 35_000, payeeStatus: "new" });
    const decide = (votes: ApprovalVote[]) => decideApprovals({ plan: plan(35_000), votes, pausedUntil: null, now: NOW, wishApproval });
    expect(decideApprovals({ plan: plan(35_000), votes: [vote("elena", "organizer")], pausedUntil: null, now: NOW })).toBe("approved");
    expect(decide([vote("elena", "organizer")])).toBe("pending");
    expect(decide([vote("elena", "organizer"), vote("ana", "contributor")])).toBe("pending");
    expect(decide([vote("elena", "organizer"), vote("marcus", "contributor")])).toBe("approved");
    expect(decide([vote("elena", "organizer"), vote("marcus", "contributor", "reject")])).toBe("rejected");
  });

  it("can never be met by one person, or by the payee", () => {
    forAll(
      (random) => {
        const members = ["elena", "marcus", "ana", "theo"];
        const named = random.shuffle(members).slice(0, random.int(2, 4));
        const payee = random.pick([null, ...members] as [string | null, ...(string | null)[]]);
        const yeses = Array.from({ length: random.int(0, 6) }, () => random.pick(members as [string, ...string[]]));
        return { named, payee, yeses };
      },
      ({ named, payee, yeses }) => {
        const met = wishApprovalMet({ memberIds: named, wishIds: ["w"] }, yeses, payee);
        const others = new Set(yeses.filter((id) => id !== payee));
        if (others.size < 2) expect(met).toBe(false);
        if (met) {
          for (const id of named) if (id !== payee) expect(others.has(id)).toBe(true);
        }
        // The payee saying yes many times never adds a voice.
        if (payee !== null) expect(wishApprovalMet({ memberIds: named, wishIds: ["w"] }, [...yeses, payee, payee], payee)).toBe(met);
      },
    );
  });

  it("holds even when every slot the family's terms ask is filled", () => {
    forAll(
      (random) => ({ cents: random.int(20_001, 290_000), voter: random.pick(["elena", "marcus", "ana"] as const) }),
      ({ cents, voter }) => {
        const wishApproval = wishApprovalFor(effects, { cents, payeeStatus: "new" });
        const role = voter === "elena" ? "organizer" : "contributor";
        const decision = decideApprovals({ plan: plan(cents), votes: [vote(voter, role), vote("elena", "organizer")], pausedUntil: null, now: NOW, wishApproval });
        // Without Marcus's yes, it never goes.
        if (voter !== "marcus") expect(decision).not.toBe("approved");
      },
    );
  });
});

function randomWishes(random: Random): InForceWish[] {
  const rules: WishRule[] = [
    { kind: "keep_paying", payeeId: "payee-amara" },
    { kind: "keep_paying", payeeId: "payee-other" },
    { kind: "pause_discretionary" },
    { kind: "suspend_subscriptions", subscriptionIds: ["gym"] },
    { kind: "new_payee_approvals", aboveCents: random.int(1, 50_000), approverMemberIds: ["elena", "marcus"] },
    { kind: "successor", memberId: "marcus" },
  ];
  return Array.from({ length: random.int(0, 6) }, (_, index) =>
    wish(random.pick(rules as [WishRule, ...WishRule[]]), { id: `w${index}`, saidOn: `2026-0${random.int(1, 9)}-1${random.int(0, 9)}`, trigger: random.pick(WISH_TRIGGERS) }),
  );
}
