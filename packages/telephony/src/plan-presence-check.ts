import {
  MAX_ACCOUNT_CHARS,
  accountCents,
  cleanAccountFields,
  matchTrustedVoice,
  readAccountByRules,
  scamMarkers,
  type AccountFields,
  type ScamMarker,
  type TrustedVoice,
} from "@kin/domain";

import type { OfficeLocale } from "./office-words.ts";
import { presenceAlertTexts, type PresenceAlertTexts } from "./presence-words.ts";

/** Reads the parent's words into fields with a model, or returns `null` when it cannot. The caller supplies it; this package never reaches a model. */
export type AccountReader = (account: string) => Promise<AccountFields | null>;

export type PresenceCheckPlan = {
  /** The trusted person to ask, or `null` when the claim matches nobody on the list. */
  readonly voiceId: string | null;
  readonly voiceName: string | null;
  readonly claimedName: string | null;
  readonly claimedRelationship: string | null;
  readonly claimedCents: number | null;
  readonly markers: readonly ScamMarker[];
  /** What the parent said, trimmed and bounded. */
  readonly said: readonly string[];
  readonly alerts: PresenceAlertTexts;
  /** Whether the model helped read the account. When it did not, rules alone did, and the check is no weaker for it. */
  readonly byModel: boolean;
};

export type PlanInput = {
  /** What the parent said, one entry per thing said. Untrusted: it is data, never read for instructions. */
  readonly said: readonly string[];
  readonly voices: readonly TrustedVoice[];
  readonly locale: OfficeLocale;
  readonly currency: string;
  readonly parentName: string;
  readonly readAccount?: AccountReader;
};

const MAX_TURNS = 12;
const MAX_TURN_CHARS = 1_200;

/** The account as bounded lines, or `null` when there is nothing to read. */
export function cleanAccount(said: readonly string[]): string[] | null {
  const lines = said.map((line) => line.replace(/\s+/g, " ").trim().slice(0, MAX_TURN_CHARS)).filter((line) => line !== "").slice(0, MAX_TURNS);
  if (lines.length === 0) return null;
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    if (used + line.length > MAX_ACCOUNT_CHARS) break;
    kept.push(line);
    used += line.length;
  }
  return kept.length === 0 ? [(lines[0] ?? "").slice(0, MAX_ACCOUNT_CHARS)] : kept;
}

/**
 * Turns what the parent said into everything a check records, with plain code
 * deciding every part: the scam markers are rules, the person is matched against
 * the trusted list by name and relationship, the amount is read from digits or
 * number words, and the family's alerts are fixed sentences filled from the
 * record. The model, when there is one, only helps copy the name, relationship
 * and amount out of the words; where rules found a trusted person's name in
 * them, that name wins. A model that is down changes nothing about the verdict.
 */
export async function planPresenceCheck(input: PlanInput): Promise<PresenceCheckPlan | null> {
  const said = cleanAccount(input.said);
  if (said === null) return null;
  const byRules = readAccountByRules(said, input.voices);
  let modelFields: AccountFields | null = null;
  if (input.readAccount !== undefined) {
    try {
      modelFields = await input.readAccount(said.join(" "));
    } catch {
      // A model that cannot be reached must never stop a check: the rules read the account just the same.
      modelFields = null;
    }
  }
  const fields = cleanAccountFields({
    claimedName: byRules.claimedName ?? modelFields?.claimedName ?? null,
    claimedRelationship: modelFields?.claimedRelationship ?? byRules.claimedRelationship,
    amountText: modelFields?.amountText ?? byRules.amountText,
  });
  const match = matchTrustedVoice(fields, input.voices);
  const voice = match.kind === "matched" ? match.voice : null;
  const cents = accountCents(fields.amountText, input.currency, input.locale) ?? accountCents(byRules.amountText, input.currency, input.locale);
  const name = voice?.name ?? fields.claimedName;
  return {
    voiceId: voice?.id ?? null,
    voiceName: voice?.name ?? null,
    claimedName: fields.claimedName,
    claimedRelationship: fields.claimedRelationship,
    claimedCents: cents,
    markers: scamMarkers(said),
    said,
    alerts: presenceAlertTexts({ locale: input.locale, currency: input.currency, name, parentName: input.parentName, claimedCents: cents }),
    byModel: modelFields !== null,
  };
}
