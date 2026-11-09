import { formatMoney, type PresenceReply } from "@kin/domain";

import { fillTemplate } from "./fill-template.ts";
import type { OfficeLocale } from "./office-words.ts";

/**
 * Everything Kin says, texts or alerts about an "is it really you?" check, in
 * each language it speaks. The set is closed: the sentences to the parent are
 * the five replies of `@kin/domain`, none holds an amount, and the only things
 * filled in are a first name, the parent's name and, in the family's alert and
 * the text to the real person, an amount from the record. No model words any of
 * it. The web app's screens and the phone service both read it from here, so a
 * screen, a call and a text cannot disagree.
 */
export type PresenceWords = {
  readonly reply: Readonly<Record<PresenceReply, string>>;
  readonly alert: {
    readonly denied: string;
    readonly unreachable: string;
    readonly confirmed: string;
    readonly unknown: string;
    /** Said in place of a name the caller did not give. */
    readonly someone: string;
    /** Said in place of an amount the caller did not name. */
    readonly someMoney: string;
  };
  /** What Kin says when the parent rings its line. */
  readonly line: { readonly intro: string; readonly notHeard: string; readonly askCode: string };
  /** What Kin says when it calls the real person, to ask whether it was them. */
  readonly call: { readonly question: string; readonly reprompt: string; readonly thanksYes: string; readonly thanksNo: string; readonly unclear: string };
  /** The family's own words on a help payment, as the approval card shows them. */
  readonly help: { readonly note: string };
  /** The two texts to a family member's phone. */
  readonly text: { readonly disclosure: string; readonly ask: string; readonly confirm: string };
};

