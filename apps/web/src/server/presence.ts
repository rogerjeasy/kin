import { ModelUnavailableError, readAccount, type StructuredModel } from "@kin/agent";
import { authorize, type BillingAccount } from "@kin/auth";
import {
  PresenceError,
  addTrustedVoice,
  asPerson,
  newCheckToken,
  openPresenceCheck,
  proposeHelp,
  readFamilyCodeSeed,
  readPresenceCheck,
  readPresenceChecks,
  readPresenceSummary,
  readTrustedVoices,
  reissueVoiceConfirmation,
  removeTrustedVoice,
  setVoiceAliases,
  useCodeAttempt,
  type CircleSnapshot,
  type Database,
  type PresenceCheckRecord,
  type PresenceSummary,
  type TrustedVoiceRecord,
} from "@kin/db";
import { MAX_ACCOUNT_CHARS, calendarDay, centsFromDecimal, codeReply, presenceReply, type PresenceReply, type PresenceState, type ScamMarker } from "@kin/domain";
import { isE164 } from "@kin/notify";
import { familyCode, isOfficeLocale, matchesFamilyCode, planPresenceCheck, presenceAskPreview, presenceHelpNote, presenceReplyText, type FamilyCode, type OfficeLocale, type PresenceFacts } from "@kin/telephony";

import { isLocale } from "@/i18n/locales";
import { localizedPath } from "@/i18n/routing";
import { typedAmount } from "@/lib/typed-amount";

import { spendUse, type RateLimiter } from "./model";

export type PresenceContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  /** Whose spending the model use is counted against: a demo visitor's pool or people's. */
  readonly accountTypes: BillingAccount;
  /** The app's public origin with no trailing slash: where a demo circle's stand-in link leads. */
  readonly origin: string;
  /** Claude, when this deployment has it. It only helps copy the name and amount out of the parent's words; the rules do the rest without it. */
  readonly model?: StructuredModel | null;
  readonly limiter?: RateLimiter;
  readonly budget?: RateLimiter;
  readonly now?: () => number;
};

export type PresenceFailure =
  | "refused"
  | "invalid"
  | "rate_limited"
  | "cannot_ask"
  | "duplicate"
  | "too_many_voices"
  | "above_asked"
  | "no_account"
  | "not_confirmed"
  | "above_ceiling"
  | "paused"
  | "no_agreement"
  | "in_progress"
  /** The weekly code has been put to this check's caller twice already. */
  | "no_tries"
  | "unavailable";

