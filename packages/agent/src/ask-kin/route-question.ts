import { numbersIn } from "../number-values.ts";
import type { AskKinToolName } from "./ask-kin-tools.ts";

/**
 * Kin's own routing of a simple question to its tools, with no model: used
 * only when Claude cannot be reached or does not answer in time. A short
 * keyword table in each of Kin's languages picks the read tools a question
 * needs; the calls then go through the same tool gateway as the model's,
 * with the same role checks, and the answer is Kin's fixed wording built
 * from what the tools found. It never guesses an amount: a demand's amount
 * and payee come from the question's own words, or the demand is not routed.
 */

/** A call Kin's own routing makes, in the form the gateway parses. */
export type RoutedCall = { readonly name: AskKinToolName; readonly input: Readonly<Record<string, string>> };

/** The names the circle's record holds, so a question's names can be found in it. */
export type KnownNames = { readonly members: readonly string[]; readonly payees: readonly string[] };

/** A question rarely needs more reads than this; more would only lengthen the fixed wording. */
const MAX_ROUTED_CALLS = 3;

type Intent = "claim" | "payout" | "fairness" | "proposals" | "refill" | "pool" | "bills" | "record" | "topUp" | "share";

/**
 * The words that mark each intent, lowercased, in English, French, German,
 * Spanish, Italian, Arabic and Hebrew. Each is matched at the start of a word,
 * so "owe" also finds "owes" and "owed", but never the middle of another word.
 */
const WORDS: Readonly<Record<Intent, readonly string[]>> = {
  claim: ["demand", "claim", "scam", "real", "legit", "genuine", "fake", "caller", "demande", "réel", "vrai", "arnaque", "forderung", "echt", "betrug", "cobro", "reclam", "estafa", "richiesta", "vera", "vero", "truffa", "مطالب", "حقيقي", "احتيال", "דריש", "אמית", "הונא"],
  payout: ["paid", "payout", "payé", "payée", "bezahlt", "pagad", "pagat", "أجر", "دفع", "תשלום", "שולם"],
  fairness: ["owe", "owed", "fair", "settle", "doit", "doivent", "schuldet", "schulden", "debe", "deben", "deve", "devono", "يدين", "مدين", "חייב"],
  proposals: ["approv", "waiting for my yes", "my yes", "a yes", "wait for a yes", "approb", "attend", "genehmig", "zustimm", "aprob", "espera", "approva", "attesa", "موافق", "אישור"],
  // Only a plain request to reorder: a question that merely names a refill ("what did the refill cost?") proposes nothing.
  refill: ["reorder", "re-order", "renouvel", "nachbestell", "volver a pedir", "riordin", "أعد طلب", "להזמין שוב"],
  pool: ["pool", "balance", "how much money", "spent", "spend", "cagnotte", "solde", "kasse", "guthaben", "fondo", "saldo", "bote", "الصندوق", "رصيد", "קופה", "יתרה"],
  bills: ["bill", "factur", "rechnung", "fattur", "فاتور", "חשבונ"],
  record: ["record", "ledger", "entries", "latest", "history", "registre", "historique", "verlauf", "registro", "historial", "cronologia", "السجل", "רישום"],
  topUp: ["top up", "top-up", "topped", "topup", "aufgeladen", "recharg", "versé", "ricaric", "شحن", "הפקד"],
  share: ["subscription", "monthly share", "abonnement", "suscripci", "abbonament", "اشتراك", "מנוי"],
};

/** The tool each intent reads, in the order the fixed wording tells them. */
const ORDER: readonly Intent[] = ["claim", "payout", "fairness", "pool", "proposals", "bills", "topUp", "share", "record", "refill"];

const lower = (text: string) => text.toLocaleLowerCase();
const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
/** A word that starts where a word starts, in any script. */
const startsWord = (text: string, word: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}`, "u").test(text);
/** A name said whole. */
const saysName = (text: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(lower(name))}(?![\\p{L}\\p{N}])`, "u").test(text);

/** The longest known name the question says, so "Northfield Gas" wins over "Gas". */
function nameIn(text: string, names: readonly string[]): string | null {
  return names.filter((name) => name.trim() !== "" && saysName(text, name)).toSorted((a, b) => b.length - a.length)[0] ?? null;
}

/** "from Harbor Gas", "von Harbor Gas", "من Harbor Gas", "מ־Harbor Gas": the capitalised words after "from" in a demand the record does not know. */
const FROM = /(?:(?<![\p{L}])(?:from|by|de|du|von|vom|da|dal|من)\s+|(?<![\p{L}])מ־)(\p{Lu}[\p{L}'’&.-]*(?:\s+\p{Lu}[\p{L}'’&.-]*){0,3})/u;

/** The amount of a demand, as the claim check reads it: plain digits with up to two decimals. */
function amountIn(question: string): string | null {
  const [first] = numbersIn(question);
  const value = first?.values[0];
  return value !== undefined && /^\d{1,9}(\.\d{1,2})?$/u.test(value) ? value : null;
}

function claimCall(question: string, known: KnownNames): RoutedCall | null {
  const amount = amountIn(question);
  if (amount === null) return null;
  const payee = nameIn(lower(question), known.payees) ?? FROM.exec(question)?.[1]?.replace(/[.?!]+$/u, "") ?? null;
  return payee === null ? null : { name: "check_claim", input: { payee: payee.slice(0, 80), amount } };
}

/**
 * The tools a question needs, as Kin's keyword table reads it, or none when
 * the question is not one it recognises. A demand for money leaves out the
 * payout and fairness reads its words would also match ("Rose owes Harbor Gas
 * $300, was it paid?"), since the claim check already reads the payee's payments.
 */
export function routeQuestion(question: string, known: KnownNames): RoutedCall[] {
  const text = lower(question);
  const wanted = new Set(ORDER.filter((intent) => WORDS[intent].some((word) => startsWord(text, word))));
  const claim = wanted.has("claim") ? claimCall(question, known) : null;
  if (claim !== null) {
    wanted.delete("payout");
    wanted.delete("fairness");
  }
  const person = nameIn(text, [...known.members, ...known.payees]);
  const calls = ORDER.filter((intent) => wanted.has(intent)).flatMap((intent): RoutedCall[] => {
    switch (intent) {
      case "claim":
        return claim === null ? [] : [claim];
      case "payout":
        return [{ name: "get_paypal_payout_status", input: person === null ? {} : { payee: person } }];
      case "fairness":
        return [{ name: "get_fairness", input: {} }];
      case "pool":
        return [{ name: "get_pool", input: {} }];
      case "proposals":
        return [{ name: "list_proposals", input: {} }];
      case "bills":
        return [{ name: "list_bills", input: {} }];
      case "topUp":
        return [{ name: "get_paypal_topup_status", input: person === null || !known.members.includes(person) ? {} : { member: person } }];
      case "share":
        return [{ name: "get_subscription_status", input: {} }];
      case "record":
        return [{ name: "get_record", input: {} }];
      case "refill":
        return [{ name: "propose_refill", input: {} }];
    }
  });
  return calls.slice(0, MAX_ROUTED_CALLS);
}
