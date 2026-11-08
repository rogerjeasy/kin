/**
 * Text that is safe inside XML, for the words and addresses TwiML carries. The
 * escapes cover the five characters XML reserves, and characters XML forbids
 * outright (control codes) are dropped, so nothing a caller says can open a
 * tag or break the document.
 */
// eslint-disable-next-line no-control-regex -- the control characters are exactly what is removed
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export function escapeXml(text: string): string {
  return text.replace(FORBIDDEN, "").replace(/[&<>"']/g, (each) => ESCAPES[each] ?? each);
}