const fail = (reason: PresenceFailure): { readonly ok: false; readonly reason: PresenceFailure } => ({ ok: false, reason });
const object = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const onlyKeys = (row: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(row).every((key) => keys.includes(key));

function failureOf(error: unknown): PresenceFailure {
  if (!(error instanceof PresenceError)) throw error;
  return error.reason === "wrong_state" ? "invalid" : error.reason;
}

const parentNameOf = (circle: CircleSnapshot): string => circle.members.find((member) => member.role === "parent" && member.status === "active")?.displayName ?? "";

/** What the sentences for a check are filled from: the person it is about and the parent, nothing the caller said. */
function factsFor(locale: OfficeLocale, circle: CircleSnapshot, name: string | null): PresenceFacts {
  return { locale, currency: circle.circle.currency, name, parentName: parentNameOf(circle), claimedCents: null };
}

export type CheckView = {
  readonly id: string;
  readonly state: PresenceState;
  /** Whether the claimed person was found on the list. */
  readonly matched: boolean;
  readonly reply: PresenceReply;
  /** The one sentence Kin says to the parent for this state. */
  readonly replyText: string;
  readonly voiceName: string | null;
  readonly claimedName: string | null;
  readonly claimedCents: number | null;
  readonly markers: readonly ScamMarker[];
  readonly simulated: boolean;
  readonly createdAt: string;
  readonly holdUntil: string | null;
  /** How the real person answered: from the text's link, or on Kin's call. */
  readonly answeredVia: "link" | "call" | null;
  /**
   * What the family may do about help for this person: `available` when they said it was them and confirmed a PayPal
   * account, `raised` once help has been put to the family, `none` otherwise (and nothing is shown).
   */
  readonly help: "available" | "raised" | "none";
  /** The most help may be, in cents: what the caller asked for. `null` when no amount was named. */
  readonly helpMaxCents: number | null;
  /** The check ended with nobody reached or nobody on the list: the parent may put the family code to the caller. */
  readonly canCheckCode: boolean;
};

/** A stored check as the screen shows it: its state, the sentence Kin says for it, and who it asked. */
export function viewCheck(record: PresenceCheckRecord, voices: readonly TrustedVoiceRecord[], circle: CircleSnapshot, locale: OfficeLocale): CheckView {
  const voice = record.voiceId === null ? null : (voices.find((each) => each.id === record.voiceId) ?? null);
  const matched = record.voiceId !== null;
  const reply = presenceReply({ state: record.state, matched });
  return {
    id: record.id,
    state: record.state,
    matched,
    reply,
    replyText: presenceReplyText(factsFor(locale, circle, voice?.name ?? record.claimedName), reply),
    voiceName: voice?.name ?? null,
    claimedName: record.claimedName,
    claimedCents: record.claimedCents,
    markers: record.markers,
    simulated: record.simulated,
    createdAt: record.createdAt.toISOString(),
    holdUntil: record.holdUntil?.toISOString() ?? null,
    answeredVia: record.answeredVia,
    help: record.helpProposalId !== null ? "raised" : record.state === "confirmed" && voice?.accountConfirmed === true ? "available" : "none",
    helpMaxCents: record.claimedCents,
    canCheckCode: reply === "unreachable" || reply === "unknown_person",
  };
}

export type OpenedCheck = {
  readonly ok: true;
  readonly check: CheckView;
  /** Whether the model helped read the account. When it did not, the rules did, and the check is as strong. */
  readonly byModel: boolean;
  /**
   * A demo circle's check shows what the real person's phone would show, so the demo needs no real phone: the link and
   * the text. Never present for a real circle, whose link is texted to the real person and shown to nobody else.
   */
  readonly phone: { readonly link: string; readonly text: string; readonly name: string } | null;
};

/**
 * A member tells Kin what a caller who said they were family asked for. Plain
 * code reads it, matches the claimed person against the family's trusted
 * voices and scores the scam markers; the database opens the check and, for a
 * real circle, queues the text that asks the real person "is this you?". What
 * the parent said is data and is never read for instructions.
 */
export async function openPresence(context: PresenceContext, input: unknown): Promise<OpenedCheck | { readonly ok: false; readonly reason: PresenceFailure }> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "presence.check").allowed) return fail("refused");
  const row = object(input);
  if (row === null || !onlyKeys(row, ["locale", "account"]) || typeof row["locale"] !== "string" || !isLocale(row["locale"]) || typeof row["account"] !== "string") return fail("invalid");
  const account = row["account"].replace(/\s+/g, " ").trim();
  if (account === "" || account.length > MAX_ACCOUNT_CHARS) return fail("invalid");
  const locale = isOfficeLocale(row["locale"]) ? row["locale"] : "en";

  const voices = await asPerson(context.db, context.userId, (tx) => readTrustedVoices(tx, circle.circle.id));
  const now = context.now?.() ?? Date.now();
  const model = context.model ?? null;
  const mayUseModel = model !== null && spendUse({ ...(context.limiter ? { limiter: context.limiter } : {}), ...(context.budget ? { budget: context.budget } : {}) }, { userId: context.userId, accountTypes: context.accountTypes }, now);
  const plan = await planPresenceCheck({
    said: [account],
    voices: voices.filter((voice) => voice.confirmed).map((voice) => ({ id: voice.id, name: voice.name, relationship: voice.relationship, aliases: voice.aliases })),
    locale,
    currency: circle.circle.currency,
    parentName: parentNameOf(circle),
    ...(mayUseModel && model !== null
      ? {
          readAccount: async (text: string) => {
            try {
              const result = await readAccount(model, text);
              return result.kind === "fields" ? result.fields : null;
            } catch (error) {
              if (error instanceof ModelUnavailableError) return null;
              throw error;
            }
          },
        }
      : {}),
  });
  if (plan === null) return fail("invalid");

  const token = newCheckToken();
  try {
    const opened = await asPerson(context.db, context.userId, async (tx) => {
      const made = await openPresenceCheck(tx, {
        circleId: circle.circle.id,
        voiceId: plan.voiceId,
        claimedName: plan.claimedName,
        claimedRelationship: plan.claimedRelationship,
        claimedCents: plan.claimedCents,
        markers: plan.markers,
        said: plan.said,
        locale,
        token,
        alerts: plan.alerts,
      });
      const record = await readPresenceCheck(tx, circle.circle.id, made.checkId);
      return { made, record };
    });
    if (opened.record === null) return fail("unavailable");
    const check = viewCheck(opened.record, voices, circle, locale);
    const phone =
      opened.made.simulated && plan.voiceId !== null && plan.voiceName !== null
        ? (() => {
            const link = `${context.origin}${localizedPath(locale, `/v/${token}`)}`;
            return { link, name: plan.voiceName, text: presenceAskPreview({ ...factsFor(locale, circle, plan.voiceName), claimedCents: plan.claimedCents, link }) };
          })()
        : null;
    return { ok: true, check, byModel: plan.byModel, phone };
  } catch (error) {
    return fail(failureOf(error));
  }
}

