/**
 * Kin's fixed wording for the two sentences the model may word about care
 * shifts, in each of Kin's seven languages. They are the fallback whenever the
 * model is not there, declines, or writes something the guard refuses, so a
 * person always reads a sentence Kin can stand behind. They are neutral about
 * a person's gender, because the model and the record never say it. The web
 * app's own dictionary holds the same question sentences, and a test keeps
 * the two the same.
 */

export const SHIFT_LANGUAGES = ["en", "fr", "de", "it", "es", "ar", "he"] as const;
export type ShiftLanguage = (typeof SHIFT_LANGUAGES)[number];

/** The English name of each language, for the model's instructions. */
export const SHIFT_LANGUAGE_NAMES: Readonly<Record<ShiftLanguage, string>> = {
  en: "English",
  fr: "French",
  de: "German",
  it: "Italian",
  es: "Spanish",
  ar: "Arabic",
  he: "Hebrew",
};

export const DAY_PARTS = ["morning", "afternoon", "evening"] as const;
export type DayPart = (typeof DAY_PARTS)[number];

/** The question put to the family about a visit: `{name}` is the caregiver's first name. */
export const QUESTION_TEMPLATES: Readonly<Record<ShiftLanguage, Readonly<Record<DayPart, string>>>> = {
  en: { morning: "Was {name} here this morning?", afternoon: "Was {name} here this afternoon?", evening: "Was {name} here this evening?" },
  fr: { morning: "La visite de {name} a-t-elle eu lieu ce matin ?", afternoon: "La visite de {name} a-t-elle eu lieu cet après-midi ?", evening: "La visite de {name} a-t-elle eu lieu ce soir ?" },
  de: { morning: "War {name} heute Morgen da?", afternoon: "War {name} heute Nachmittag da?", evening: "War {name} heute Abend da?" },
  it: { morning: "La visita di {name} c’è stata stamattina?", afternoon: "La visita di {name} c’è stata oggi pomeriggio?", evening: "La visita di {name} c’è stata stasera?" },
  es: { morning: "¿Vino {name} esta mañana?", afternoon: "¿Vino {name} esta tarde?", evening: "¿Vino {name} esta noche?" },
  ar: { morning: "هل تمّت زيارة {name} صباح اليوم؟", afternoon: "هل تمّت زيارة {name} بعد ظهر اليوم؟", evening: "هل تمّت زيارة {name} مساء اليوم؟" },
  he: { morning: "האם הביקור של {name} התקיים הבוקר?", afternoon: "האם הביקור של {name} התקיים אחר הצהריים?", evening: "האם הביקור של {name} התקיים הערב?" },
};

/** The note beside the ranked cover candidates: `{name}` is the best one, `{hours}` the time they already have booked this week. */
export const COVER_NOTE_TEMPLATES: Readonly<Record<ShiftLanguage, string>> = {
  en: "{name} is free then and has {hours} of shifts booked this week.",
  fr: "{name} est libre à ce moment-là et a déjà {hours} de visites prévues cette semaine.",
  de: "{name} hat dann Zeit und ist diese Woche schon {hours} im Einsatz.",
  it: "{name} è disponibile in quel momento e ha già {hours} di turni questa settimana.",
  es: "{name} está libre a esa hora y ya tiene {hours} de turnos esta semana.",
  ar: "لدى {name} وقت فارغ في ذلك الموعد، و{hours} من المناوبات هذا الأسبوع.",
  he: "ל{name} יש זמן פנוי במועד הזה, ו-{hours} של משמרות השבוע.",
};

/** Fills `{slot}`s. A slot with no value is left as it is, which the guard then refuses. */
export function fillSlots(template: string, values: Readonly<Record<string, string>>): string {
  return template.replaceAll(/\{(\w+)\}/gu, (whole, slot: string) => values[slot] ?? whole);
}
