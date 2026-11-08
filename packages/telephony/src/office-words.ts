import type { ScriptKey } from "@kin/domain";

/**
 * The words of the office line in each language Kin speaks: the eight fixed
 * sentences the receptionist may say to a caller, and the pieces of the alert
 * the family receives. The phone service cannot read the web app's
 * dictionaries (apps never import each other), so the words live here.
 * `apps/web` tests that they equal the dictionaries' word for word, so a
 * translation changed in one place fails the build until the other follows.
 */
export const OFFICE_LOCALES = ["en", "fr", "de", "it", "es", "ar", "he"] as const;
export type OfficeLocale = (typeof OFFICE_LOCALES)[number];

export function isOfficeLocale(value: string): value is OfficeLocale {
  return (OFFICE_LOCALES as readonly string[]).includes(value);
}

export type AlertWords = {
  readonly unknownCaller: string;
  readonly noPurpose: string;
  readonly pressureNote: string;
  readonly someMoney: string;
  readonly openBill: string;
  readonly alreadyPaid: string;
  readonly unknownPayee: string;
  readonly amountDiffers: string;
  readonly noAmount: string;
};

export type OfficeWords = { readonly script: Readonly<Record<ScriptKey, string>>; readonly alert: AlertWords };

export const OFFICE_WORDS: Readonly<Record<OfficeLocale, OfficeWords>> = {
  "en": {
    "script": {
      "disclosure": "Hello. I am Kin, an automated assistant for this family. This call is recorded as a written transcript. I will ask a few questions.",
      "ask_caller": "Who is calling, please?",
      "ask_organization": "From which organization?",
      "ask_amount": "How much are you asking for?",
      "ask_purpose": "And what is it for?",
      "ask_reference": "Do you have an account or reference number?",
      "reply_handled": "That account is handled by the family and is up to date. Please send any correspondence in writing to the address on file. Goodbye.",
      "reply_no_record": "I have no record of this account. This family does not make payments by phone. Please send the invoice in writing. Goodbye."
    },
    "alert": {
      "unknownCaller": "An unknown caller",
      "noPurpose": "no reason given",
      "pressureNote": "The caller pressed for haste or secrecy.",
      "someMoney": "money",
      "openBill": "{payee} is asking for {claimed}. That matches a bill the family really received, and it is on the list.",
      "alreadyPaid": "{payee} is asking for {claimed}. The record shows {paid} was already paid to {payee} on {paidDay}. Please do not pay it again. I have told the family.",
      "unknownPayee": "{payee} is asking for {claimed}. Nobody by that name is in the family’s record, and no bill matches. Please do not pay. I have told the family.",
      "amountDiffers": "{payee} is asking for {claimed}, but the record holds no bill or payment of that amount. I cannot confirm it. Please wait and check with the family. I have told the family.",
      "noAmount": "{payee} is someone the family knows, but no amount was given, so there is nothing to check. Ask them what amount they want."
    }
  },
  "fr": {
    "script": {
      "disclosure": "Bonjour. Je suis Kin, un assistant automatique de cette famille. Cet appel est conservé sous forme de transcription écrite. Je vais poser quelques questions.",
      "ask_caller": "Qui appelle, s’il vous plaît ?",
      "ask_organization": "De quelle organisation ?",
      "ask_amount": "Quelle somme demandez-vous ?",
      "ask_purpose": "Et pour quelle raison ?",
      "ask_reference": "Avez-vous un numéro de compte ou de référence ?",
      "reply_handled": "Ce compte est géré par la famille et il est à jour. Merci d’envoyer tout courrier à l’adresse connue. Au revoir.",
      "reply_no_record": "Je n’ai aucune trace de ce compte. Cette famille ne fait pas de paiements par téléphone. Merci d’envoyer la facture par écrit. Au revoir."
    },
    "alert": {
      "unknownCaller": "Un appelant inconnu",
      "noPurpose": "aucune raison donnée",
      "pressureNote": "L’appelant a insisté sur l’urgence ou le secret.",
      "someMoney": "de l’argent",
      "openBill": "{payee} demande {claimed}. Cela correspond à une facture que la famille a vraiment reçue, et elle est dans la liste.",
      "alreadyPaid": "{payee} demande {claimed}. Le dossier montre que {paid} ont déjà été payés à {payee} le {paidDay}. Ne payez pas une deuxième fois, s’il vous plaît. J’ai prévenu la famille.",
      "unknownPayee": "{payee} demande {claimed}. Personne de ce nom ne figure dans le dossier de la famille, et aucune facture ne correspond. Ne payez pas, s’il vous plaît. J’ai prévenu la famille.",
      "amountDiffers": "{payee} demande {claimed}, mais le dossier ne contient ni facture ni paiement de ce montant. Je ne peux pas le confirmer. Attendez et vérifiez avec la famille, s’il vous plaît. J’ai prévenu la famille.",
      "noAmount": "{payee} est connu de la famille, mais aucun montant n’a été donné, donc il n’y a rien à vérifier. Demandez quel montant on veut."
    }
  },
  "de": {
    "script": {
      "disclosure": "Guten Tag. Ich bin Kin, ein automatischer Assistent dieser Familie. Dieses Gespräch wird als schriftliches Protokoll festgehalten. Ich stelle Ihnen einige Fragen.",
      "ask_caller": "Wer spricht, bitte?",
      "ask_organization": "Von welcher Organisation?",
      "ask_amount": "Welchen Betrag verlangen Sie?",
      "ask_purpose": "Und wofür?",
      "ask_reference": "Haben Sie eine Konto- oder Referenznummer?",
      "reply_handled": "Dieses Konto wird von der Familie betreut und ist aktuell. Bitte senden Sie alle Schreiben schriftlich an die hinterlegte Adresse. Auf Wiederhören.",
      "reply_no_record": "Zu diesem Konto liegt mir nichts vor. Diese Familie zahlt nicht per Telefon. Bitte senden Sie die Rechnung schriftlich. Auf Wiederhören."
    },
    "alert": {
      "unknownCaller": "Ein unbekannter Anrufer",
      "noPurpose": "kein Grund genannt",
      "pressureNote": "Der Anrufer drängte zur Eile oder zur Geheimhaltung.",
      "someMoney": "Geld",
      "openBill": "{payee} verlangt {claimed}. Das entspricht einer Rechnung, die die Familie wirklich erhalten hat, und sie steht auf der Liste.",
      "alreadyPaid": "{payee} verlangt {claimed}. Die Unterlagen zeigen, dass {paid} am {paidDay} schon an {payee} bezahlt wurden. Bitte nicht noch einmal zahlen. Ich habe die Familie informiert.",
      "unknownPayee": "{payee} verlangt {claimed}. Niemand mit diesem Namen steht in den Unterlagen der Familie, und keine Rechnung passt. Bitte nicht zahlen. Ich habe die Familie informiert.",
      "amountDiffers": "{payee} verlangt {claimed}, aber die Unterlagen enthalten keine Rechnung und keine Zahlung in dieser Höhe. Ich kann es nicht bestätigen. Bitte warten Sie und fragen Sie die Familie. Ich habe die Familie informiert.",
      "noAmount": "{payee} ist der Familie bekannt, aber es wurde kein Betrag genannt, also gibt es nichts zu prüfen. Fragen Sie, welchen Betrag man will."
    }
  },
  "it": {
    "script": {
      "disclosure": "Buongiorno. Sono Kin, un assistente automatico di questa famiglia. Questa chiamata viene conservata come trascrizione scritta. Le farò qualche domanda.",
      "ask_caller": "Chi parla, per favore?",
      "ask_organization": "Da quale organizzazione?",
      "ask_amount": "Che somma chiede?",
      "ask_purpose": "E per quale motivo?",
      "ask_reference": "Ha un numero di conto o di riferimento?",
      "reply_handled": "Questo conto è gestito dalla famiglia ed è in regola. Invii ogni corrispondenza per iscritto all’indirizzo in archivio. Arrivederci.",
      "reply_no_record": "Non ho alcuna traccia di questo conto. Questa famiglia non fa pagamenti per telefono. Invii la fattura per iscritto. Arrivederci."
    },
    "alert": {
      "unknownCaller": "Un chiamante sconosciuto",
      "noPurpose": "nessun motivo indicato",
      "pressureNote": "Il chiamante ha spinto alla fretta o al segreto.",
      "someMoney": "denaro",
      "openBill": "{payee} chiede {claimed}. Corrisponde a una fattura che la famiglia ha davvero ricevuto, ed è nell’elenco.",
      "alreadyPaid": "{payee} chiede {claimed}. I registri mostrano che {paid} sono già stati pagati a {payee} il {paidDay}. Per favore non pagare di nuovo. Ho avvisato la famiglia.",
      "unknownPayee": "{payee} chiede {claimed}. Nessuno con questo nome è nei registri della famiglia e nessuna fattura corrisponde. Per favore non pagare. Ho avvisato la famiglia.",
      "amountDiffers": "{payee} chiede {claimed}, ma i registri non contengono né fatture né pagamenti di questo importo. Non posso confermarlo. Per favore aspetta e controlla con la famiglia. Ho avvisato la famiglia.",
      "noAmount": "{payee} è noto alla famiglia, ma non è stato dato alcun importo, quindi non c’è nulla da controllare. Chiedi quanto vogliono."
    }
  },
  "es": {
    "script": {
      "disclosure": "Hola. Soy Kin, un asistente automático de esta familia. Esta llamada se guarda como transcripción escrita. Le haré unas preguntas.",
      "ask_caller": "¿Quién llama, por favor?",
      "ask_organization": "¿De qué organización?",
      "ask_amount": "¿Cuánto pide?",
      "ask_purpose": "¿Y para qué es?",
      "ask_reference": "¿Tiene un número de cuenta o de referencia?",
      "reply_handled": "Esa cuenta la gestiona la familia y está al día. Envíe cualquier correspondencia por escrito a la dirección que consta. Adiós.",
      "reply_no_record": "No tengo constancia de esa cuenta. Esta familia no hace pagos por teléfono. Envíe la factura por escrito. Adiós."
    },
    "alert": {
      "unknownCaller": "Alguien desconocido",
      "noPurpose": "sin motivo indicado",
      "pressureNote": "Quien llamó metió prisa o pidió secreto.",
      "someMoney": "dinero",
      "openBill": "{payee} pide {claimed}. Coincide con una factura que la familia recibió de verdad, y está en la lista.",
      "alreadyPaid": "{payee} pide {claimed}. El registro muestra que {paid} ya se pagaron a {payee} el {paidDay}. Por favor, no vuelva a pagar. He avisado a la familia.",
      "unknownPayee": "{payee} pide {claimed}. Nadie con ese nombre figura en el registro de la familia y ninguna factura coincide. Por favor, no pague. He avisado a la familia.",
      "amountDiffers": "{payee} pide {claimed}, pero el registro no tiene ninguna factura ni pago de ese importe. No puedo confirmarlo. Por favor, espere y consulte con la familia. He avisado a la familia.",
      "noAmount": "{payee} es alguien que la familia conoce, pero no se dio ningún importe, así que no hay nada que comprobar. Pregunte qué importe quieren."
    }
  },
  "ar": {
    "script": {
      "disclosure": "مرحباً. أنا Kin، مساعد آلي لهذه العائلة. تُحفظ هذه المكالمة كنص مكتوب. سأطرح عليك بعض الأسئلة.",
      "ask_caller": "من المتصل، من فضلك؟",
      "ask_organization": "من أيّة جهة؟",
      "ask_amount": "ما المبلغ المطلوب؟",
      "ask_purpose": "ولماذا هو؟",
      "ask_reference": "هل لديك رقم حساب أو رقم مرجعي؟",
      "reply_handled": "هذا الحساب تتولاه العائلة وهو محدّث. يرجى إرسال أي مراسلة كتابةً إلى العنوان المسجّل. مع السلامة.",
      "reply_no_record": "ليس لدي أي سجل لهذا الحساب. هذه العائلة لا تدفع عبر الهاتف. يرجى إرسال الفاتورة كتابةً. مع السلامة."
    },
    "alert": {
      "unknownCaller": "متصل غير معروف",
      "noPurpose": "لم يُذكر سبب",
      "pressureNote": "ألحّ المتصل على العجلة أو السريّة.",
      "someMoney": "مالاً",
      "openBill": "{payee} يطلب {claimed}. هذا يطابق فاتورة استلمتها العائلة فعلاً، وهي في القائمة.",
      "alreadyPaid": "{payee} يطلب {claimed}. يُظهر السجل أن {paid} دُفعت فعلاً إلى {payee} في {paidDay}. من فضلك لا تدفع مرة أخرى. أبلغت العائلة.",
      "unknownPayee": "{payee} يطلب {claimed}. لا أحد بهذا الاسم في سجل العائلة ولا توجد فاتورة مطابقة. من فضلك لا تدفع. أبلغت العائلة.",
      "amountDiffers": "{payee} يطلب {claimed}، لكن السجل لا يحوي فاتورة أو دفعة بهذا المبلغ. لا أستطيع تأكيده. من فضلك انتظر واسأل العائلة. أبلغت العائلة.",
      "noAmount": "{payee} معروف للعائلة، لكن لم يُذكر مبلغ، فلا شيء للتحقق منه. اسألهم عن المبلغ الذي يريدونه."
    }
  },
  "he": {
    "script": {
      "disclosure": "שלום. אני Kin, עוזר אוטומטי של המשפחה הזו. השיחה מתועדת כתמליל כתוב. אשאל כמה שאלות.",
      "ask_caller": "מי מדבר, בבקשה?",
      "ask_organization": "מאיזה ארגון?",
      "ask_amount": "כמה אתם מבקשים?",
      "ask_purpose": "ולמה זה?",
      "ask_reference": "יש לכם מספר חשבון או אסמכתא?",
      "reply_handled": "החשבון הזה מטופל על ידי המשפחה ומעודכן. אנא שלחו כל מכתב בכתב לכתובת הרשומה. שלום.",
      "reply_no_record": "אין לי רשומה של החשבון הזה. המשפחה הזו לא מבצעת תשלומים בטלפון. אנא שלחו את החשבונית בכתב. שלום."
    },
    "alert": {
      "unknownCaller": "מתקשר לא מוכר",
      "noPurpose": "לא נמסרה סיבה",
      "pressureNote": "המתקשר לחץ למהירות או לסודיות.",
      "someMoney": "כסף",
      "openBill": "{payee} דורש {claimed}. זה תואם חשבון שהמשפחה באמת קיבלה, והוא ברשימה.",
      "alreadyPaid": "{payee} דורש {claimed}. התיעוד מראה ש-{paid} כבר שולמו ל-{payee} ב-{paidDay}. בבקשה אל תשלמו שוב. הודעתי למשפחה.",
      "unknownPayee": "{payee} דורש {claimed}. אף אחד בשם הזה לא מופיע בתיעוד של המשפחה, ושום חשבון לא תואם. בבקשה אל תשלמו. הודעתי למשפחה.",
      "amountDiffers": "{payee} דורש {claimed}, אבל בתיעוד אין חשבון או תשלום בסכום הזה. אני לא יכול לאשר. בבקשה המתינו ובדקו עם המשפחה. הודעתי למשפחה.",
      "noAmount": "{payee} מוכר למשפחה, אבל לא נמסר סכום, אז אין מה לבדוק. שאלו איזה סכום הם רוצים."
    }
  }
};
