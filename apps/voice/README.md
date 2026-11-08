# @kin/voice: the family office line on the telephone

A small Node HTTP service (`node:http`, `node:crypto`, no Twilio SDK) that implements Twilio's Programmable Voice webhook for the family office line (`docs/feature-proposals.md` section 2, `docs/architecture.md` decision 68).

The conversation is the deterministic intake the web simulator already runs (`takeCall` in `packages/telephony`): a disclosure, five questions in order (caller, organization, amount, purpose, reference), a verdict from `checkClaim` over the circle's record, and one of two fixed replies. No model is in the call path. What the caller says is stored as data and never obeyed. Kin says only the eight fixed sentences of `packages/telephony/src/office-words.ts`.

The same service also answers Kin's own call to a parent about a shift (see "Kin's call to the parent about a shift" below). That call is placed by the worker; this service only answers Twilio's two webhooks for it.

## See it without Twilio

```
pnpm --filter @kin/voice run simulate-call            # a scam call
pnpm --filter @kin/voice run simulate-call shift      # Kin's call to a parent about a shift (below)
pnpm --filter @kin/voice run simulate-call all        # scam, already paid, real bill, and the shift calls
```

It starts the service on a free local port and plays a call against it as Twilio would, signing every request with a demo auth token. It prints each TwiML answer, the sentences Kin says, and what would be recorded and told to the family. It needs no account, no database and no network.

## The contract

| Route | Twilio setting | Does |
|---|---|---|
| `POST /voice/incoming` | the number's "A call comes in" webhook, HTTP POST | Picks the circle from `To`, says the disclosure and the first question, listens |
| `POST /voice/turn?s=<sealed state>` | none: Kin names it in its own TwiML | Takes the caller's answer (`SpeechResult`) and asks the next question, or gives the reply and hangs up |
| `POST /voice/status` | the number's "Call status changes" webhook, HTTP POST | Records a caller who hung up after giving something |
| `GET /health` | the load balancer's health check | `ok` |

Every POST is checked against `X-Twilio-Signature` (HMAC-SHA1 of the full URL plus the sorted fields, constant-time compare) before anything is read, stored or acted on. A request that fails gets a bare `403 Forbidden`. A body over 16 KB, a field over 4 KB, a repeated field or a malformed `CallSid` or number is refused.

**Which circle.** Only the dialled number (`To`) picks the circle, through configuration. The caller's number is recorded as data on the call and decides nothing. An unknown number hears the fixed "no record" sentence and the line drops. The service acts as `kin_service` scoped to that one circle (`asService`); the database function `kin_private.record_office_line_call` (migration 0027) refuses any other circle.

**State between turns.** Twilio calls Kin afresh for every answer. The state (the caller's answers so far, the silence count, the circle, the call's `CallSid`, an expiry) rides in the `s` parameter of the next turn's address, sealed with HMAC-SHA256 under `KIN_VOICE_STATE_KEY`. It cannot be changed, it is bound to its call and its number, it expires in an hour, and it survives a restart or a second task. A small in-memory book of open calls serves the two things the token cannot: a caller who hangs up mid-question (Twilio's status report carries no token) and a retried request that must not record a call twice. See the comment in `src/call-book.ts` for what a restart loses.

**What is recorded.** When the intake ends, or the caller hangs up having said something, the call is recorded once: the `office_calls` row (never labelled simulated, even in a demo circle), the claim check, a queued alert for every member who sees the circle's money, and an audit entry by the `service` with origin `phone`. The call then appears in the dashboard's recent calls. A call where the caller said nothing records nothing.

## Kin's call to the parent about a shift

When a caregiver ends a visit and the family's word on it is still missing, Kin can phone the parent and ask one question: "Was Amara with you this morning?" Her yes, by voice or by pressing 1, is the family's second key on the shift, recorded as the parent's word with the call's ID as its evidence; the shift is then confirmed and its settling is queued for the worker (`shift.settle`). A no records a declined call and pays nothing. Silence or an answer Kin cannot understand, twice, records nothing: the family decides.

The worker (`apps/worker`, `shift.call` messages) places the call through Twilio's REST API. This service answers the two webhooks. Nothing is configured in the Twilio console for the number: for an outbound call Kin gives Twilio the `Url` and the `StatusCallback` in each `Calls.create` request, so the Voice configuration of Kin's number is not used.

| Route | Given to Twilio as | Does |
|---|---|---|
| `POST /voice/shift/answer?s=<sealed token>` | the call's `Url` | When the parent picks up: says who Kin is and asks the question (the first request), then takes her answer, by speech or keypad, and says the closing words. Records her yes or no. |
| `POST /voice/shift/status?s=<sealed token>` | the call's `StatusCallback`, for `answered` and `completed` | Records how the call ended: unanswered, busy, failed, or picked up with no word. Progress reports (`ringing`, `in-progress`) record nothing. |

Both routes are served only when the service has a database store for them, which `main.ts` always gives it. A request is handled in this order, and each step ends it:

