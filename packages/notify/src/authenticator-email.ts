import { TEXT_LOCALES, type TextLocale } from "./check-in-text.ts";
import type { EmailMessage } from "./sign-in-email.ts";

/**
 * The email that tells a person an authenticator app was just set up on their
 * Kin account, so a set-up they did not make cannot pass unseen. Fixed words
 * only: nothing anyone typed reaches it. Like every message Kin sends, it asks
 * for nothing: no code, no password, no money.
 */
const WORDS: Readonly<Record<TextLocale, EmailMessage>> = {
  en: {
    subject: "An authenticator app was set up on your Kin account",
    text: "An authenticator app was just set up as the second step of signing in to your Kin account. From now on, Kin asks for its code whenever you sign in and before you approve a real payment.\n\nIf this was you, there is nothing to do.\n\nIf it was not you, reset your Kin password now from the sign-in page and tell the organizer of your family's circle. Nobody from Kin will ever ask you for a password, a code or money.",
  },
  fr: {
    subject: "Une application d’authentification a été configurée sur votre compte Kin",
    text: "Une application d’authentification vient d’être configurée comme deuxième étape de connexion à votre compte Kin. Désormais, Kin demande son code à chaque connexion et avant que vous approuviez un paiement réel.\n\nSi c’était vous, il n’y a rien à faire.\n\nSi ce n’était pas vous, réinitialisez dès maintenant votre mot de passe Kin depuis la page de connexion et prévenez l’organisateur du cercle de votre famille. Personne chez Kin ne vous demandera jamais de mot de passe, de code ni d’argent.",
  },
  de: {
    subject: "Für Ihr Kin-Konto wurde eine Authentifizierungs-App eingerichtet",
    text: "Für Ihr Kin-Konto wurde soeben eine Authentifizierungs-App als zweiter Schritt der Anmeldung eingerichtet. Ab jetzt fragt Kin bei jeder Anmeldung und vor jeder Freigabe einer echten Zahlung nach ihrem Code.\n\nWenn Sie das waren, müssen Sie nichts tun.\n\nWenn nicht, setzen Sie Ihr Kin-Passwort jetzt auf der Anmeldeseite zurück und informieren Sie die Person, die den Kreis Ihrer Familie organisiert. Niemand von Kin wird Sie jemals nach einem Passwort, einem Code oder Geld fragen.",
  },
  it: {
    subject: "Sul tuo account Kin è stata configurata un’app di autenticazione",
    text: "Sul tuo account Kin è appena stata configurata un’app di autenticazione come secondo passaggio dell’accesso. D’ora in poi Kin chiede il suo codice a ogni accesso e prima che tu approvi un pagamento reale.\n\nSe sei stato tu, non devi fare nulla.\n\nSe non sei stato tu, reimposta subito la password di Kin dalla pagina di accesso e avvisa chi organizza la cerchia della tua famiglia. Nessuno di Kin ti chiederà mai password, codici o denaro.",
  },
  es: {
    subject: "Se configuró una aplicación de autenticación en su cuenta de Kin",
    text: "Se acaba de configurar una aplicación de autenticación como segundo paso para entrar en su cuenta de Kin. A partir de ahora, Kin pide su código cada vez que entra y antes de que apruebe un pago real.\n\nSi fue usted, no tiene que hacer nada.\n\nSi no fue usted, restablezca ahora su contraseña de Kin desde la página de inicio de sesión y avise a quien organiza el círculo de su familia. Nadie de Kin le pedirá nunca una contraseña, un código ni dinero.",
  },
  ar: {
    subject: "تم إعداد تطبيق مصادقة على حسابكم في Kin",
    text: "تم للتو إعداد تطبيق مصادقة كخطوة ثانية لتسجيل الدخول إلى حسابكم في Kin. من الآن فصاعدًا، يطلب Kin رمزه عند كل تسجيل دخول وقبل أن توافقوا على دفعة حقيقية.\n\nإن كنتم أنتم من فعل ذلك، فلا حاجة لفعل شيء.\n\nوإن لم تكونوا أنتم، فأعيدوا تعيين كلمة مرور Kin الآن من صفحة تسجيل الدخول وأخبروا منظِّم دائرة عائلتكم. لن يطلب منكم أحد من Kin أبدًا كلمة مرور أو رمزًا أو مالًا.",
  },
  he: {
    subject: "הוגדרה אפליקציית אימות בחשבון Kin שלכם",
    text: "בדיוק הוגדרה אפליקציית אימות כשלב השני של הכניסה לחשבון Kin שלכם. מעכשיו Kin יבקש את הקוד שלה בכל כניסה ולפני שתאשרו תשלום אמיתי.\n\nאם זה הייתם אתם, אין צורך לעשות דבר.\n\nאם זה לא הייתם אתם, אפסו עכשיו את סיסמת Kin מדף הכניסה וספרו למי שמארגן את המעגל של המשפחה. אף אחד מ־Kin לא יבקש מכם לעולם סיסמה, קוד או כסף.",
  },
};

export function authenticatorEnrolledEmail(locale: string): EmailMessage {
  const known = (TEXT_LOCALES as readonly string[]).includes(locale) ? (locale as TextLocale) : "en";
  return WORDS[known];
}
