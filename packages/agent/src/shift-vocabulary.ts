import type { ShiftLanguage } from "./shift-templates.ts";

/**
 * The capital letters the guard lets through, in one place: the guard checks
 * them and the prompt tells the model about them, so the model is never asked
 * for anything the guard would refuse.
 */

/** Capitalised words that are fine in any sentence, and the words the fixed German wording itself capitalises. */
export const ALWAYS_ALLOWED: Readonly<Record<ShiftLanguage, readonly string[]>> = {
  en: ["Kin", "I"],
  fr: ["Kin"],
  de: ["Kin", "Sie", "Ihnen", "Ihr", "Morgen", "Vormittag", "Mittag", "Nachmittag", "Abend", "Nacht", "Besuch", "Besuche", "Einsatz", "Einsätze", "Einsätzen", "Schicht", "Schichten", "Woche", "Tag", "Stunde", "Stunden", "Std", "Min", "Zeit", "Pflege", "Familie", "Termin", "Hilfe", "Dienst", "Fahrt", "Betreuung", "Betreuungsbesuch", "Betreuer", "Betreuerin", "Pflegekraft", "Pflegeeinsatz", "Pflegebesuch", "Familienmitglied", "Familienbesuch", "Mitglied", "Kalender", "Vertretung", "Ersatz", "Verfügung", "Platz"],
  it: ["Kin"],
  es: ["Kin"],
  ar: ["Kin"],
  he: ["Kin"],
};

/** Words that may open a sentence with a capital. Any other capitalised first word could be a name, so it is refused. */
export const OPENERS: Readonly<Record<ShiftLanguage, readonly string[]>> = {
  en: ["was", "is", "are", "were", "did", "has", "have", "had", "does", "do", "can", "could", "would", "will", "it", "this", "that", "there", "she", "he", "they", "no", "yes", "any", "the", "a", "an", "please", "all", "who", "when", "how", "why", "what", "next", "then", "also", "both", "either", "neither", "nobody", "everyone", "someone", "one", "free", "to", "for", "with", "as", "if", "so", "and", "but", "since", "because", "on", "at", "in", "after", "before", "despite", "while"],
  fr: ["la", "le", "les", "l", "un", "une", "est", "a", "ont", "était", "etait", "ce", "cet", "cette", "il", "elle", "ils", "elles", "oui", "non", "aucun", "aucune", "personne", "quelqu", "tout", "tous", "toute", "toutes", "pas", "peut", "peuvent", "puis", "ensuite", "libre", "qui", "quand", "comment", "pourquoi", "que", "qu", "y", "on", "et", "mais", "ou", "pour", "avec", "comme", "si", "sur", "dans", "après", "avant", "durant", "pendant", "parmi", "aussi", "chez", "à", "au", "du", "de", "des"],
  de: ["war", "waren", "ist", "sind", "hat", "haben", "hatte", "es", "das", "dies", "diese", "dieser", "dieses", "der", "die", "den", "dem", "ein", "eine", "einen", "kein", "keine", "niemand", "jemand", "alle", "beide", "dann", "danach", "frei", "wer", "wann", "wie", "warum", "was", "kann", "können", "könnte", "und", "aber", "oder", "bitte", "sie", "er", "man", "auch", "nur", "für", "mit", "als", "wenn", "da", "so", "nach", "vor", "während", "bei", "zur", "zum", "im", "am", "um", "falls", "damit", "obwohl", "weil", "ob", "ja", "nein", "hier", "dort", "heute", "morgen"],
  it: ["la", "le", "il", "lo", "l", "i", "gli", "un", "una", "è", "e", "ha", "hanno", "era", "c", "ci", "questo", "questa", "quel", "quella", "nessuno", "nessuna", "qualcuno", "tutti", "tutte", "entrambi", "poi", "dopo", "libero", "libera", "chi", "quando", "come", "perché", "che", "può", "possono", "non", "sì", "si", "lei", "lui", "loro", "anche", "solo", "per", "con", "come", "se", "su", "in", "dopo", "prima", "durante", "mentre", "tra", "fra", "a", "al", "del", "di", "da", "dal", "oggi", "ieri", "domani", "ma", "o", "e"],
  es: ["vino", "vinieron", "estuvo", "estaba", "está", "esta", "este", "esto", "ese", "esa", "es", "son", "fue", "fueron", "ha", "han", "había", "tiene", "tienen", "el", "la", "los", "las", "un", "una", "no", "sí", "nadie", "alguien", "todos", "todas", "ambos", "luego", "después", "libre", "quién", "cuándo", "cómo", "por", "qué", "puede", "pueden", "y", "pero", "o", "también", "solo", "ella", "él", "para", "con", "como", "si", "sobre", "en", "después", "antes", "durante", "mientras", "entre", "a", "al", "del", "de", "se", "lo", "le", "les", "hoy", "ayer", "mañana"],
  ar: [],
  he: [],
};

