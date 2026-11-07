import { auditLedger, decimalAmount, entryHeadline, type LedgerEntry, type LedgerProblemCode } from "@kin/domain";

import type { AuditBundle, SettlementClaim } from "./bundle.ts";
import { canonicalJson, chainHashes, genesisHash } from "./chain.ts";
import { claimSettlement } from "./bundle.ts";

export const CHECK_IDS = ["chain", "head", "ledger", "settlement", "wording"] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** One thing the verifier proved or failed to prove, with the entries that failed it. */
export type Check = {
  readonly id: CheckId;
  readonly ok: boolean;
  readonly detail: string;
  readonly entryIds: readonly string[];
  /** For the ledger check: which rule each failing entry broke. */
  readonly codes: readonly LedgerProblemCode[];
};

/** Something a careful reader would ask about. It is not a failure; the record is intact either way. */
export type Observation = {
  readonly code: "reversal" | "payout_above_usual" | "simulated_and_real";
  readonly entryId: string | null;
  /** Every figure the observation may be worded with, formatted as plain decimals. */
  readonly figures: readonly string[];
};

export type VerificationReport = {
  readonly ok: boolean;
  readonly circleId: string;
  readonly entryCount: number;
  readonly head: string;
  readonly poolCents: number;
  readonly currency: string;
  readonly checks: readonly Check[];
  readonly observations: readonly Observation[];
};

export type VerifyOptions = {
  /** A head written down earlier. The export must contain it, which proves nothing before it was changed. */
  readonly expectedHead?: string;
};

const pass = (id: CheckId, detail: string): Check => ({ id, ok: true, detail, entryIds: [], codes: [] });
const fail = (id: CheckId, detail: string, entryIds: readonly string[] = [], codes: readonly LedgerProblemCode[] = []): Check => ({ id, ok: false, detail, entryIds, codes });

function checkChain(bundle: AuditBundle): Check {
  const expected = chainHashes(bundle.circleId, bundle.entries);
  const broken = bundle.entries.filter((_, index) => bundle.hashes[index] !== expected[index]);
  if (bundle.hashes.length !== bundle.entries.length) return fail("chain", `There are ${bundle.hashes.length} hashes for ${bundle.entries.length} entries`);
  const [first] = broken;
  if (first) return fail("chain", `The chain breaks at entry ${first.id}: its content no longer matches its hash`, [first.id]);
  return pass("chain", `Every one of ${bundle.entries.length} entries matches its hash and the one before it`);
}

function checkHead(bundle: AuditBundle, options: VerifyOptions): Check {
  const head = bundle.entries.length === 0 ? genesisHash(bundle.circleId) : (chainHashes(bundle.circleId, bundle.entries).at(-1) ?? "");
  if (head !== bundle.head) return fail("head", "The head the export states is not the head of its entries");
  const { expectedHead } = options;
  if (expectedHead !== undefined && !chainHashes(bundle.circleId, bundle.entries).concat(genesisHash(bundle.circleId)).includes(expectedHead)) {
    return fail("head", "The head written down earlier is not in this export: history was changed or removed");
  }
  return pass("head", expectedHead === undefined ? `Head ${head}` : "The head written down earlier is in this export");
}

function checkLedger(bundle: AuditBundle, audit: ReturnType<typeof auditLedger>): Check {
  if (audit.problems.length > 0) {
    return fail("ledger", `${audit.problems.length} rule(s) broken: ${audit.problems.map((problem) => `${problem.code} at ${problem.entryId}`).join("; ")}`, audit.problems.map((problem) => problem.entryId), audit.problems.map((problem) => problem.code));
  }
  return pass("ledger", `Every entry balances, no cause repeats, every reversal mirrors its original and the pool never went below zero (${bundle.entries.length} entries, balances recomputed from the lines)`);
}

function checkSettlement(bundle: AuditBundle): Check {
  const wrong: string[] = [];
  for (const claim of bundle.settlements) {
    if (!sameSettlement(bundle, claim)) wrong.push(claim.period);
  }
  if (wrong.length > 0) return fail("settlement", `Recomputing ${wrong.join(", ")} from the entries gives a different plan than the export claims`);
  return pass("settlement", `${bundle.settlements.length} settlement(s) recomputed from the entries with the same code, and reproduced exactly`);
}

function sameSettlement(bundle: AuditBundle, claim: SettlementClaim): boolean {
  try {
    const again = claimSettlement(bundle.entries, bundle.circleId, bundle.currency, claim.agreement, claim.period, claim.payoutFeeCents);
    return canonicalJson(again.plan) === canonicalJson(claim.plan);
  } catch {
    return false;
  }
}

/** The figures a sentence about this entry may use: its amounts, its fee and its dates. */
export function entryFigures(entry: LedgerEntry): string[] {
  return [
    ...entryCents(entry).flatMap((each) => {
      const text = decimalAmount({ cents: each, currency: entry.currency });
      return each % 100 === 0 ? [text, text.split(".")[0] ?? text] : [text];
    }),
    entry.occurredOn,
    entry.period,
    ...entry.occurredOn.split("-").flatMap((part) => [part, String(Number(part))]),
  ];
}