/** How a check stands now, for the screen that waits on it. */
export async function presenceStatus(context: PresenceContext, input: unknown): Promise<{ readonly ok: true; readonly check: CheckView } | { readonly ok: false; readonly reason: PresenceFailure }> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "presence.check").allowed) return fail("refused");
  const row = object(input);
  const id = row?.["id"];
  if (row === null || !onlyKeys(row, ["id", "locale"]) || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof row["locale"] !== "string" || !isLocale(row["locale"])) return fail("invalid");
  const locale = isOfficeLocale(row["locale"]) ? row["locale"] : "en";
  const read = await asPerson(context.db, context.userId, async (tx) => ({ record: await readPresenceCheck(tx, circle.circle.id, id), voices: await readTrustedVoices(tx, circle.circle.id) }));
  return read.record === null ? fail("refused") : { ok: true, check: viewCheck(read.record, read.voices, circle, locale) };
}

const MAX_PHONE_CHARS = 20;
const MAX_ALIASES = 5;
const MAX_ALIAS_CHARS = 80;

/** The other spellings of a name as a clean list, or `null` when what was sent is not one. */
function aliasList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_ALIASES) return null;
  const list: string[] = [];
  for (const each of value) {
    if (typeof each !== "string") return null;
    const alias = each.replace(/\s+/g, " ").trim();
    if (alias.length > MAX_ALIAS_CHARS) return null;
    if (alias !== "" && !list.includes(alias)) list.push(alias);
  }
  return list;
}

export type VoiceAdded = { readonly ok: true; readonly id: string; readonly confirmed: boolean; readonly simulated: boolean };

/** Adds or removes a family member Kin may ask. The organizer or the parent; the database checks again. */
export async function manageVoice(context: PresenceContext, input: unknown): Promise<VoiceAdded | { readonly ok: true; readonly removed: true } | { readonly ok: false; readonly reason: PresenceFailure }> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "presence.manage").allowed) return fail("refused");
  const row = object(input);
  if (row === null) return fail("invalid");
  try {
    if (row["operation"] === "remove") {
      const id = row["id"];
      if (!onlyKeys(row, ["operation", "id"]) || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return fail("invalid");
      await asPerson(context.db, context.userId, (tx) => removeTrustedVoice(tx, circle.circle.id, id));
      return { ok: true, removed: true };
    }
    if (row["operation"] === "aliases") {
      const { id, aliases } = row;
      if (!onlyKeys(row, ["operation", "id", "aliases"]) || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return fail("invalid");
      const list = aliasList(aliases);
      if (list === null) return fail("invalid");
      await asPerson(context.db, context.userId, (tx) => setVoiceAliases(tx, circle.circle.id, id, list));
      return { ok: true, removed: true };
    }
    if (row["operation"] === "reconfirm") {
      const id = row["id"];
      if (!onlyKeys(row, ["operation", "id"]) || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return fail("invalid");
      await asPerson(context.db, context.userId, (tx) => reissueVoiceConfirmation(tx, circle.circle.id, id, newCheckToken()));
      return { ok: true, removed: true };
    }
    if (row["operation"] !== "add" || !onlyKeys(row, ["operation", "name", "relationship", "phone", "locale", "aliases"])) return fail("invalid");
    const { name, relationship, phone, locale } = row;
    const aliases = row["aliases"] === undefined ? [] : aliasList(row["aliases"]);
    if (aliases === null) return fail("invalid");
    if (typeof name !== "string" || typeof relationship !== "string" || typeof phone !== "string" || typeof locale !== "string" || !isLocale(locale)) return fail("invalid");
    // A number is a plus and digits; spaces and dashes are the person's own.
    const digits = phone.replace(/[\s().-]/g, "");
    if (digits.length > MAX_PHONE_CHARS || !isE164(digits)) return fail("invalid");
    const added = await asPerson(context.db, context.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circle.id, name: name.trim(), relationship: relationship.trim(), phone: digits, locale, token: newCheckToken(), aliases }));
    return { ok: true, ...added };
  } catch (error) {
    return fail(failureOf(error));
  }
}

export type PresenceScreen = {
  readonly voices: readonly TrustedVoiceRecord[];
  readonly checks: readonly CheckView[];
  readonly summary: PresenceSummary;
  /** This week's family code, for those who may know it. Never shown to a caregiver or an observer, and `null` for them. */
  readonly code: FamilyCode | null;
};

/** The circle's calendar day on its own clock, which the weekly code is worked out on. */
const circleDay = (circle: CircleSnapshot): string => calendarDay(circle.circle.now, circle.circle.timezone).occurredOn;