export const PRESENCE_WORDS: Readonly<Record<OfficeLocale, PresenceWords>> = {
  en: {
    reply: {
      checking: "I am checking with {name} now, on {name}’s own phone. Please stay on the line. Do not send any money yet.",
      denied: "{name} says someone else made that call. Please hang up and send nothing. I have told the family.",
      unreachable:
        "I could not reach {name} just now. Real family never ask you to keep a secret or to pay with gift cards. Please hang up and wait for the family to call you. I have told them.",
      confirmed: "{name} says that call really was from {name}. I have told the family. No money has moved. Any help goes only to {name}’s own account, and only when the family approves it.",
      unknown_person: "I do not have anyone of that name among the people you trust. Please hang up, and call a family member you know. I have told the family.",
      code_ok: "That is this week’s family code. A real family member would know it, but still wait for the family to call you before you send anything.",
      code_wrong: "That is not this week’s family code. Real family would know it. Please hang up and send nothing. Wait for the family to call you.",
    },
    alert: {
      denied: "Someone saying they were {name} asked {parent} for {amount}. {name} says it was not them. Treat it as a scam. Outgoing money is on hold for a day.",
      unreachable: "Someone saying they were {name} asked {parent} for {amount}. I could not reach {name}. Please call {name} and {parent} now. Outgoing money is held while you check.",
      confirmed: "{name} says it really was them asking {parent} for {amount}. Nothing has been paid. Any help needs the family’s approval and goes only to {name}’s own account.",
      unknown: "Someone saying they were {name} asked {parent} for {amount}. That person is not among those Kin may ask. Treat it as a scam and call {parent}.",
      someone: "a family member",
      someMoney: "money",
    },
    line: {
      intro: "Hello. I am Kin, an automated assistant for your family. I keep a written transcript of this call. Tell me who called, what they asked for, and how much.",
      notHeard: "I did not catch that. Please tell me who called and what they asked for.",
      askCode: "Ask the caller for this week’s family code, then tell me what they say.",
    },
    text: {
      disclosure: "Kin, your family’s care app.",
      ask: "Is this you? Someone phoned {parent} asking for {amount} and said they were you. Tap to answer: {url}",
      confirm: "{parent}’s family asks you to be one of the people Kin may check with when a caller says they are you. Tap to confirm this is your number: {url}",
    },
    call: {
      question: "Hello, {name}. This is Kin, your family’s automated assistant. Someone phoned {parent} and asked for {amount}, saying they were you. Was that you? Say yes or press 1. Say no or press 2.",
      reprompt: "Sorry, I did not catch that. Was it you who phoned {parent}? Say yes or press 1. Say no or press 2.",
      thanksYes: "Thank you. I have told the family it was you. No money has moved.",
      thanksNo: "Thank you. I have told the family it was not you, and I am holding outgoing money. Please call {parent} if you can.",
      unclear: "I could not tell. I have changed nothing. Please open the link in the text, or call {parent}.",
    },
    help: { note: "Help for {name}, after {name} confirmed the request. It goes only to {name}’s own PayPal account." },
  },
  fr: {
    reply: {
      checking: "Je vérifie auprès de {name}, sur son propre téléphone. Restez en ligne, s’il vous plaît. N’envoyez pas d’argent pour l’instant.",
      denied: "{name} dit que cet appel ne venait pas de sa part. Raccrochez, s’il vous plaît, et n’envoyez rien. J’ai prévenu la famille.",
      unreachable:
        "Je n’ai pas pu joindre {name} pour l’instant. Un vrai proche ne vous demande jamais de garder un secret ni de payer avec des cartes cadeaux. Raccrochez et attendez que la famille vous rappelle. Je l’ai prévenue.",
      confirmed: "{name} confirme que l’appel venait bien de sa part. J’ai prévenu la famille. Aucun argent n’a bougé. Toute aide ira uniquement sur le propre compte de {name}, et seulement si la famille l’approuve.",
      unknown_person: "Je n’ai personne de ce nom parmi les personnes de confiance. Raccrochez, puis appelez un proche que vous connaissez. J’ai prévenu la famille.",
      code_ok: "C’est bien le code de famille de cette semaine. Un vrai proche le connaît, mais attendez quand même que la famille vous appelle avant d’envoyer quoi que ce soit.",
      code_wrong: "Ce n’est pas le code de famille de cette semaine. Un vrai proche le connaîtrait. Raccrochez et n’envoyez rien. Attendez que la famille vous appelle.",
    },
    alert: {
      denied: "Quelqu’un se faisant passer pour {name} a demandé {amount} à {parent}. {name} dit que l’appel ne venait pas de sa part. Considérez-le comme une arnaque. Les paiements sortants sont suspendus pendant un jour.",
      unreachable: "Quelqu’un se faisant passer pour {name} a demandé {amount} à {parent}. Je n’ai pas pu joindre {name}. Appelez {name} et {parent} maintenant. Les paiements sortants sont suspendus le temps de vérifier.",
      confirmed: "{name} confirme que la demande de {amount} à {parent} venait bien de sa part. Rien n’a été payé. Toute aide demande l’accord de la famille et ira uniquement sur le propre compte de {name}.",
      unknown: "Quelqu’un se faisant passer pour {name} a demandé {amount} à {parent}. Cette personne ne fait pas partie de celles que Kin peut joindre. Considérez-le comme une arnaque et appelez {parent}.",
      someone: "un membre de la famille",
      someMoney: "de l’argent",
    },
    line: {
      intro: "Bonjour. Je suis Kin, un assistant automatique de votre famille. Je garde une transcription écrite de cet appel. Dites-moi qui a appelé, ce qu’on vous a demandé et pour quelle somme.",
      notHeard: "Je n’ai pas bien entendu. Dites-moi qui a appelé et ce qu’on vous a demandé.",
      askCode: "Demandez à l’appelant le code de famille de cette semaine, puis dites-moi ce qu’il répond.",
    },
    text: {
      disclosure: "Kin, l’application de soins de votre famille.",
      ask: "C’est bien vous ? Quelqu’un a téléphoné à {parent} pour demander {amount} en se faisant passer pour vous. Appuyez pour répondre : {url}",
      confirm: "La famille de {parent} vous demande d’être l’une des personnes que Kin peut joindre quand un appelant dit être vous. Appuyez pour confirmer que ce numéro est le vôtre : {url}",
    },
    call: {
      question: "Bonjour {name}. Ici Kin, l’assistant automatique de votre famille. Quelqu’un a téléphoné à {parent} pour demander {amount} en se faisant passer pour vous. Était-ce vous ? Dites oui ou appuyez sur 1. Dites non ou appuyez sur 2.",
      reprompt: "Désolé, je n’ai pas bien entendu. Est-ce vous qui avez téléphoné à {parent} ? Dites oui ou appuyez sur 1. Dites non ou appuyez sur 2.",
      thanksYes: "Merci. J’ai dit à la famille que c’était vous. Aucun argent n’a bougé.",
      thanksNo: "Merci. J’ai dit à la famille que ce n’était pas vous et je suspends les paiements sortants. Appelez {parent} si vous le pouvez.",
      unclear: "Je n’ai pas pu comprendre. Je n’ai rien changé. Ouvrez le lien du SMS ou appelez {parent}.",
    },
    help: { note: "Aide pour {name}, qui a confirmé la demande. Elle ira uniquement sur le propre compte PayPal de {name}." },
  },
  de: {
    reply: {
      checking: "Ich frage gerade bei {name} nach, auf dem eigenen Telefon. Bitte bleiben Sie in der Leitung. Schicken Sie noch kein Geld.",
      denied: "{name} sagt, dass jemand anderes diesen Anruf gemacht hat. Bitte legen Sie auf und schicken Sie nichts. Ich habe die Familie informiert.",
      unreachable:
        "Ich habe {name} gerade nicht erreicht. Echte Angehörige verlangen nie, dass Sie etwas geheim halten oder mit Geschenkkarten zahlen. Bitte legen Sie auf und warten Sie, bis die Familie Sie anruft. Ich habe sie informiert.",
      confirmed: "{name} bestätigt, dass der Anruf wirklich von {name} kam. Ich habe die Familie informiert. Es ist kein Geld geflossen. Jede Hilfe geht nur auf das eigene Konto von {name} und nur, wenn die Familie zustimmt.",
      unknown_person: "Unter den Personen, denen Sie vertrauen, habe ich niemanden mit diesem Namen. Bitte legen Sie auf und rufen Sie einen Angehörigen an, den Sie kennen. Ich habe die Familie informiert.",
      code_ok: "Das ist der Familiencode dieser Woche. Echte Angehörige kennen ihn, aber warten Sie trotzdem, bis die Familie Sie anruft, bevor Sie irgendetwas senden.",
      code_wrong: "Das ist nicht der Familiencode dieser Woche. Echte Angehörige würden ihn kennen. Bitte legen Sie auf und schicken Sie nichts. Warten Sie, bis die Familie Sie anruft.",
    },
    alert: {
      denied: "Jemand hat {parent} um {amount} gebeten und sich als {name} ausgegeben. {name} sagt, dass jemand anderes angerufen hat. Behandeln Sie es als Betrug. Ausgehende Zahlungen sind einen Tag lang angehalten.",
      unreachable: "Jemand hat {parent} um {amount} gebeten und sich als {name} ausgegeben. Ich habe {name} nicht erreicht. Rufen Sie jetzt {name} und {parent} an. Ausgehende Zahlungen sind für die Prüfung angehalten.",
      confirmed: "{name} bestätigt, dass der Anruf bei {parent} wegen {amount} wirklich von {name} kam. Nichts wurde bezahlt. Jede Hilfe braucht die Zustimmung der Familie und geht nur auf das eigene Konto von {name}.",
      unknown: "Jemand hat {parent} um {amount} gebeten und sich als {name} ausgegeben. Diese Person steht nicht auf der Liste der Menschen, die Kin fragen darf. Behandeln Sie es als Betrug und rufen Sie {parent} an.",
      someone: "ein Familienmitglied",
      someMoney: "Geld",
    },
    line: {
      intro: "Guten Tag. Ich bin Kin, ein automatischer Assistent Ihrer Familie. Von diesem Anruf bleibt eine schriftliche Mitschrift. Sagen Sie mir, wer angerufen hat, was verlangt wurde und wie viel.",
      notHeard: "Das habe ich nicht verstanden. Sagen Sie mir bitte, wer angerufen hat und was verlangt wurde.",
      askCode: "Fragen Sie den Anrufer nach dem Familiencode dieser Woche und sagen Sie mir, was er antwortet.",
    },
    text: {
      disclosure: "Kin, die Pflege-App Ihrer Familie.",
      ask: "Sind Sie das? Jemand hat {parent} angerufen, {amount} verlangt und sich als Sie ausgegeben. Zum Antworten tippen: {url}",
      confirm: "Die Familie von {parent} bittet Sie, eine der Personen zu sein, bei denen Kin nachfragen darf, wenn jemand am Telefon behauptet, Sie zu sein. Tippen Sie, um zu bestätigen, dass dies Ihre Nummer ist: {url}",
    },
    call: {
      question: "Guten Tag, {name}. Hier ist Kin, der automatische Assistent Ihrer Familie. Jemand hat {parent} angerufen, {amount} verlangt und sich als Sie ausgegeben. Waren Sie das? Sagen Sie Ja oder drücken Sie die 1. Sagen Sie Nein oder drücken Sie die 2.",
      reprompt: "Entschuldigung, das habe ich nicht verstanden. Haben Sie {parent} angerufen? Sagen Sie Ja oder drücken Sie die 1. Sagen Sie Nein oder drücken Sie die 2.",
      thanksYes: "Danke. Ich habe der Familie gesagt, dass Sie es waren. Es ist kein Geld geflossen.",
      thanksNo: "Danke. Ich habe der Familie gesagt, dass Sie es nicht waren, und halte ausgehende Zahlungen an. Rufen Sie bitte {parent} an, wenn Sie können.",
      unclear: "Das konnte ich nicht verstehen. Ich habe nichts geändert. Öffnen Sie bitte den Link in der SMS oder rufen Sie {parent} an.",
    },
    help: { note: "Hilfe für {name}, nachdem {name} die Anfrage bestätigt hat. Sie geht nur auf das eigene PayPal-Konto von {name}." },
  },
  it: {
    reply: {
      checking: "Sto verificando con {name}, sul suo telefono. Resti in linea, per favore. Non invii ancora denaro.",
      denied: "{name} dice che quella chiamata non era sua. Riattacchi, per favore, e non invii nulla. Ho avvisato la famiglia.",
      unreachable:
        "Non è stato possibile raggiungere {name} adesso. I veri familiari non chiedono mai di tenere un segreto né di pagare con carte regalo. Riattacchi e aspetti che la famiglia la richiami. Ho avvisato la famiglia.",
      confirmed: "{name} conferma che la chiamata era proprio sua. Ho avvisato la famiglia. Nessun denaro si è mosso. Qualsiasi aiuto andrà solo sul conto personale di {name}, e solo se la famiglia lo approva.",
      unknown_person: "Non ho nessuno con questo nome tra le persone di cui si fida. Riattacchi e chiami un familiare che conosce. Ho avvisato la famiglia.",
      code_ok: "Questo è il codice di famiglia di questa settimana. Un vero familiare lo conosce, ma aspetti comunque che la famiglia la richiami prima di inviare qualsiasi cosa.",
      code_wrong: "Questo non è il codice di famiglia di questa settimana. Un vero familiare lo conoscerebbe. Riattacchi e non invii nulla. Aspetti che la famiglia la richiami.",
    },
    alert: {
      denied: "Qualcuno che si faceva passare per {name} ha chiesto {amount} a {parent}. {name} dice che la chiamata non era sua. Consideratela una truffa. I pagamenti in uscita sono sospesi per un giorno.",
      unreachable: "Qualcuno che si faceva passare per {name} ha chiesto {amount} a {parent}. Non è stato possibile raggiungere {name}. Chiamate subito {name} e {parent}. I pagamenti in uscita sono sospesi mentre verificate.",
      confirmed: "{name} conferma che la richiesta di {amount} a {parent} veniva proprio da {name}. Non è stato pagato nulla. Ogni aiuto richiede l’approvazione della famiglia e andrà solo sul conto personale di {name}.",
      unknown: "Qualcuno che si faceva passare per {name} ha chiesto {amount} a {parent}. Questa persona non è tra quelle che Kin può contattare. Consideratela una truffa e chiamate {parent}.",
      someone: "un familiare",
      someMoney: "denaro",
    },
    line: {
      intro: "Buongiorno. Sono Kin, un assistente automatico della sua famiglia. Conservo una trascrizione scritta di questa chiamata. Mi dica chi ha chiamato, che cosa le ha chiesto e quanto.",
      notHeard: "Non ho capito bene. Mi dica chi ha chiamato e che cosa le ha chiesto.",
      askCode: "Chieda a chi ha chiamato il codice di famiglia di questa settimana, poi mi dica cosa risponde.",
    },
    text: {
      disclosure: "Kin, l’app di assistenza della tua famiglia.",
      ask: "Sei tu? Qualcuno ha telefonato a {parent} chiedendo {amount} e dicendo di essere te. Tocca per rispondere: {url}",
      confirm: "La famiglia di {parent} ti chiede di essere una delle persone che Kin può contattare quando qualcuno al telefono dice di essere te. Tocca per confermare che questo è il tuo numero: {url}",
    },
    call: {
      question: "Ciao {name}. Sono Kin, l’assistente automatico della tua famiglia. Qualcuno ha telefonato a {parent} chiedendo {amount} e dicendo di essere te. Eri tu? Di’ sì o premi 1. Di’ no o premi 2.",
      reprompt: "Scusa, non ho capito. Hai telefonato tu a {parent}? Di’ sì o premi 1. Di’ no o premi 2.",
      thanksYes: "Grazie. Ho detto alla famiglia che eri tu. Nessun denaro si è mosso.",
      thanksNo: "Grazie. Ho detto alla famiglia che non eri tu e sto sospendendo i pagamenti in uscita. Chiama {parent} se puoi.",
      unclear: "Non ho capito bene. Non ho cambiato nulla. Apri il link nel messaggio o chiama {parent}.",
    },
    help: { note: "Aiuto per {name}, che ha confermato la richiesta. Andrà solo sul conto PayPal personale di {name}." },
  },
  es: {
    reply: {
      checking: "Estoy comprobándolo con {name}, en su propio teléfono. Por favor, siga en línea. No envíe dinero todavía.",
      denied: "{name} dice que esa llamada no era suya. Por favor, cuelgue y no envíe nada. He avisado a la familia.",
      unreachable:
        "No he podido localizar a {name} ahora. La familia de verdad nunca le pide que guarde un secreto ni que pague con tarjetas de regalo. Por favor, cuelgue y espere a que la familia le llame. Les he avisado.",
      confirmed: "{name} confirma que la llamada era suya. He avisado a la familia. No se ha movido dinero. Cualquier ayuda irá solo a la cuenta propia de {name}, y solo si la familia la aprueba.",
      unknown_person: "No tengo a nadie con ese nombre entre las personas de su confianza. Por favor, cuelgue y llame a un familiar que conozca. He avisado a la familia.",
      code_ok: "Ese es el código de familia de esta semana. Un familiar de verdad lo conoce, pero aun así espere a que la familia le llame antes de enviar nada.",
      code_wrong: "Ese no es el código de familia de esta semana. Un familiar de verdad lo sabría. Por favor, cuelgue y no envíe nada. Espere a que la familia le llame.",
    },
    alert: {
      denied: "Alguien que decía ser {name} pidió {amount} a {parent}. {name} dice que esa llamada no era suya. Trátelo como una estafa. Los pagos salientes quedan retenidos durante un día.",
      unreachable: "Alguien que decía ser {name} pidió {amount} a {parent}. No he podido localizar a {name}. Llamen ahora a {name} y a {parent}. Los pagos salientes quedan retenidos mientras lo comprueban.",
      confirmed: "{name} confirma que fue realmente {name} quien pidió {amount} a {parent}. No se ha pagado nada. Cualquier ayuda necesita la aprobación de la familia e irá solo a la cuenta propia de {name}.",
      unknown: "Alguien que decía ser {name} pidió {amount} a {parent}. Esa persona no está entre las que Kin puede consultar. Trátelo como una estafa y llame a {parent}.",
      someone: "un familiar",
      someMoney: "dinero",
    },
    line: {
      intro: "Hola. Soy Kin, un asistente automático de su familia. Guardo una transcripción escrita de esta llamada. Dígame quién llamó, qué le pidió y cuánto.",
      notHeard: "No le he entendido bien. Dígame quién llamó y qué le pidió.",
      askCode: "Pida a quien llamó el código de familia de esta semana y dígame qué responde.",
    },
    text: {
      disclosure: "Kin, la app de cuidados de su familia.",
      ask: "¿Es usted? Alguien llamó a {parent} para pedir {amount} diciendo ser usted. Toque para responder: {url}",
      confirm: "La familia de {parent} le pide ser una de las personas a las que Kin puede consultar cuando alguien por teléfono dice ser usted. Toque para confirmar que este es su número: {url}",
    },
    call: {
      question: "Hola, {name}. Soy Kin, el asistente automático de su familia. Alguien llamó a {parent} para pedir {amount} diciendo ser usted. ¿Fue usted? Diga sí o pulse 1. Diga no o pulse 2.",
      reprompt: "Perdone, no le he entendido. ¿Fue usted quien llamó a {parent}? Diga sí o pulse 1. Diga no o pulse 2.",
      thanksYes: "Gracias. He dicho a la familia que fue usted. No se ha movido dinero.",
      thanksNo: "Gracias. He dicho a la familia que no fue usted y retengo los pagos salientes. Llame a {parent} si puede.",
      unclear: "No he podido entenderle. No he cambiado nada. Abra el enlace del mensaje o llame a {parent}.",
    },
    help: { note: "Ayuda para {name}, que confirmó la petición. Irá solo a la cuenta de PayPal propia de {name}." },
  },
  ar: {
    reply: {
      checking: "أتحقق الآن من {name} على الهاتف الخاص بـ{name}. من فضلك ابقَ على الخط. لا ترسل أي مال بعد.",
      denied: "جاء ردّ {name}: «هذه المكالمة لم تكن مني». من فضلك أنهِ المكالمة ولا ترسل شيئاً. أبلغت العائلة.",
      unreachable: "لم أتمكن من الوصول إلى {name} الآن. أفراد العائلة الحقيقيون لا يطلبون منك أبداً كتمان سرّ أو الدفع ببطاقات الهدايا. من فضلك أنهِ المكالمة وانتظر اتصال العائلة بك. أبلغتهم.",
      confirmed: "جاء ردّ {name}: «نعم، هذه المكالمة كانت مني». أبلغت العائلة. لم يتحرك أي مال. أي مساعدة تذهب فقط إلى الحساب الخاص بـ{name}، وبعد موافقة العائلة فقط.",
      unknown_person: "ليس لدي أحد بهذا الاسم بين الأشخاص الذين تثق بهم. من فضلك أنهِ المكالمة واتصل بأحد أفراد العائلة الذين تعرفهم. أبلغت العائلة.",
      code_ok: "هذا هو رمز العائلة لهذا الأسبوع. يعرفه أفراد العائلة الحقيقيون، لكن انتظر مع ذلك أن تتصل بك العائلة قبل أن ترسل أي شيء.",
      code_wrong: "هذا ليس رمز العائلة لهذا الأسبوع. كان سيعرفه أفراد العائلة الحقيقيون. من فضلك أنهِ المكالمة ولا ترسل شيئاً. انتظر اتصال العائلة بك.",
    },
    alert: {
      denied: "طلب شخص يدّعي أنه {name} {amount} من {parent}. جاء ردّ {name}: «هذه المكالمة لم تكن مني». تعاملوا معها كاحتيال. المدفوعات الصادرة موقوفة ليوم واحد.",
      unreachable: "طلب شخص يدّعي أنه {name} {amount} من {parent}. لم أتمكن من الوصول إلى {name}. اتصلوا الآن بـ{name} وبـ{parent}. المدفوعات الصادرة موقوفة أثناء التحقق.",
      confirmed: "جاء ردّ {name}: «نعم، أنا من طلب {amount} من {parent}». لم يُدفع شيء. أي مساعدة تحتاج موافقة العائلة وتذهب فقط إلى الحساب الخاص بـ{name}.",
      unknown: "طلب شخص يدّعي أنه {name} {amount} من {parent}. هذا الشخص ليس بين من يمكن لـ Kin سؤالهم. تعاملوا معه كاحتيال واتصلوا بـ{parent}.",
      someone: "فرد من العائلة",
      someMoney: "مالاً",
    },
    line: {
      intro: "مرحباً. أنا Kin، مساعد آلي لعائلتكم. أحتفظ بنص مكتوب لهذه المكالمة. أخبرني من اتصل بكم، وماذا طلب، وكم المبلغ.",
      notHeard: "لم أسمع جيداً. أخبرني من اتصل وماذا طلب.",
      askCode: "اطلب من المتصل رمز العائلة لهذا الأسبوع، ثم أخبرني بما يقوله.",
    },
    text: {
      disclosure: "Kin، تطبيق رعاية عائلتكم.",
      ask: "هل هذا أنتم؟ اتصل شخص بـ{parent} وطلب {amount} مدّعياً أنه أنتم. اضغطوا للرد: {url}",
      confirm: "تطلب عائلة {parent} منكم أن تكونوا من الأشخاص الذين يمكن لـ Kin سؤالهم حين يدّعي متصل أنه أنتم. اضغطوا لتأكيد أن هذا رقمكم: {url}",
    },
    call: {
      question: "مرحباً {name}. أنا Kin، المساعد الآلي لعائلتكم. اتصل شخص بـ{parent} وطلب {amount} مدّعياً أنه أنتم. هل كنتم أنتم؟ قولوا نعم أو اضغطوا 1. قولوا لا أو اضغطوا 2.",
      reprompt: "عذراً، لم أسمع جيداً. هل أنتم من اتصل بـ{parent}؟ قولوا نعم أو اضغطوا 1. قولوا لا أو اضغطوا 2.",
      thanksYes: "شكراً. أخبرت العائلة أنها كانت منكم. لم يتحرك أي مال.",
      thanksNo: "شكراً. أخبرت العائلة أنها لم تكن منكم، وأوقفت المدفوعات الصادرة. اتصلوا بـ{parent} إن استطعتم.",
      unclear: "لم أفهم. لم أغيّر شيئاً. افتحوا الرابط في الرسالة أو اتصلوا بـ{parent}.",
    },
    help: { note: "مساعدة لـ{name} بعد أن أكّد {name} الطلب. تذهب فقط إلى حساب PayPal الخاص بـ{name}." },
  },
  he: {
    reply: {
      checking: "אני בודק עכשיו מול {name}, בטלפון הפרטי של {name}. אנא הישארו על הקו. אל תשלחו כסף עדיין.",
      denied: "התשובה מ-{name}: ״השיחה הזו לא הייתה ממני״. אנא נתקו ואל תשלחו דבר. הודעתי למשפחה.",
      unreachable: "לא הצלחתי להגיע אל {name} כרגע. בני משפחה אמיתיים לעולם לא מבקשים לשמור סוד או לשלם בכרטיסי מתנה. אנא נתקו וחכו שהמשפחה תתקשר אליכם. הודעתי להם.",
      confirmed: "התשובה מ-{name}: ״כן, השיחה הזו הייתה ממני״. הודעתי למשפחה. שום כסף לא זז. כל עזרה תגיע רק לחשבון האישי של {name}, ורק באישור המשפחה.",
      unknown_person: "אין לי אף אחד בשם הזה בין האנשים שאתם סומכים עליהם. אנא נתקו והתקשרו לבן משפחה שאתם מכירים. הודעתי למשפחה.",
      code_ok: "זה קוד המשפחה של השבוע. בן משפחה אמיתי מכיר אותו, אבל בכל זאת חכו שהמשפחה תתקשר אליכם לפני ששולחים משהו.",
      code_wrong: "זה לא קוד המשפחה של השבוע. בן משפחה אמיתי היה מכיר אותו. אנא נתקו ואל תשלחו דבר. חכו שהמשפחה תתקשר אליכם.",
    },
    alert: {
      denied: "מישהו שהציג את עצמו כ-{name} ביקש {amount} מ-{parent}. התשובה מ-{name}: ״השיחה לא הייתה ממני״. התייחסו לזה כהונאה. תשלומים יוצאים מוקפאים ליום אחד.",
      unreachable: "מישהו שהציג את עצמו כ-{name} ביקש {amount} מ-{parent}. לא הצלחתי להגיע אל {name}. התקשרו עכשיו אל {name} ואל {parent}. תשלומים יוצאים מוקפאים בזמן הבדיקה.",
      confirmed: "התשובה מ-{name}: ״כן, אני ביקשתי {amount} מ-{parent}״. שום דבר לא שולם. כל עזרה דורשת אישור המשפחה ותגיע רק לחשבון האישי של {name}.",
      unknown: "מישהו שהציג את עצמו כ-{name} ביקש {amount} מ-{parent}. האדם הזה אינו בין מי ש-Kin רשאי לשאול. התייחסו לזה כהונאה והתקשרו אל {parent}.",
      someone: "בן משפחה",
      someMoney: "כסף",
    },
    line: {
      intro: "שלום. אני Kin, עוזר אוטומטי של המשפחה שלכם. אני שומר תמליל כתוב של השיחה. ספרו לי מי התקשר, מה ביקש וכמה.",
      notHeard: "לא שמעתי טוב. ספרו לי מי התקשר ומה ביקש.",
      askCode: "בקשו מהמתקשר את קוד המשפחה של השבוע, ואז ספרו לי מה הוא אומר.",
    },
    text: {
      disclosure: "Kin, אפליקציית הטיפול של המשפחה שלכם.",
      ask: "זה אתם? מישהו התקשר אל {parent}, ביקש {amount} ואמר שהוא אתם. לחצו כדי לענות: {url}",
      confirm: "המשפחה של {parent} מבקשת שתהיו אחד מהאנשים ש-Kin רשאי לשאול כשמתקשר טוען שהוא אתם. לחצו כדי לאשר שזה המספר שלכם: {url}",
    },
    call: {
      question: "שלום {name}. כאן Kin, העוזר האוטומטי של המשפחה שלכם. מישהו התקשר אל {parent}, ביקש {amount} ואמר שהוא אתם. זה הייתם אתם? אמרו כן או לחצו 1. אמרו לא או לחצו 2.",
      reprompt: "סליחה, לא שמעתי טוב. אתם התקשרתם אל {parent}? אמרו כן או לחצו 1. אמרו לא או לחצו 2.",
      thanksYes: "תודה. אמרתי למשפחה שזה הייתם אתם. שום כסף לא זז.",
      thanksNo: "תודה. אמרתי למשפחה שזה לא הייתם אתם, ואני מקפיא תשלומים יוצאים. התקשרו אל {parent} אם אפשר.",
      unclear: "לא הצלחתי להבין. לא שיניתי דבר. פתחו את הקישור בהודעה או התקשרו אל {parent}.",
    },
    help: { note: "עזרה עבור {name} אחרי שהבקשה אושרה על ידי {name}. היא תגיע רק לחשבון ה-PayPal האישי של {name}." },
  },
};

