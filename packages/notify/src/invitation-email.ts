import { TEXT_LOCALES, type TextLocale } from "./check-in-text.ts";
import type { EmailMessage } from "./sign-in-email.ts";

/**
 * The email that invites someone to a family's circle. Fixed words in the
 * seven languages Kin speaks; the names, the role, the date and the link come
 * from the record and are filled by code. Plain text only, so nothing a family
 * typed can become markup, and every name is cleaned of control characters and
 * line breaks before it reaches the subject or the body. Like every message
 * Kin sends, it asks for nothing: no code, no password, no money.
 */

export const INVITATION_ROLES = ["organizer", "contributor", "parent", "caregiver", "observer"] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

export type InvitationFacts = {
  readonly locale: TextLocale;
  /** The organizer's name as the circle shows it. */
  readonly inviterName: string;
  /** The parent's name as the family gave it; empty when the circle has none yet. */
  readonly parentName: string;
  readonly role: InvitationRole;
  /** When the invitation runs out. */
  readonly expiresAt: Date;
  /** The public page the link opens: https, no credentials. */
  readonly link: string;
};

type Words = {
  readonly subject: string;
  readonly opening: string;
  readonly role: string;
  readonly roles: Readonly<Record<InvitationRole, string>>;
  readonly how: string;
  readonly expires: string;
  readonly safety: string;
  readonly ignore: string;
};

export const INVITATION_WORDS: Readonly<Record<TextLocale, Words>> = {
  en: {
    subject: "{inviter} invited you to {parent}’s circle on Kin",
    opening: "{inviter} has invited you to join the circle that looks after {parent} on Kin, the family’s shared care and money app.",
    role: "Your place in the circle: {role}.",
    roles: { organizer: "organizer", contributor: "contributor", parent: "parent", caregiver: "caregiver", observer: "observer" },
    how: "Open this link to see the invitation, then create your account or sign in with this email address:",
    expires: "The invitation is open until {date}.",
    safety: "Kin will never ask you for a password, a code or money by email, phone or message.",
    ignore: "If you were not expecting this, you can ignore this email. Nothing happens unless you sign in.",
  },
  fr: {
    subject: "{inviter} vous invite dans le cercle de {parent} sur Kin",
    opening: "{inviter} vous invite à rejoindre le cercle qui veille sur {parent} sur Kin, l’application de soins et d’argent partagée par la famille.",
    role: "Votre place dans le cercle : {role}.",
    roles: { organizer: "organisateur", contributor: "contributeur", parent: "parent", caregiver: "aidant", observer: "observateur" },
    how: "Ouvrez ce lien pour voir l’invitation, puis créez votre compte ou connectez-vous avec cette adresse e-mail :",
    expires: "L’invitation reste ouverte jusqu’au {date}.",
    safety: "Kin ne vous demandera jamais de mot de passe, de code ni d’argent par e-mail, téléphone ou message.",
    ignore: "Si vous ne vous y attendiez pas, ignorez cet e-mail. Rien ne se passe tant que vous ne vous connectez pas.",
  },
  de: {
    subject: "{inviter} lädt Sie in den Kreis von {parent} auf Kin ein",
    opening: "{inviter} lädt Sie ein, dem Kreis beizutreten, der sich auf Kin um {parent} kümmert, der gemeinsamen Pflege- und Geld-App der Familie.",
    role: "Ihre Rolle im Kreis: {role}.",
    roles: { organizer: "Organisator", contributor: "Beitragende Person", parent: "Elternteil", caregiver: "Pflegekraft", observer: "Beobachter" },
    how: "Öffnen Sie diesen Link, um die Einladung zu sehen, und erstellen Sie dann Ihr Konto oder melden Sie sich mit dieser E-Mail-Adresse an:",
    expires: "Die Einladung gilt bis {date}.",
    safety: "Kin fragt Sie nie per E-Mail, Telefon oder Nachricht nach einem Passwort, einem Code oder Geld.",
    ignore: "Wenn Sie das nicht erwartet haben, können Sie diese E-Mail ignorieren. Es passiert nichts, solange Sie sich nicht anmelden.",
  },
  it: {
    subject: "{inviter} ti ha invitato nella cerchia di {parent} su Kin",
    opening: "{inviter} ti ha invitato a entrare nella cerchia che si prende cura di {parent} su Kin, l’app di assistenza e denaro condivisa dalla famiglia.",
    role: "Il tuo ruolo nella cerchia: {role}.",
    roles: { organizer: "organizzatore", contributor: "contributore", parent: "genitore", caregiver: "assistente", observer: "osservatore" },
    how: "Apri questo link per vedere l’invito, poi crea il tuo account o accedi con questo indirizzo email:",
    expires: "L’invito resta valido fino al {date}.",
    safety: "Kin non ti chiederà mai password, codici o denaro via email, telefono o messaggio.",
    ignore: "Se non te lo aspettavi, puoi ignorare questa email. Non succede nulla finché non accedi.",
  },
  es: {
    subject: "{inviter} le invitó al círculo de {parent} en Kin",
    opening: "{inviter} le invitó a unirse al círculo que cuida de {parent} en Kin, la app de cuidados y dinero que comparte la familia.",
    role: "Su lugar en el círculo: {role}.",
    roles: { organizer: "organizador", contributor: "colaborador", parent: "padre o madre", caregiver: "cuidador", observer: "observador" },
    how: "Abra este enlace para ver la invitación y luego cree su cuenta o entre con esta dirección de correo:",
    expires: "La invitación está abierta hasta el {date}.",
    safety: "Kin nunca le pedirá una contraseña, un código ni dinero por correo, teléfono o mensaje.",
    ignore: "Si no lo esperaba, puede ignorar este correo. No pasa nada a menos que entre.",
  },
  ar: {
    subject: "{inviter} دعاكم إلى دائرة {parent} على Kin",
    opening: "دعاكم {inviter} للانضمام إلى الدائرة التي ترعى {parent} على Kin، تطبيق الرعاية والمال المشترك للعائلة.",
    role: "مكانكم في الدائرة: {role}.",
    roles: { organizer: "منظِّم", contributor: "مساهم", parent: "الوالد أو الوالدة", caregiver: "مقدِّم رعاية", observer: "مراقب" },
    how: "افتحوا هذا الرابط لرؤية الدعوة، ثم أنشئوا حسابكم أو ادخلوا بعنوان البريد هذا:",
    expires: "تبقى الدعوة مفتوحة حتى {date}.",
    safety: "لن يطلب منكم Kin أبدًا كلمة مرور أو رمزًا أو مالًا عبر البريد أو الهاتف أو الرسائل.",
    ignore: "إن لم تكونوا تتوقعون هذه الرسالة، يمكنكم تجاهلها. لا يحدث شيء ما لم تدخلوا.",
  },
  he: {
    subject: "{inviter} הזמין אתכם למעגל של {parent} ב־Kin",
    opening: "{inviter} הזמין אתכם להצטרף למעגל שדואג ל{parent} ב־Kin, אפליקציית הטיפול והכסף המשותפת של המשפחה.",
    role: "המקום שלכם במעגל: {role}.",
    roles: { organizer: "מארגן", contributor: "תורם", parent: "הורה", caregiver: "מטפל", observer: "צופה" },
    how: "פתחו את הקישור כדי לראות את ההזמנה, ואז צרו חשבון או היכנסו עם כתובת הדוא״ל הזו:",
    expires: "ההזמנה פתוחה עד {date}.",
    safety: "Kin לעולם לא יבקש מכם סיסמה, קוד או כסף בדוא״ל, בטלפון או בהודעה.",
    ignore: "אם לא ציפיתם להודעה הזו, אפשר להתעלם ממנה. שום דבר לא קורה אם לא תיכנסו.",
  },
};

