import type { OfficeLocale } from "../office-words.ts";

/**
 * The words a parent may use to answer "was she with you?", per language.
 * Written the way people say them, with accents and vowel marks; the matcher
 * normalizes both sides, so only the spelling of a word matters here, never
 * its accents.
 *
 * - `yes` and `yesPhrases` count as a yes only when the whole utterance is
 *   short and made of yes words and `filler` (see `understandAnswer`).
 * - `no` holds every word that says no or negates: a negation never leaves a
 *   yes standing.
 * - `hedges` and `hedgePhrases` say the speaker is not sure. They make the
 *   answer unclear, which is always the safe side.
 * - `elision`: whether an apostrophe joins two words ("l'ho", "n'est") or is
 *   part of one ("don't"). Languages that elide split on it.
 * - `conjunction`: a one-letter prefix that glues "and" to the next word in
 *   Arabic and Hebrew, which is looked past when matching.
 *
 * Reviewed lists, not a model: a spoken answer decides nothing but a yes or no
 * to one fixed question, and a doubtful one decides nothing at all.
 */
export type AnswerLexicon = {
  readonly yes: readonly string[];
  readonly yesPhrases: readonly string[];
  readonly no: readonly string[];
  readonly hedges: readonly string[];
  readonly hedgePhrases: readonly string[];
  readonly filler: readonly string[];
  readonly elision: "split" | "join";
  readonly conjunction: string | null;
};

const words = (text: string): readonly string[] => text.split(/\s+/).filter((each) => each !== "");

export const ANSWER_LEXICONS: Readonly<Record<OfficeLocale, AnswerLexicon>> = {
  en: {
    yes: words("yes yeah yep yup yea sure ok okay correct indeed definitely absolutely certainly affirmative aye"),
    yesPhrases: ["of course", "you bet"],
    no: words("no nope nah nay not never none nothing nobody neither nor dont didnt wasnt isnt hasnt havent arent wont cant cannot negative wrong absent"),
    hedges: words("maybe perhaps possibly probably guess suppose think thought unsure uncertain dunno"),
    hedgePhrases: ["not sure", "no idea", "dont know", "do not know", "cannot say", "cant say", "who knows"],
    filler: words("i she he they was were is here there with me us came come arrived arrive visited visit this morning afternoon evening today of course please thank thanks you very much the a it that did and all good fine oh um uh well so right again"),
    elision: "join",
    conjunction: null,
  },
  fr: {
    yes: words("oui ouais ouaip ok okay accord certes certainement absolument exact exactement correct"),
    yesPhrases: ["bien sûr", "mais oui", "tout à fait"],
    no: words("non nan nope pas ne n jamais rien aucun aucune"),
    hedges: words("probablement crois pense suppose incertain"),
    hedgePhrases: ["peut être", "pas sûr", "pas sûre", "je ne sais pas", "sais pas", "aucune idée"],
    filler: words("je j elle il ils était est été la le les l bien sûr ici avec moi nous venue venu arrivée passé passée ce cet cette matin après midi soir aujourd hui merci s vous plaît très vraiment tout a fait c ça voilà d mais"),
    elision: "split",
    conjunction: null,
  },
  de: {
    yes: words("ja jawohl jep klar genau stimmt richtig sicher natürlich ok okay"),
    yesPhrases: ["na klar", "aber ja", "auf jeden fall"],
    no: words("nein nee nö nicht kein keine keinen keiner keinem nie niemals nichts niemand weder ohne"),
    hedges: words("vielleicht wahrscheinlich glaube denke vermutlich unsicher"),
    hedgePhrases: ["nicht sicher", "weiß nicht", "keine ahnung", "ich weiß nicht"],
    filler: words("sie er war ist hier da bei mir uns mit heute morgen nachmittag abend vormittag danke bitte sehr gut das es der die den und ich wir ganz bestimmt gewesen gekommen angekommen hat besucht schon aber auf jeden fall na"),
    elision: "join",
    conjunction: null,
  },
  it: {
    yes: words("sì certo certamente esatto esattamente giusto corretto assolutamente sicuramente ok okay volentieri"),
    yesPhrases: ["va bene", "ma certo"],
    no: words("no non mai niente nulla nessuno nessuna neanche nemmeno"),
    hedges: words("forse magari probabilmente penso credo suppongo incerto boh"),
    hedgePhrases: ["non so", "non lo so", "non sono sicuro", "non sono sicura", "non sicuro", "non sicura"],
    filler: words("lei lui era è stata stato qui qua con me noi venuta venuto arrivata arrivato questa questo mattina mattino pomeriggio sera stamattina oggi grazie prego molto per favore piacere il la lo l un una che c sono ho ha ecco anche bene va tutto io mi si ma"),
    elision: "split",
    conjunction: null,
  },
  es: {
    yes: words("sí claro cierto correcto exacto efectivamente exactamente vale ok okay afirmativo"),
    yesPhrases: ["por supuesto", "desde luego", "así es", "claro que sí"],
    no: words("no nunca jamás nada nadie ninguno ninguna tampoco ni"),
    hedges: words("quizá quizás probablemente creo supongo pienso"),
    hedgePhrases: ["tal vez", "a lo mejor", "no sé", "no estoy seguro", "no estoy segura", "ni idea"],
    filler: words("ella él ellos estuvo estaba está fue ha venido vino llegó aquí ahí conmigo con nosotros esta mañana tarde noche hoy gracias por favor muy bien la el lo los las una un que y yo ya todo es así mucho supuesto luego"),
    elision: "join",
    conjunction: null,
  },
  ar: {
    yes: words("نعم ايوه أيوه ايوا ايوة ايه اجل أجل بلى طبعا طبعاً صحيح تمام اكيد أكيد بالتأكيد بالطبع موافق اوكي اوك ok okay"),
    yesPhrases: [],
    no: words("لا كلا لم لن ليس ليست لست مش مو لسه لسا ابدا"),
    hedges: words("ربما لعل اظن أظن احتمال يمكن"),
    hedgePhrases: ["لا ادري", "لا أدري", "لا اعرف", "لا أعلم", "مش متأكد", "لست متأكدا", "لست متأكدة", "لا اتذكر", "مو متأكد", "غير متأكد"],
    filler: words("هي هو هم كانت كان هنا معي معنا عندي اليوم الصباح صباح هذا هذه الظهر ظهر بعد العصر المساء مساء شكرا شكراً من فضلك في جدا ذلك زيارة الزيارة جاءت جاء حضرت حضر وصلت وصل كل شيء الان"),
    elision: "join",
    conjunction: "و",
  },
  he: {
    yes: words("כן בטח בהחלט נכון ברור אכן סבבה אוקיי אוקי"),
    yesPhrases: [],
    no: words("לא אין אל טרם אף שום"),
    hedges: words("אולי ייתכן יתכן נראה חושב חושבת מניח מניחה"),
    hedgePhrases: ["לא בטוח", "לא בטוחה", "לא יודע", "לא יודעת", "אין לי מושג", "לא זוכר", "לא זוכרת"],
    filler: words("היא הוא הם הייתה היתה היה כאן פה אצלי איתי אתנו אצלנו היום הבוקר בבוקר אחר הצהריים בצהריים הערב בערב תודה בבקשה מאוד זה אה אממ של את ביקור הביקור באה בא הגיעה הגיע ביקרה ביקר עכשיו"),
    elision: "join",
    conjunction: "ו",
  },
};