const RIGHT_TO_LEFT: ReadonlySet<OfficeLocale> = new Set(["ar", "he"]);
const RIGHT_TO_LEFT_MARK = "‏";
const MAX_NAME_CHARS = 40;

/** Digits and neutral marks drift in a right-to-left sentence, so each filled-in value is isolated there, as the dashboard does. */
const isolated = (locale: OfficeLocale, text: string): string => (RIGHT_TO_LEFT.has(locale) ? `⁨${text}⁩` : text);

const cleanName = (raw: string): string =>
  raw
    .replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();

/** A first name, as the sentence says it. */
export const presenceName = (raw: string): string => cleanName(raw).split(" ")[0] ?? "";

/** The facts the sentences are filled from, all of them from the record. */
export type PresenceFacts = {
  readonly locale: OfficeLocale;
  readonly currency: string;
  /** The trusted person's name, or the name the caller gave when nobody on the list fits. `null` when none was given. */
  readonly name: string | null;
  readonly parentName: string;
  readonly claimedCents: number | null;
};

function values(facts: PresenceFacts): Record<string, string> {
  const words = PRESENCE_WORDS[facts.locale];
  const name = facts.name === null ? "" : presenceName(facts.name);
  const parent = presenceName(facts.parentName);
  return {
    name: isolated(facts.locale, name === "" ? words.alert.someone : name),
    parent: isolated(facts.locale, parent === "" ? words.alert.someone : parent),
    amount: facts.claimedCents === null ? words.alert.someMoney : isolated(facts.locale, formatMoney({ cents: facts.claimedCents, currency: facts.currency }, `${facts.locale}-u-nu-latn`)),
  };
}

