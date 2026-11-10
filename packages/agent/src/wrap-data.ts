/**
 * Untrusted words, made unable to open or close any tag: every angle bracket
 * becomes a look-alike that is not markup (‹ and ›). Removing only the
 * wrapper's own tag can be undone by nesting or splitting it
 * (`<wor<words>ds>` leaves `<words>` behind after one pass); escaping every
 * bracket cannot, whatever the words hold.
 */
export function inertText(text: string): string {
  return text.replaceAll("<", "‹").replaceAll(">", "›");
}

/** Words wrapped as data in `<tag>`, which nothing inside them can close. One helper for every prompt. */
export function wrapData(tag: string, text: string): string {
  return `<${tag}>\n${inertText(text)}\n</${tag}>`;
}
