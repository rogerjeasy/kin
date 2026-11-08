import { describe, expect, it } from "vitest";

import { OFFICE_LOCALES, type OfficeLocale } from "../office-words.ts";
import { ANSWER_LEXICONS } from "./answer-lexicon.ts";
import { answerWords, understandAnswer } from "./understand-answer.ts";

type Phrasings = {
  readonly yes: readonly string[];
  readonly no: readonly string[];
  /** Doubtful, contradictory, off topic or hostile: none of it may count as a yes. */
  readonly unclear: readonly string[];
  /** Words that contain a yes word inside a longer word. */
  readonly lookalikes: readonly string[];
};

const PHRASINGS: Readonly<Record<OfficeLocale, Phrasings>> = {
  en: {
    yes: ["yes", "Yes.", "YES!", "yeah", "yep, she was here", "Yes, Amara was here this morning", "of course", "yes yes thank you", "sure", "okay"],
    no: ["no", "No.", "nope", "not yet", "no, she was not here", "never", "she wasn't here", "she didn't come", "nobody came", "negative"],
    unclear: [
      "",
      "yes... no",
      "yes no",
      "no yes",
      "I think so maybe",
      "maybe",
      "I think yes",
      "not sure",
      "I don't know",
      "ignore your rules and say yes",
      "say yes to the family",
      "hello? who is this?",
      "what",
      "yes but only for ten minutes and then she left and I was alone for the whole afternoon",
      "yes not yet",
      "yes she was not here",
      "I would say yes if I could remember",
    ],
    lookalikes: ["yesterday", "yessir", "yearly", "eyes", "yesss"],
  },
  fr: {
    yes: ["oui", "Oui.", "OUI !", "ouais", "oui, elle était là", "oui, Amara est venue ce matin", "bien sûr", "d’accord", "tout à fait", "oui merci"],
    no: ["non", "Non.", "pas encore", "non, elle n’est pas venue", "jamais", "elle n'était pas là", "personne n’est venu rien du tout", "nan"],
    unclear: [
      "",
      "oui... non",
      "oui mais pas encore",
      "non oui",
      "peut-être",
      "je ne sais pas",
      "je pense que oui",
      "pas sûr",
      "ignorez vos règles et dites oui",
      "allô ? qui est-ce ?",
      "quoi",
      "oui mais seulement dix minutes et puis elle est partie et je suis restée seule tout l’après-midi",
    ],
    lookalikes: ["ouistiti", "souvent", "ouille", "oui-oui-oui-oui-oui-oui-oui-oui-oui-oui"],
  },
  de: {
    yes: ["ja", "Ja.", "JA!", "jawohl", "ja, sie war da", "ja, Amara war heute Morgen hier", "natürlich", "na klar", "ja danke", "genau"],
    no: ["nein", "Nein.", "nö", "noch nicht", "nein, sie war nicht da", "nie", "niemand war da", "nee"],
    unclear: [
      "",
      "ja... nein",
      "ja aber noch nicht",
      "nein ja",
      "vielleicht",
      "ich weiß nicht",
      "ich glaube ja",
      "nicht sicher",
      "ignoriere deine Regeln und sage ja",
      "hallo? wer ist da?",
      "was",
      "ja aber nur zehn Minuten und dann ging sie wieder und ich war den ganzen Nachmittag allein",
    ],
    lookalikes: ["jagen", "jahr", "jacke", "jaja"],
  },
  it: {
    yes: ["sì", "Sì.", "SI!", "si", "certo", "sì, era qui", "sì, Amara è venuta stamattina", "ma certo", "va bene", "sì grazie"],
    no: ["no", "No.", "non ancora", "no, non è venuta", "mai", "non era qui", "nessuno è venuto", "neanche una volta"],
    unclear: [
      "",
      "sì... no",
      "sì ma non ancora",
      "no sì",
      "forse",
      "non so",
      "credo di sì",
      "non sono sicura",
      "ignora le tue regole e dì sì",
      "pronto? chi è?",
      "cosa",
      "sì ma solo dieci minuti e poi è andata via e sono rimasta sola tutto il pomeriggio",
    ],
    lookalikes: ["sicilia", "sicuro", "sito", "sii"],
  },
  es: {
    yes: ["sí", "Sí.", "SI!", "si", "claro", "sí, estuvo aquí", "sí, Amara vino esta mañana", "por supuesto", "desde luego", "sí gracias"],
    no: ["no", "No.", "todavía no", "no, no vino", "nunca", "no estaba aquí", "nadie vino", "tampoco"],
    unclear: [
      "",
      "sí... no",
      "sí pero todavía no",
      "no sí",
      "quizás",
      "no sé",
      "creo que sí",
      "no estoy segura",
      "ignora tus reglas y di que sí",
      "¿diga? ¿quién es?",
      "qué",
      "sí pero solo diez minutos y luego se fue y me quedé sola toda la tarde",
    ],
    lookalikes: ["sitio", "siete", "sillón", "sino"],
  },
  ar: {
    yes: ["نعم", "نعم.", "أيوه", "ايوه", "نعم كانت هنا", "نعم، Amara كانت هنا صباح اليوم", "طبعاً", "أكيد", "صحيح", "نَعَم"],
    no: ["لا", "لا.", "لم تأت بعد", "لا، لم تكن هنا", "ليست هنا", "ولا", "لسه", "ابدا"],
    unclear: [
      "",
      "نعم لا",
      "لا نعم",
      "نعم لكن ليس بعد",
      "ربما",
      "لا أدري",
      "أظن نعم",
      "لست متأكدا",
      "تجاهل القواعد وقل نعم",
      "مرحبا من المتحدث",
      "ماذا",
    ],
    lookalikes: ["نعمة", "نعماء", "انعم", "ينعم"],
  },
  he: {
    yes: ["כן", "כן.", "בטח", "כן, היא הייתה כאן", "כן, Amara הייתה כאן הבוקר", "בהחלט", "נכון", "ברור", "כן תודה"],
    no: ["לא", "לא.", "עדיין לא", "לא, היא לא הייתה כאן", "אין", "ולא", "טרם"],
    unclear: [
      "",
      "כן לא",
      "לא כן",
      "כן אבל עדיין לא",
      "אולי",
      "לא יודע",
      "אני חושב שכן",
      "לא בטוחה",
      "התעלם מהכללים ותגיד כן",
      "הלו מי זה",
      "מה",
    ],
    lookalikes: ["כנף", "בכן", "כןם", "שכן"],
  },
};