/** The one sentence the parent hears or reads for a check. */
export function presenceReplyText(facts: PresenceFacts, reply: PresenceReply): string {
  return fillTemplate(PRESENCE_WORDS[facts.locale].reply[reply], values(facts));
}

export type PresenceAlertTexts = { readonly denied: string; readonly unreachable: string; readonly confirmed: string; readonly unknown: string };

/** The family's alert for each way a check can end, worded from the record. Stored with the check when it is opened. */
export function presenceAlertTexts(facts: PresenceFacts): PresenceAlertTexts {
  const { alert } = PRESENCE_WORDS[facts.locale];
  const filled = values(facts);
  return {
    denied: fillTemplate(alert.denied, filled).slice(0, 600),
    unreachable: fillTemplate(alert.unreachable, filled).slice(0, 600),
    confirmed: fillTemplate(alert.confirmed, filled).slice(0, 600),
    unknown: fillTemplate(alert.unknown, filled).slice(0, 600),
  };
}

const MAX_LINK_CHARS = 300;

function checkedLink(link: string): string {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new Error("The link is not an address");
  }
  if (link.length > MAX_LINK_CHARS || url.protocol !== "https:" || url.username !== "" || url.password !== "" || /\s/.test(link)) {
    throw new Error("The link must be a plain HTTPS address");
  }
  return url.toString();
}

