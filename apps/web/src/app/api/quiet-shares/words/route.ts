import { isLocale } from "@/i18n/locales";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { quietWordsBudget, quietWordsLimiter, spendUse, structuredModel } from "@/server/model";
import { readMyWords } from "@/server/quiet-shares";

/** A few short messages of one person's own words. */
const MAX_WORDS_BYTES = 8_192;

const localeOf = (input: unknown) => {
  const value = input !== null && typeof input === "object" ? (input as Record<string, unknown>).locale : undefined;
  return typeof value === "string" && isLocale(value) ? value : "en";
};

/** One turn of a person's private conversation with their own Kin agent. Nothing it says is stored, so nothing needs revalidating. */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_WORDS_BYTES, label: "quiet-share.words", revalidate: false }, ({ viewer, circle }, input) =>
    readMyWords({ db: databases().app, userId: viewer.userId, circle }, structuredModel(), input, localeOf(input), () =>
      spendUse({ limiter: quietWordsLimiter, budget: quietWordsBudget }, { userId: viewer.userId, accountTypes: viewer.kind === "visitor" ? "demo" : viewer.session.accountTypes }, Date.now()),
    ),
  );
}