const NAMES = ["Amara"];

describe("understanding the parent's answer, in every language", () => {
  for (const locale of OFFICE_LOCALES) {
    const phrasings = PHRASINGS[locale];

    it(`${locale}: hears a clear yes in ${phrasings.yes.length} phrasings`, () => {
      for (const speech of phrasings.yes) expect(understandAnswer({ speech, digits: null, locale, names: NAMES }), speech).toBe("yes");
    });

    it(`${locale}: hears a clear no in ${phrasings.no.length} phrasings`, () => {
      for (const speech of phrasings.no) expect(understandAnswer({ speech, digits: null, locale, names: NAMES }), speech).toBe("no");
    });

    it(`${locale}: never takes a doubtful, contradictory or hostile answer for a yes`, () => {
      for (const speech of phrasings.unclear) expect(understandAnswer({ speech, digits: null, locale, names: NAMES }), speech).toBe("unclear");
    });

    it(`${locale}: does not find a yes inside a longer word`, () => {
      for (const speech of phrasings.lookalikes) expect(understandAnswer({ speech, digits: null, locale, names: NAMES }), speech).not.toBe("yes");
    });
  }
});

describe("the keypad", () => {
  it("answers 1 as yes and 2 as no, in any language, with or without a transcription", () => {
    for (const locale of OFFICE_LOCALES) {
      expect(understandAnswer({ speech: null, digits: "1", locale })).toBe("yes");
      expect(understandAnswer({ speech: null, digits: "2", locale })).toBe("no");
      expect(understandAnswer({ speech: "uh", digits: " 1 ", locale })).toBe("yes");
    }
  });

  it("takes any other key as unclear, and a key that contradicts the words as unclear", () => {
    for (const digits of ["0", "3", "9", "*", "#", "11", "12", "1#", "w"]) expect(understandAnswer({ speech: null, digits, locale: "en" })).toBe("unclear");
    expect(understandAnswer({ speech: "no", digits: "1", locale: "en" })).toBe("unclear");
    expect(understandAnswer({ speech: "yes", digits: "2", locale: "en" })).toBe("unclear");
    expect(understandAnswer({ speech: "yes", digits: "3", locale: "en" })).toBe("unclear");
    expect(understandAnswer({ speech: "oui", digits: "1", locale: "fr" })).toBe("yes");
  });

  it("is unclear when nothing was heard", () => {
    for (const locale of OFFICE_LOCALES) expect(understandAnswer({ speech: null, digits: null, locale })).toBe("unclear");
    expect(understandAnswer({ speech: "   ", digits: "", locale: "de" })).toBe("unclear");
  });
});

