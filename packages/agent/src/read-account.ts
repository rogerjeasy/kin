import { MAX_ACCOUNT_CHARS, cleanAccountFields, type AccountFields } from "@kin/domain";

import { ACCOUNT_SCHEMA, accountSystemPrompt, accountUserMessage } from "./account-prompt.ts";
import { ModelUnavailableError, type StructuredModel } from "./structured-model.ts";

export type ReadAccountResult =
  | {
      readonly kind: "fields";
      readonly fields: AccountFields;
      /** Values the model gave that are not in the parent's words, and so were dropped. */
      readonly dropped: number;
    }
  | { readonly kind: "refused" }
  | { readonly kind: "unreadable" };

const normalize = (text: string): string => text.normalize("NFC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/**
 * Reads a parent's account of a pressured call into a name, a relationship and
 * an amount, and nothing else. The model only proposes: each value must be
 * found in the parent's own words or it is dropped, so a name the caller never
 * said cannot reach the check, and a scammer's "ignore your rules" is just text.
 * The scam markers, the match against the family and every decision are made by
 * plain code afterwards. When the model is unavailable the caller falls back to
 * `readAccountByRules`, so the check never depends on it.
 */
export async function readAccount(model: StructuredModel, account: string): Promise<ReadAccountResult> {
  const text = account.trim();
  if (text === "" || text.length > MAX_ACCOUNT_CHARS) return { kind: "unreadable" };
  const reply = await model({ system: accountSystemPrompt(), user: accountUserMessage(text), schema: ACCOUNT_SCHEMA });
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
  const words = normalize(text);
  let dropped = 0;
  const grounded = (field: unknown): string | null => {
    if (typeof field !== "string" || field.trim() === "") return null;
    if (words.includes(normalize(field))) return field;
    dropped += 1;
    return null;
  };
  const fields = cleanAccountFields({ claimedName: grounded(row["claimedName"]), claimedRelationship: grounded(row["claimedRelationship"]), amountText: grounded(row["amountText"]) });
  return { kind: "fields", fields, dropped };
}