1. **Twilio's signature** over the exact address (query included) and fields is checked before anything else is read. A failure gets the same bare `403 Forbidden` as on the office line.
2. **The sealed token** in `s` must open under `KIN_VOICE_STATE_KEY`, be of the shift call's kind and be less than 20 minutes old. It names the circle, the shift, the attempt and the language, and nothing else: never a name, a number or an amount. A forged or old token gets a fixed English sorry and a hang-up on the answer route, and an empty answer on the status route. Nothing is recorded.
3. **The database**, as `kin_service` for the one circle the verified token names (`asService`), finds the attempt the token names and holds the request's `CallSid` to the ID recorded on it. A `CallSid` that belongs to another shift, another attempt or another circle is refused (the answer route says the fixed sorry, the status route answers `403`) and nothing is recorded. Twilio can post its first request before the worker has stored the call's ID, so an attempt still waiting for its ID takes the first webhook's (the same `recordCallPlaced` operation the worker uses, which changes nothing if said again).
4. **The record** supplies the caregiver's first name, the part of the day and the family contact's name that the sentences use. Never the token, never the request.

**Which circle.** This is the one place the service acts for many circles, and the circle comes from a verified sealed token plus the database's own checks (every operation refuses any circle but the one in scope, and a call that is not Kin's for that shift). The office line is unchanged: its circle still comes only from the dialled number in `KIN_OFFICE_LINE_NUMBERS`, one number per circle, and a shift call's token is refused on its routes.

**What is recorded, and when.** Only a clear yes or no is a word. The question just asked, the question asked again after silence, and a still unclear answer record nothing about the shift. A machine or fax answering (`AnsweredBy`) is hung up on without a word and recorded as unanswered. A call she picked up that ends with no word is recorded as failed, so the database can queue the second attempt (a second attempt is made once, thirty minutes after the first ended). A repeat of any Twilio request changes nothing: the database keys the word by the call and records it once. If the database refuses her yes (the call was switched off while she listened, the parent is no longer the parent), she is not told it was kept: she hears the fixed sorry.

**Consent and quiet hours.** The parent switches the call on herself, in the app, with her consent on record (who gave it and when); only then is a call ever placed, and only to the number she set. The organizer can switch it off at any time. Kin says who it is and that she can hang up at the start of every call. No call is placed in the circle's quiet hours (21:00 to 08:00 on the circle's own clock by default): the worker waits until they end. A demo circle never has a real call placed. Kin leaves no message on a voicemail.

**Double calls and lost callbacks.** Twilio's `Calls.create` has no idempotency key, so the worker writes the attempt (`queued`) in the database before dialling, and the database refuses another call for the shift while one is queued, calling or answered. A crash between the dial and recording its ID, or an error that says a call may have been placed, never leads to a second dial. A status callback that never arrives is covered by the worker: it gives up on an attempt that has had no report for 30 minutes, which queues the second attempt. See `apps/worker/src/shifts/place-call.ts`.

**The first request of a call is told from the later ones by the database, not the request.** The first answer request and a Gather result for a silent parent look alike (neither carries `Digits` or `SpeechResult`). The attempt's state tells them apart: `calling` with nothing heard is the first request, which asks the question and records the call as `answered`; every later request is an answer to a question already asked. The cost: if Twilio redelivers the very first request after the question was asked, the parent hears "Sorry, I did not catch that" and the question again, once.

## Settings

The phone service needs nothing new for the shift call: it reads the database as the service role and verifies signatures with the settings below. The worker has five new settings (all needed to place the call), and the call loop stays off, with one line in the worker's startup log naming what is missing, unless all five are set:

| Variable | Read by | Meaning |
|---|---|---|
| `KIN_TWILIO_ACCOUNT_SID` | worker | The Twilio account (`AC` and 32 hex characters) the calls are placed from |
| `KIN_TWILIO_AUTH_TOKEN` | worker and phone service | The account's auth token: the worker authenticates `Calls.create` with it, the phone service verifies every webhook with it. Secret |
| `KIN_TWILIO_CALLER_NUMBER` | worker | Kin's own Twilio number in E.164 form: the caller ID the parent sees |
| `KIN_VOICE_PUBLIC_URL` | worker and phone service | The https address of this service with no path. The worker builds the call's addresses from it, and the service rebuilds the signed URL from it |
| `KIN_VOICE_STATE_KEY` | worker and phone service | At least 32 characters, different from the auth token, **the same value in both**. The worker seals the call's token with it and the service opens it. Secret |


The settings of the office line itself:

| Variable | Meaning |
|---|---|
| `KIN_OFFICE_LINE_NUMBERS` | JSON: `{"+15551234567": "<circle uuid>"}`. A value may be `{"circleId": "<uuid>", "locale": "fr"}` to answer in `en`, `fr`, `de`, `it`, `es`, `ar` or `he` (default `en`). E.164 numbers only; one number per circle |
| `KIN_TWILIO_AUTH_TOKEN` | The Twilio account's auth token. It signs every webhook. Secret |
| `KIN_VOICE_STATE_KEY` | At least 32 characters, different from the auth token. Seals the state between turns. Secret |
| `KIN_VOICE_PUBLIC_URL` | The https address Twilio calls, no path (for example `https://voice.example.com`). Twilio signs the URL it called, so this must match it exactly |
| `PORT` | Default `4200` |
| `KIN_DATABASE_*` | The database host and the `kin_service` password, as for the worker (`.env.example`) |

