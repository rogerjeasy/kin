import { createHmac } from "node:crypto";

/**
 * The weekly family code: three plain words that change every week without anyone choosing them. Real family know it
 * (it is on the family's screen and nowhere else) and a cloned voice cannot, so asking a caller for it is a check no
 * recording can pass. It is worked out from a secret seed that only the circle's family and Kin's own service can read,
 * and the calendar week on the circle's own clock, so the screen, the phone line and a test all give the same three
 * words. Plain code: no model reads, makes or checks it.
 */

/** Short, everyday, easy to say and to hear, and unlike one another. English for every language: they are said aloud and typed. */
export const FAMILY_CODE_WORDS: readonly string[] = [
  "apple", "arrow", "autumn", "badge", "baker", "banjo", "beach", "berry", "bicycle", "blanket", "boat", "bonnet", "branch", "bridge", "brook", "bucket",
  "butter", "button", "cabin", "candle", "canoe", "carpet", "castle", "cedar", "chair", "cherry", "chimney", "cider", "circle", "clover", "cobble", "cocoa",
  "copper", "cottage", "cotton", "cradle", "crayon", "daisy", "dancer", "dawn", "desert", "diner", "dolphin", "donkey", "dragon", "drum", "eagle", "ember",
  "engine", "fabric", "falcon", "farm", "feather", "fiddle", "field", "finch", "flame", "flute", "forest", "fountain", "garden", "ginger", "glacier", "goose",
  "grape", "guitar", "hammer", "harbor", "harvest", "hazel", "heron", "hill", "honey", "horizon", "island", "ivory", "jacket", "jasmine", "jelly", "jungle",
  "kettle", "kitchen", "kitten", "ladder", "lagoon", "lantern", "lemon", "library", "lily", "linen", "lobster", "lunch", "magnet", "mango", "maple", "market",
  "meadow", "melon", "mirror", "mitten", "monkey", "moon", "mountain", "muffin", "napkin", "needle", "nickel", "noodle", "nutmeg", "oasis", "ocean", "olive",
  "onion", "orange", "orchard", "otter", "oven", "paddle", "palace", "pantry", "parade", "parrot", "peach", "pebble", "pepper", "piano", "pillow", "pine",
  "planet", "plum", "pocket", "pond", "poppy", "pumpkin", "puzzle", "quilt", "rabbit", "rainbow", "ribbon", "river", "robin", "rocket", "saddle", "sailor",
  "salad", "sandal", "scarf", "season", "shadow", "shell", "silver", "sketch", "slipper", "soup", "spoon", "spring", "squirrel", "stable", "star", "stone",
  "storm", "sugar", "summer", "sunrise", "swan", "table", "teapot", "thimble", "thunder", "ticket", "timber", "tomato", "tower", "train", "tulip", "tunnel",
  "turtle", "umbrella", "valley", "velvet", "village", "violet", "walnut", "wagon", "waterfall", "whistle", "willow", "window", "winter", "wizard", "wool", "yellow",
  "zebra", "anchor", "basket", "biscuit", "bubble", "cactus", "camel", "carrot", "cheese", "clock", "cloud", "coffee", "cookie", "crown", "diamond", "feast",
  "flower", "ghost", "grass", "heart", "jewel", "kangaroo", "lamp", "marble", "noble", "pearl", "pirate", "queen", "radio", "spider", "toast", "violin",
  "acorn", "amber", "bamboo", "barley", "beetle", "birch", "bison", "bloom", "breeze", "candy", "canyon", "clay", "coral", "crystal", "dune", "fern",
  "flint", "frost", "gravel", "hedge", "iris", "juniper", "lilac", "lotus", "mist", "moss", "oak", "opal", "orbit", "plain", "prairie", "quartz",
  "reef", "sage", "sand", "thistle", "tide", "vine", "wheat", "zephyr",
];

export type FamilyCode = {
  /** The three words, in order. */
  readonly words: readonly [string, string, string];
  /** The week they are for, such as `2026-W46`. */
  readonly week: string;
};

/** The ISO 8601 week of a calendar day (`YYYY-MM-DD`), as `YYYY-Www`. The day is the circle's own: a week starts on its Monday. */
export function isoWeek(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, date));
  const weekday = at.getUTCDay() === 0 ? 7 : at.getUTCDay();
  // The Thursday of this week decides which year the week belongs to.
  at.setUTCDate(at.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(at.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((at.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${at.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** This week's code for a circle: its secret seed and the circle's calendar day, nothing else. */
export function familyCode(seed: string, day: string): FamilyCode {
  const week = isoWeek(day);
  const digest = createHmac("sha256", seed).update(`family-code:${week}`, "utf8").digest();
  // Three different words: a repeat moves on to the next word, so the code is always three.
  const first = digest.readUInt16BE(0) % FAMILY_CODE_WORDS.length;
  const second = (digest.readUInt16BE(2) % FAMILY_CODE_WORDS.length) === first ? (first + 1) % FAMILY_CODE_WORDS.length : digest.readUInt16BE(2) % FAMILY_CODE_WORDS.length;
  let third = digest.readUInt16BE(4) % FAMILY_CODE_WORDS.length;
  while (third === first || third === second) third = (third + 1) % FAMILY_CODE_WORDS.length;
  return { words: [FAMILY_CODE_WORDS[first] ?? "", FAMILY_CODE_WORDS[second] ?? "", FAMILY_CODE_WORDS[third] ?? ""], week };
}

const wordsOf = (text: string): string[] => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[a-z]+/g) ?? [];
const LISTED = new Set(FAMILY_CODE_WORDS);
/** What a person repeats is the three words and a few more at most. A longer answer is not an answer: it could be the whole list read out. */
const MAX_SPOKEN_WORDS = 12;

/**
 * Whether what a caller said, as the parent repeats it, is this week's code: all three words, in any order or case, with
 * ordinary words around them, and **no other word from the list**. Counting only the three would let anyone pass by
 * reading the whole list out, so a longer answer, or one that names any other code word, never matches. A caller who
 * guesses has about one chance in seventeen million per try, and each check takes only a few tries (the database counts
 * them), so the code cannot be worked out by asking.
 */
export function matchesFamilyCode(said: string, code: FamilyCode): boolean {
  const spoken = wordsOf(said.slice(0, 400));
  if (spoken.length > MAX_SPOKEN_WORDS) return false;
  const heard = new Set(spoken.filter((word) => LISTED.has(word)));
  return heard.size === code.words.length && code.words.every((word) => heard.has(word));
}