/** Every amount an entry holds: its lines, and the headline's amount and fee. */
function entryCents(entry: LedgerEntry): number[] {
  const amounts = entry.lines.map((line) => line.cents);
  const headline = safeHeadline(entry);
  return headline === null ? amounts : [...amounts, headline.cents, headline.feeCents];
}

function safeHeadline(entry: LedgerEntry) {
  try {
    return entryHeadline(entry);
  } catch {
    return null;
  }
}

const NUMBER = /\d[\d.,\p{Zs}]*\d|\d/gu;
const ISO_DATE = /\d{4}-\d{2}(?:-\d{2})?/gu;
const MAX_WORDS_LENGTH = 400;

/** A number as its value, so "1,000.50", "1 000,5" and "1000.50" compare equal and "10.00" never equals "1,000". */
function valueOf(token: string): string {
  const squeezed = token.replace(/\p{Zs}/gu, "");
  const decimal = /^(.*\d)[.,](\d{1,2})$/u.exec(squeezed);
  const whole = (decimal?.[1] ?? squeezed).replace(/[.,]/gu, "").replace(/^0+(?=\d)/u, "");
  const fraction = (decimal?.[2] ?? "").replace(/0+$/u, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/**
 * Whether every number a sentence says is one the entry holds. An amount is
 * compared by its value to the entry's own cents; a date only as the entry's
 * whole date or period, or as one of their parts when it stands alone as a
 * whole number. A date part can never stand in for an amount with cents.
 */
export function wordingMatchesEntry(text: string, entry: LedgerEntry): boolean {
  if (text.trim() === "" || text.length > MAX_WORDS_LENGTH || /https?:|www\.|@/iu.test(text)) return false;
  const dates = [entry.occurredOn, entry.period];
  if ([...text.matchAll(ISO_DATE)].some((match) => !dates.includes(match[0]))) return false;
  const amounts = new Set(entryCents(entry).map((cents) => valueOf(decimalAmount({ cents, currency: entry.currency }))));
  const dateParts = new Set(dates.flatMap((date) => date.split("-").map((part) => String(Number(part)))));
  return [...text.replace(ISO_DATE, " ").matchAll(NUMBER)].every((match) => {
    const value = valueOf(match[0]);
    return amounts.has(value) || (!value.includes(".") && dateParts.has(value));
  });
}

function checkWording(bundle: AuditBundle): Check {
  const byId = new Map(bundle.entries.map((entry) => [entry.id, entry]));
  const wrong = bundle.wording.filter((each) => {
    const entry = byId.get(each.entryId);
    return entry === undefined || !wordingMatchesEntry(each.text, entry);
  });
  if (wrong.length > 0) return fail("wording", `${wrong.length} sentence(s) say a figure the entry does not hold`, wrong.map((each) => each.entryId));
  return pass("wording", `Every figure in ${bundle.wording.length} sentence(s) is one the entries hold`);
}

/** The usual size of a payee's payouts is their average so far; a payout well above it is worth a second look. */
function observe(entries: readonly LedgerEntry[]): Observation[] {
  const observations: Observation[] = [];
  const paid = new Map<string, number[]>();
  for (const entry of entries) {
    if (entry.reverses !== null) observations.push({ code: "reversal", entryId: entry.id, figures: entryFigures(entry) });
    const headline = entry.kind === "payout_confirmed" ? safeHeadline(entry) : null;
    if (headline === null) continue;
    const before = paid.get(headline.subject) ?? [];
    const sum = before.reduce((total, cents) => total + cents, 0);
    // cents above half as much again as the average so far, by integer arithmetic: cents / (sum / n) > 3 / 2
    if (before.length >= 3 && headline.cents * 2 * before.length > 3 * sum) {
      observations.push({ code: "payout_above_usual", entryId: entry.id, figures: [...entryFigures(entry), decimalAmount({ cents: Math.round(sum / before.length), currency: entry.currency })] });
    }
    paid.set(headline.subject, [...before, headline.cents]);
  }
  if (entries.some((entry) => entry.simulated) && entries.some((entry) => !entry.simulated)) {
    observations.push({ code: "simulated_and_real", entryId: null, figures: [] });
  }
  return observations;
}

/**
 * Judges an export using only plain code: the hash chain, every ledger rule
 * again, the balances from the lines, each settlement recomputed from its
 * entries and every figure in Kin's sentences. Nothing here calls the model,
 * the database, PayPal or the network.
 */
export function verifyBundle(bundle: AuditBundle, options: VerifyOptions = {}): VerificationReport {
  const audit = auditLedger(bundle.circleId, bundle.currency, bundle.entries);
  const checks = [checkChain(bundle), checkHead(bundle, options), checkLedger(bundle, audit), checkSettlement(bundle), checkWording(bundle)];
  return {
    ok: checks.every((check) => check.ok),
    circleId: bundle.circleId,
    entryCount: bundle.entries.length,
    head: bundle.head,
    poolCents: audit.poolCents,
    currency: bundle.currency,
    checks,
    observations: observe(bundle.entries),
  };
}