The service refuses to start on a missing or malformed setting. Secrets belong in AWS Secrets Manager and reach the task as environment variables, as the worker's do; none is in the repository, the image or a log. Logs carry masked numbers (`+1********99`), call IDs and circle IDs, never the caller's words.

## What the owner still has to do

None of this exists yet, and none of it has been done by this change:

1. **A Twilio account and a voice-capable number** (a number per circle; the map allows several).
2. **Store the secrets.** Generate a state key (`openssl rand -base64 48`) and put it and the account's auth token in Secrets Manager.
3. **Host the service** over https at a stable address. Build the image with `docker build -f apps/voice/Dockerfile .` (add `--platform linux/amd64` on an Arm machine). No CDK stack is added: the worker's Fargate pattern needs a public listener with a certificate, which Kin has no domain for yet (decision 35). App Runner, as the web app uses, would serve https at its own address. Any hosting change is a `AGENTS.md` section 12 matter.
4. **Point the number at it.** In the Twilio console, under the number's Voice configuration: "A call comes in" is a Webhook, `POST`, `https://<voice host>/voice/incoming`; "Call status changes" is `POST`, `https://<voice host>/voice/status`. Set `KIN_VOICE_PUBLIC_URL` to `https://<voice host>`.
5. **Fill `KIN_OFFICE_LINE_NUMBERS`** with the number and the circle's ID.
6. **For the shift call to the parent**, give the worker the five settings above (account SID, auth token, caller number, this service's public address and the same state key as this service) and store the secrets in Secrets Manager like the others. Nothing is configured on the number for the outbound call. The Twilio account must be allowed to call the parent's country (geographic permissions; a trial account calls only verified numbers).
7. **Place a real call and check** the items below.

Nothing hosts this service yet and no Twilio account exists for Kin yet: the shift call is built and tested against stand-ins, not deployed.

## Not verified without a Twilio account

Everything here is proven against a stand-in that signs requests the way Twilio's documentation says (the worked example in Twilio's own documentation produces the documented signature, in `packages/telephony/src/twilio/signature.test.ts`). These points are the part only a live account proves:

- Twilio accepts the TwiML as written, in particular `actionOnEmptyResult="true"` (so that silence reaches Kin; the `<Redirect>` after `<Gather>` is the fallback) and `timeout`/`speechTimeout="auto"`.
- The voice names. `Polly.Joanna`, `Polly.Lea`, `Polly.Vicki`, `Polly.Bianca` and `Polly.Lucia` are Twilio's standard names for Amazon Polly. Arabic's `Polly.Hala-Neural` (Hala is neural-only) and the language codes `ar-AE` and `he-IL` for speech recognition are unconfirmed. Hebrew has no Polly voice, so its `<Say>` names none and Twilio speaks it with its default voice for `he-IL`, which may sound poor or be unsupported; a live call decides. The names are in `packages/telephony/src/twilio/twiml.ts`.
- The quality of Twilio's speech recognition on names, amounts and references. The amount is read from digits in the transcript (`spokenAmountCents`), so "three hundred" in words is read as no amount, which the verdict treats as unclear.
- The signature under your host's real URL (a proxy that rewrites the scheme, host or port changes the signed URL). `KIN_VOICE_PUBLIC_URL` is what the service signs against.
- That the recording notice in the disclosure satisfies the law where your callers are. Kin keeps a text transcript and no audio.

What only a live account proves about the shift call (the list is the header of `packages/telephony/src/shift-call/shift-call-twiml.ts`, with one more):

- that Twilio accepts the voice and language pair for each locale (Hebrew above all) and that the Arabic Neural voice is enabled for the account;
- that speech recognition in he-IL, ar-AE and the others returns the words in the lexicon's spelling (the parent can always press 1 or 2). Hebrew speech recognition may need the keypad: Twilio's coverage of he-IL for `<Gather input="speech">` is not confirmed;
- that `hints` is honoured for Arabic and Hebrew (the page does not say);
- that `AnsweredBy` arrives at the answer webhook when machine detection is on, and how often a voicemail greeting is taken for a person;
- that the signature Twilio puts on the answer and status requests matches what `verifyTwilioSignature` computes for these query-carrying addresses;
- that an outbound call from the account's number is delivered to a real handset in each country, with its caller ID, and that the account is permitted to call it (geographic permissions, trial restrictions);
- that Twilio sends the `answered` and `completed` status callbacks to the `StatusCallback` address as `Calls.create` documents, and that a Gather result for a silent parent really carries neither `Digits` nor `SpeechResult` (the service tells the first request from later ones by the attempt's state, so it does not depend on it, but the "asked again" wording does).

Known limits: the open-call book is in memory (a restart loses a call abandoned mid-question, and a retry right after a restart could record a finished call twice); if the database fails in a call's last turn the caller hears Twilio's error and the call is recorded on the status callback instead.