/** The parent's name when the circle has none yet. */
const NO_PARENT: Readonly<Record<TextLocale, string>> = { en: "a parent", fr: "un parent", de: "einen Elternteil", it: "un genitore", es: "un padre o una madre", ar: "أحد الوالدين", he: "הורה" };

/** The facts cannot make an email. Sending the same facts again cannot help. */
export class InvitationEmailError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "InvitationEmailError";
  }
}

const MAX_NAME_CHARS = 60;
const MAX_LINK_CHARS = 300;
const RIGHT_TO_LEFT: ReadonlySet<TextLocale> = new Set(["ar", "he"]);
/** First strong isolate and pop directional isolate: a Latin name or a link keeps its own direction inside an Arabic or Hebrew sentence. */
const isolate = (locale: TextLocale, text: string): string => (RIGHT_TO_LEFT.has(locale) ? `⁨${text}⁩` : text);

/** Letters, marks, digits, spaces and the punctuation names use. Anything else, line breaks and control characters first, is dropped. */
function cleanName(raw: string): string {
  return raw
    .replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();
}

function checkedLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new InvitationEmailError("The invitation link is not a URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || link.length > MAX_LINK_CHARS || /\s/.test(link)) {
    throw new InvitationEmailError("The invitation link must be a plain https address");
  }
  return link;
}

const fill = (template: string, values: Readonly<Record<string, string>>): string => template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole);

export function isInvitationRole(value: string): value is InvitationRole {
  return (INVITATION_ROLES as readonly string[]).includes(value);
}

export function isTextLocale(value: string): value is TextLocale {
  return (TEXT_LOCALES as readonly string[]).includes(value);
}

/** The plain-text email that carries one invitation. */
export function invitationEmail(facts: InvitationFacts): EmailMessage {
  const inviter = cleanName(facts.inviterName);
  if (inviter === "") throw new InvitationEmailError("An invitation email needs the inviter's name");
  if (Number.isNaN(facts.expiresAt.getTime())) throw new InvitationEmailError("An invitation email needs its expiry");
  const words = INVITATION_WORDS[facts.locale];
  const parent = cleanName(facts.parentName) || NO_PARENT[facts.locale];
  const date = new Intl.DateTimeFormat(facts.locale, { dateStyle: "long", timeZone: "UTC" }).format(facts.expiresAt);
  const values = {
    inviter: isolate(facts.locale, inviter),
    parent: isolate(facts.locale, parent),
    role: words.roles[facts.role],
    date,
  };
  // A subject is one header line: the names were cleaned of breaks, and no isolate marks go in it.
  const subject = fill(words.subject, { inviter, parent });
  // The link stands alone on its line, with no mark beside it, so every mail app links all of it and nothing more.
  const text = [fill(words.opening, values), fill(words.role, values), `${words.how}\n${checkedLink(facts.link)}`, fill(words.expires, values), words.safety, words.ignore].join("\n\n");
  return { subject, text: `${text}\n\nKin\n` };
}
