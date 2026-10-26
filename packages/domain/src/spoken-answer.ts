/**
 * Whether a spoken reply is a yes, a no, or neither, by plain rules and
 * never by a model (AGENTS.md section 7). A yes counts only when the reply
 * is short, says yes, and says nothing that could mean no: anything else is
 * unclear, and an unclear answer changes nothing.
 */
export type SpokenAnswer = "yes" | "no" | "unclear";

/** A real answer is a few words; a longer reply is a conversation, and is asked again. */
const MAX_WORDS = 6;

const WORDS: Readonly<Record<string, { readonly yes: readonly string[]; readonly no: readonly string[] }>> = {
  en: { yes: ["yes", "yeah", "yep", "confirm", "confirmed", "submit", "approve", "approved", "correct", "agreed"], no: ["no", "nope", "not", "don't", "cancel", "stop", "wait", "change", "decline", "wrong"] },
  fr: { yes: ["oui", "ouais", "confirme", "confirmer", "valide", "valider", "approuve", "d'accord"], no: ["non", "pas", "annule", "annuler", "attends", "attendez", "stop", "refuse", "changer"] },
  de: { yes: ["ja", "jawohl", "bestätige", "bestätigen", "einverstanden", "genau", "richtig"], no: ["nein", "nicht", "abbrechen", "stopp", "warte", "warten", "ändern", "falsch"] },
  es: { yes: ["sí", "si", "confirmo", "confirmar", "vale", "apruebo", "correcto"], no: ["no", "cancela", "cancelar", "espera", "para", "cambiar", "incorrecto"] },
  it: { yes: ["sì", "si", "confermo", "confermare", "approvo", "giusto", "esatto"], no: ["no", "non", "annulla", "annullare", "aspetta", "fermo", "cambiare", "sbagliato"] },
  ar: { yes: ["نعم", "أجل", "موافق", "موافقة", "أؤكد", "تأكيد"], no: ["لا", "كلا", "إلغاء", "ألغ", "انتظر", "توقف", "غير"] },
  he: { yes: ["כן", "מאשר", "מאשרת", "אישור", "נכון", "בסדר"], no: ["לא", "בטל", "ביטול", "חכה", "עצור", "תשנה"] },
};

export function spokenAnswer(transcript: string, locale: string): SpokenAnswer {
  const words = WORDS[locale];
  if (words === undefined) return "unclear";
  const said = transcript
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{M}']+/u)
    .filter((word) => word !== "");
  if (said.length === 0 || said.length > MAX_WORDS) return "unclear";
  const no = said.some((word) => words.no.includes(word));
  const yes = said.some((word) => words.yes.includes(word));
  if (no && !yes) return "no";
  if (yes && !no) return "yes";
  return "unclear";
}