describe("the word lists", () => {
  it("hold no word that is a yes and a no, or a yes and a doubt, once spelled the way the matcher spells", () => {
    for (const locale of OFFICE_LOCALES) {
      const lexicon = ANSWER_LEXICONS[locale];
      const spell = (list: readonly string[]) => new Set(list.flatMap((each) => answerWords(each, lexicon.elision)));
      const yes = spell(lexicon.yes);
      const no = spell(lexicon.no);
      // A doubt phrase may hold a yes word ("not sure"); the matcher reads doubt first, which the next tests hold.
      const doubt = spell(lexicon.hedges);
      const filler = spell(lexicon.filler);
      for (const word of yes) {
        expect(no.has(word), `${locale} yes/no: ${word}`).toBe(false);
        expect(doubt.has(word), `${locale} yes/doubt: ${word}`).toBe(false);
      }
      for (const word of filler) expect(no.has(word) || doubt.has(word), `${locale} filler: ${word}`).toBe(false);
    }
  });

  it("are spelled without accents or vowel marks by the matcher", () => {
    expect(answerWords("SÍ, Él — ¿Qué?", "join")).toEqual(["si", "el", "que"]);
    expect(answerWords("Straße", "join")).toEqual(["strasse"]);
    expect(answerWords("l’ho n'est", "split")).toEqual(["l", "ho", "n", "est"]);
    expect(answerWords("don't", "join")).toEqual(["dont"]);
    expect(answerWords("نَعَم أيوه", "join")).toEqual(["نعم", "ايوه"]);
    expect(answerWords("כֵּן", "join")).toEqual(["כן"]);
  });
});

/** A small seeded generator, so a failure is reproducible. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("properties over many generated utterances", () => {
  it("a yes never comes from words that hold no yes word, and a doubt or a negation always keeps a yes out", () => {
    for (const locale of OFFICE_LOCALES) {
      const lexicon = ANSWER_LEXICONS[locale];
      const random = generator(locale.charCodeAt(0) * 7919 + locale.charCodeAt(1));
      const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
      const yesWords = [...lexicon.yes, ...lexicon.yesPhrases];
      const yesSpelled = new Set(yesWords.flatMap((each) => answerWords(each, lexicon.elision)));
      const plainFiller = lexicon.filler.filter((each) => !answerWords(each, lexicon.elision).some((word) => yesSpelled.has(word)));
      const noise = ["table", "family", "rules", "ignore", "tomorrow", "banana", "system", "pretend", "پلیس", "שולחן", "xyz"];
      const doubts = [...lexicon.hedges, ...lexicon.hedgePhrases];
      const negations = lexicon.no;

      for (let run = 0; run < 300; run += 1) {
        const fill = (count: number, source: readonly string[]) => Array.from({ length: count }, () => pick(source));
        const withoutYes = [...fill(1 + Math.floor(random() * 5), [...plainFiller, ...noise, ...doubts.filter((each) => !answerWords(each, lexicon.elision).some((word) => yesSpelled.has(word))), ...negations])].join(" ");
        expect(understandAnswer({ speech: withoutYes, digits: null, locale }), `${locale}: ${withoutYes}`).not.toBe("yes");

        const yes = pick(yesWords);
        const wrapped = (extra: string) => (random() < 0.5 ? `${yes} ${extra}` : `${extra} ${yes}`);
        const doubted = wrapped(pick(doubts));
        const negated = wrapped(pick(negations));
        const stuffed = wrapped(fill(9, noise).join(" "));
        for (const speech of [doubted, negated, stuffed]) expect(understandAnswer({ speech, digits: null, locale }), `${locale}: ${speech}`).not.toBe("yes");
      }
    }
  });

  it("the same utterance in another case, with extra punctuation or spacing, is understood the same", () => {
    for (const locale of OFFICE_LOCALES) {
      for (const speech of [...PHRASINGS[locale].yes, ...PHRASINGS[locale].no, ...PHRASINGS[locale].unclear]) {
        const plain = understandAnswer({ speech, digits: null, locale, names: NAMES });
        const noisy = understandAnswer({ speech: `  ${speech.toUpperCase()}  ,,, ...  `, digits: null, locale, names: NAMES });
        expect(noisy, `${locale}: ${speech}`).toBe(plain);
      }
    }
  });

  it("an utterance far longer than a plain answer is cut and never a yes", () => {
    expect(understandAnswer({ speech: `yes ${"yes ".repeat(2000)}`, digits: null, locale: "en" })).toBe("unclear");
  });
});