function twoLines(locale: OfficeLocale, line: string): string {
  const { disclosure } = PRESENCE_WORDS[locale].text;
  return `${RIGHT_TO_LEFT.has(locale) ? `${RIGHT_TO_LEFT_MARK}${disclosure}` : disclosure}\n${line}`;
}

const askLine = (facts: PresenceFacts, url: string): string => twoLines(facts.locale, fillTemplate(PRESENCE_WORDS[facts.locale].text.ask, { ...values(facts), url: isolated(facts.locale, url) }));

/** The text that asks the real person "is this you?": who it is from, what was asked, and the link. The link must be a plain HTTPS address. */
export function presenceAskText(facts: PresenceFacts & { readonly link: string }): string {
  return askLine(facts, checkedLink(facts.link));
}

/**
 * The same text as a demo circle shows it on the stand-in's screen. It is never
 * sent, so its link may be the plain address of a local run; it must still be
 * a web address with no credentials in it.
 */
export function presenceAskPreview(facts: PresenceFacts & { readonly link: string }): string {
  const url = new URL(facts.link);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") throw new Error("The preview link must be a web address");
  return askLine(facts, url.toString());
}

/** The text that asks a family member to confirm their number. */
export function voiceConfirmText(facts: Pick<PresenceFacts, "locale" | "parentName"> & { readonly link: string }): string {
  const parent = presenceName(facts.parentName);
  const words = PRESENCE_WORDS[facts.locale];
  return twoLines(
    facts.locale,
    fillTemplate(words.text.confirm, { parent: isolated(facts.locale, parent === "" ? words.alert.someone : parent), url: isolated(facts.locale, checkedLink(facts.link)) }),
  );
}

export const PRESENCE_CALL_LINES = ["question", "reprompt", "thanksYes", "thanksNo", "unclear"] as const;
export type PresenceCallLine = (typeof PRESENCE_CALL_LINES)[number];

/** One sentence of Kin's call to the real person. The amount is said to them, and to no one else: they are the person it is about. */
export function presenceCallText(facts: PresenceFacts, line: PresenceCallLine): string {
  return fillTemplate(PRESENCE_WORDS[facts.locale].call[line], values(facts));
}

/** The family's words beside a help payment, in the approval card. Holds the person's name and nothing the caller said. */
export function presenceHelpNote(facts: Pick<PresenceFacts, "locale" | "name">): string {
  const name = facts.name === null ? "" : presenceName(facts.name);
  const shown = isolated(facts.locale, name === "" ? PRESENCE_WORDS[facts.locale].alert.someone : name);
  return fillTemplate(PRESENCE_WORDS[facts.locale].help.note, { name: shown }).slice(0, 300);
}
