# @kin/voice: the family office line on the telephone

A small Node HTTP service (`node:http`, `node:crypto`, no Twilio SDK) that implements Twilio's Programmable Voice webhook for the family office line (`docs/feature-proposals.md` section 2, `docs/architecture.md` decision 68).

The conversation is the deterministic intake the web simulator already runs (`takeCall` in `packages/telephony`): a disclosure, five questions in order (caller, organization, amount, purpose, reference), a verdict from `checkClaim` over the circle's record, and one of two fixed replies. No model is in the call path. What the caller says is stored as data and never obeyed. Kin says only the eight fixed sentences of `packages/telephony/src/office-words.ts`.

## See it without Twilio

```
pnpm --filter @kin/voice run simulate-call            # a scam call
pnpm --filter @kin/voice run simulate-call all        # scam, already paid, real bill
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

## Settings

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
6. **Place a real call and check** the items below.

## Not verified without a Twilio account

Everything here is proven against a stand-in that signs requests the way Twilio's documentation says (the worked example in Twilio's own documentation produces the documented signature, in `packages/telephony/src/twilio/signature.test.ts`). These points are the part only a live account proves:

- Twilio accepts the TwiML as written, in particular `actionOnEmptyResult="true"` (so that silence reaches Kin; the `<Redirect>` after `<Gather>` is the fallback) and `timeout`/`speechTimeout="auto"`.
- The voice names. `Polly.Joanna`, `Polly.Lea`, `Polly.Vicki`, `Polly.Bianca` and `Polly.Lucia` are Twilio's standard names for Amazon Polly. Arabic's `Polly.Hala-Neural` (Hala is neural-only) and the language codes `ar-AE` and `he-IL` for speech recognition are unconfirmed. Hebrew has no Polly voice, so its `<Say>` names none and Twilio speaks it with its default voice for `he-IL`, which may sound poor or be unsupported; a live call decides. The names are in `packages/telephony/src/twilio/twiml.ts`.
- The quality of Twilio's speech recognition on names, amounts and references. The amount is read from digits in the transcript (`spokenAmountCents`), so "three hundred" in words is read as no amount, which the verdict treats as unclear.
- The signature under your host's real URL (a proxy that rewrites the scheme, host or port changes the signed URL). `KIN_VOICE_PUBLIC_URL` is what the service signs against.
- That the recording notice in the disclosure satisfies the law where your callers are. Kin keeps a text transcript and no audio.

Known limits: the open-call book is in memory (a restart loses a call abandoned mid-question, and a retry right after a restart could record a finished call twice); if the database fails in a call's last turn the caller hears Twilio's error and the call is recorded on the status callback instead.