/** What the screen shows: who Kin may ask, the recent checks and what this month's add up to. Row-level security decides who reads any. */
export async function presenceScreen(context: PresenceContext, locale: OfficeLocale, period: string): Promise<PresenceScreen> {
  const { circle } = context;
  return asPerson(context.db, context.userId, async (tx) => {
    const [voices, records, summary] = await Promise.all([readTrustedVoices(tx, circle.circle.id), readPresenceChecks(tx, circle.circle.id), readPresenceSummary(tx, circle.circle.id, period)]);
    // The seed is the family's secret: the database hands it only to the organizer, a contributor and the parent.
    const mayKnow = authorize({ role: circle.viewer.role, status: "active" }, "presence.check").allowed;
    const code = mayKnow ? familyCode(await readFamilyCodeSeed(tx, circle.circle.id), circleDay(circle)) : null;
    return { voices, checks: records.map((record) => viewCheck(record, voices, circle, locale)), summary, code };
  });
}

export type CodeChecked = { readonly ok: true; readonly reply: "code_ok" | "code_wrong"; readonly replyText: string };

/**
 * The parent put the weekly family code to the caller and says what the caller answered. Plain code compares it with this
 * week's three words: a right code is not proof (Kin says so and still says to wait for the family), a wrong one is told
 * plainly. What she types is data, and is neither stored nor obeyed. Only for a check that ended without the real person.
 */
export async function checkFamilyCode(context: PresenceContext, input: unknown): Promise<CodeChecked | { readonly ok: false; readonly reason: PresenceFailure }> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "presence.check").allowed) return fail("refused");
  const row = object(input);
  const id = row?.["id"];
  const said = row?.["said"];
  if (row === null || !onlyKeys(row, ["id", "locale", "said"]) || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof said !== "string" || said.trim() === "" || said.length > 400 || typeof row["locale"] !== "string" || !isLocale(row["locale"])) return fail("invalid");
  const locale = isOfficeLocale(row["locale"]) ? row["locale"] : "en";
  // Two tries a check, counted by the database, so the code cannot be found by asking. A try is spent before it is compared.
  const read = await asPerson(context.db, context.userId, async (tx) => {
    const record = await readPresenceCheck(tx, circle.circle.id, id);
    if (record === null) return null;
    const allowed = await useCodeAttempt(tx, circle.circle.id, id);
    return { allowed, seed: allowed ? await readFamilyCodeSeed(tx, circle.circle.id) : "" };
  });
  if (read === null) return fail("refused");
  if (!read.allowed) return fail("no_tries");
  const reply = codeReply(matchesFamilyCode(said, familyCode(read.seed, circleDay(circle))));
  return { ok: true, reply, replyText: presenceReplyText(factsFor(locale, circle, null), reply) };
}

export type HelpRaised = { readonly ok: true; readonly proposalId: string };

/**
 * After "yes, it was me", puts help for that person to the family. The amount is what the family types, no more than the
 * caller asked for; the approval engine plans who must say yes, and the database refuses help for anyone who did not
 * confirm it was them, or has no confirmed PayPal account. It goes to that account and no other, whatever anyone types.
 */
export async function requestHelp(context: PresenceContext, input: unknown): Promise<HelpRaised | { readonly ok: false; readonly reason: PresenceFailure }> {
  const { circle } = context;
  if (!authorize({ role: circle.viewer.role, status: "active" }, "presence.check").allowed) return fail("refused");
  const row = object(input);
  const id = row?.["id"];
  const amount = row?.["amount"];
  if (row === null || !onlyKeys(row, ["id", "locale", "amount"]) || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof amount !== "string" || amount.length > 20 || typeof row["locale"] !== "string" || !isLocale(row["locale"])) return fail("invalid");
  const locale = isOfficeLocale(row["locale"]) ? row["locale"] : "en";
  let cents: number;
  try {
    cents = centsFromDecimal(typedAmount(amount), circle.circle.currency);
  } catch {
    return fail("invalid");
  }
  try {
    const proposalId = await asPerson(context.db, context.userId, async (tx) => {
      const record = await readPresenceCheck(tx, circle.circle.id, id);
      const voices = await readTrustedVoices(tx, circle.circle.id);
      const voice = record?.voiceId === null || record === null ? null : (voices.find((each) => each.id === record.voiceId) ?? null);
      if (record === null || voice === null) throw new PresenceError("refused");
      return proposeHelp(tx, { circleId: circle.circle.id, checkId: id, cents, note: presenceHelpNote({ locale, name: voice.name }), now: context.now === undefined ? circle.circle.now : new Date(context.now()) });
    });
    return { ok: true, proposalId };
  } catch (error) {
    return fail(failureOf(error));
  }
}
