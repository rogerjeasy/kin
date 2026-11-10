import { MAX_PURSE_MEMO_CHARS, MAX_PURSE_WORDS_CHARS, PURSE_ROUTES, type PurseRoute } from "@kin/domain";

import { GIFT_SCHEMA, giftSystemPrompt, giftUserMessage } from "./gift-prompt.ts";
import { ModelUnavailableError, type StructuredModel } from "./structured-model.ts";

/** The facts of one payment she asked for, each copied from her own words. */
export type GiftFields = {
  readonly payeeName: string | null;
  readonly relationship: string | null;
  readonly amountText: string | null;
  readonly memo: string | null;
  readonly route: PurseRoute;
};

export type ReadGiftResult =
  | {
      readonly kind: "fields";
      readonly fields: GiftFields;
      /** Values the model gave that are not in her words, and so were dropped. */
      readonly dropped: number;
    }
  | { readonly kind: "refused" }
  | { readonly kind: "unreadable" };

const normalize = (text: string): string => text.normalize("NFC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

const isRoute = (value: unknown): value is PurseRoute => typeof value === "string" && (PURSE_ROUTES as readonly string[]).includes(value);

/**
 * Reads what the parent asked to send from her Purse into a payee, an amount,
 * a memo and the way she wants to pay. The model only proposes: each copied
 * value must be found in her words or it is dropped, so a payee or an amount
 * she never said cannot reach the payment, and "ignore your rules" is just
 * text. The address book, the amount and every decision are plain code
 * afterwards. When the model is unavailable the caller reads her words by
 * rules alone, so the Purse never depends on it.
 */
export async function readGift(model: StructuredModel, words: string): Promise<ReadGiftResult> {
  const text = words.trim();
  if (text === "" || text.length > MAX_PURSE_WORDS_CHARS) return { kind: "unreadable" };
  const reply = await model({ system: giftSystemPrompt(), user: giftUserMessage(text), schema: GIFT_SCHEMA });
  if (reply.kind === "refused") return { kind: "refused" };
  if (reply.kind === "cut_off") return { kind: "unreadable" };
  let value: unknown;
  try {
    value = JSON.parse(reply.text);
  } catch (error) {
    throw new ModelUnavailableError("The model's answer was not JSON", { cause: error, kind: "unusable" });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ModelUnavailableError("The model's answer did not follow the schema", { kind: "unusable" });
  }
  const row = value as Record<string, unknown>;
  const said = normalize(text);
  let dropped = 0;
  const grounded = (field: unknown, max = 80): string | null => {
    if (typeof field !== "string" || field.trim() === "") return null;
    if (field.length <= max && said.includes(normalize(field))) return field.trim();
    dropped += 1;
    return null;
  };
  const route = isRoute(row["route"]) ? row["route"] : "unknown";
  return {
    kind: "fields",
    fields: { payeeName: grounded(row["payeeName"]), relationship: grounded(row["relationship"]), amountText: grounded(row["amountText"], 40), memo: grounded(row["memo"], MAX_PURSE_MEMO_CHARS), route },
    dropped,
  };
}
