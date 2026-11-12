# Kin: Devpost description

**Tagline:** Nothing about Mom's money without Mom. A family money pool on PayPal where Claude proposes, people approve, and PayPal's record decides.

**Try it (no account):** https://mzdg4f3stk.us-east-1.awsapprunner.com → **Try the demo**. PayPal sandbox buyer: `sb-myskz53353349@personal.example.com` / `G_8h$[X+`.

## Inspiration

Rose is 81. Her three children share the cost of her care through a group chat and one sibling's credit card. Nobody can see who has carried what. Amara, her caregiver, is paid late and informally. And Rose, who can no longer read a bank statement, hears about her own money last: usually from a scammer calling to say a bill is overdue.

That family is common. About 63 million Americans are family caregivers, spending on average $7,242 a year of their own money (AARP). Americans over 60 reported $4.9 billion in fraud losses in 2024 (FBI IC3). The tools that exist either watch the money and cannot move it, or split a bill and leave the settling to someone else. None puts the parent at the center.

## What it does

Kin is one family pool on PayPal, run as one month in five moments:

1. **Marcus tops up the pool through PayPal.** PayPal's own checkout (JavaScript SDK v6, Orders v2). Kin writes the ledger only after reading the order back from PayPal.
2. **Amara says her hours, and Claude reads them.** "Monday and Tuesday, four hours each" becomes days and minutes, each with her own words as evidence; the server values every day at the agreed rate.
3. **Rose says yes, by voice.** Her approval rules come from the family's written agreement: above $50, Rose decides; nobody approves a payment to themselves.
4. **PayPal pays Amara.** PayPal Payouts, recorded as paid only when the payout item read back from PayPal says `SUCCESS`.
5. **Rose hears it.** "Amara has been paid $264.00 for the visits." One calm sentence, in very large type, read aloud.

Around that month:

- **An agent that buys within Rose's rules.** Ask Kin to reorder Rose's refill: Claude raises it, Rose's own standing permission approves it, the pharmacy charges her saved card through PayPal, and Kin records the charge only from PayPal's record. Ask it to "Pay Amara now" and it refuses: no tool it holds pays.
- **Kin takes the scam call.** A caller demands $300 for the gas bill; plain code checks the claim against the record (the last bill, $57.00, was paid on Oct 14) and tells the family.
- **Fairness as a payout.** Each sibling's share of money and care time, measured against what the family agreed, and settled with a real payment.
- **Open Kin.** A member's own AI assistant reaches the circle through Kin's MCP server, with a scoped, expiring token that can read and propose but never approve.

The rule throughout: **the AI proposes, people approve, and PayPal's own record decides what happened.**

## How we built it

**PayPal moves every dollar and is the record Kin treats as the truth.**

| Family need | PayPal | In the demo |
| --- | --- | --- |
| A sibling tops up | Orders v2 + JavaScript SDK v6, Pay Later where offered | PayPal sandbox |
| The caregiver is paid | Payouts, batch and item read back | PayPal sandbox |
| Rose's refill is bought | Orders v2 with a vaulted card, by a separate merchant app | PayPal sandbox |
| A sibling is asked to pay a share | Invoicing v2 | PayPal sandbox |
| Monthly shares | Subscriptions, Catalog products, Plans | Ran in the sandbox; simulated in demo circles |
| Refunds, reconciliation | Payments v2 read-back, Transaction Search | Ran in the sandbox |
| Every event | Webhooks verified with `verify-webhook-signature` on the exact bytes | Live |
| The agent reads PayPal | **PayPal Agent Toolkit**, read actions only | Live |

Nothing is recorded from an API response alone. A webhook's raw bytes are queued before PayPal hears 200, verified with PayPal, and the resource is read back again. A call that times out makes the execution `unknown`: Kin asks PayPal and waits, never retrying blindly. Running against the real sandbox found three bugs we fixed: a subscription price change PayPal refuses, a product that could be created twice, and request IDs sent to endpoints that ignore them.

**Claude Opus 4.6 on Amazon Bedrock reads and words; it never decides an amount.** Every extraction has no tools and answers in a validated schema, traced back to the source words. Ask Kin is a real tool loop over fourteen tools, behind a gateway that checks the person's role through the one authorization function, validates each argument, and bounds calls, time and result size. A number guard checks every figure Claude writes, in seven languages, against what the tools returned for that person, and falls back to fixed wording on any mismatch. If Claude is unavailable, plain code still answers the common questions through the same gateway. The fixed evaluation set passes **27 of 27** on the real model, including multi-step questions, prompt injection inside tool results, and every role's refusals.

**The money core is deterministic.** `packages/domain` is pure TypeScript: integer cents, double entry, fairness, settlement, forward-only state machines and the approval engine. PostgreSQL enforces it again: append-only triggers, a balance check at commit, unique idempotency keys, and row-level security on every table, with a test that reads each table from another circle and expects nothing. A hash chain lets `kin-verify` prove offline that no past entry changed.

**AWS:** App Runner (web, voice, demo pharmacy), Fargate (worker), Aurora Serverless v2, Cognito, SQS, Secrets Manager, Transcribe and Polly, all in CDK and deployed by GitHub Actions through OpenID Connect.

## Challenges we ran into

- **Not knowing whether money moved.** We designed for the unknown outcome first. PayPal's sandbox refuses a repeated payout batch ID with a 400 that names the original batch; that is how Kin recovers a lost reply without paying twice.
- **An agent that buys, without an agent that pays.** The pharmacy's PayPal app owns the order, so Kin cannot read it. The pharmacy exposes a signed read-back, and the worker records the charge only when order, capture, status and the exact amount all match.
- **The AI answered a question it was not asked.** On the real model, a caregiver asking for PayPal's record of a top-up got her own payout instead. The evaluation set caught it; the prompt now says first what a seat cannot see.
- **Our deploy rolled back the night before submission.** The worker's image lacked one package. CI now loads every worker module inside the built image.

## Accomplishments that we're proud of

- A parent who cannot read a screen can still run her own affairs, by voice.
- An outside assistant, Claude Code, read a family's record and PayPal's status of a real top-up through Kin's MCP server, and could not approve anything.
- Nearly 3,500 unit and integration tests, Playwright at four viewport sizes with WCAG 2.2 AA checks, zero `any`, seven languages including Arabic and Hebrew.

## What we learned

Put the model where understanding is needed and keep it away from certainty. "Done" belongs to PayPal's record, not to our API response. And say what is simulated: labelling it cost little and made every claim in the demo defensible.

## What's next

A pilot with real families; custody through PayPal's multiparty platform so each circle's funds sit under PayPal's licences, not Kin's; disputes in the ledger; cross-border circles for families who live apart.

## Built with

TypeScript, Next.js 16, React 19, Tailwind CSS, shadcn/ui, AG Grid, AG Studio, Bryntum Scheduler, PostgreSQL 17 and Aurora Serverless v2, Drizzle ORM, PayPal REST APIs (Orders v2, Payments v2, Payouts, Vault, Subscriptions, Catalog, Invoicing v2, Transaction Search, Webhooks), the PayPal JavaScript SDK v6, the PayPal Agent Toolkit, Claude Opus 4.6 on Amazon Bedrock, Model Context Protocol, Amazon Cognito, Transcribe and Polly, Twilio Programmable Voice, AWS App Runner, ECS Fargate, SQS, Secrets Manager, AWS CDK, GitHub Actions, Vitest, Playwright, axe-core.

## AI tools used

- **Claude Opus 4.6 on Amazon Bedrock** (InvokeModel, through the Anthropic Bedrock SDK): Ask Kin's tool loop, the calendar assistant and the money studio's agent; reading caregivers' visit descriptions, letters and photographs, scam-call accounts, sealed offers, wishes and gifts (structured output); wording spoken sentences.
- **PayPal Agent Toolkit:** Ask Kin's reads of PayPal's own record (orders, invoices, disputes), read actions only.
- **Amazon Transcribe and Amazon Polly:** speech to text for a spoken yes or no; text to speech for what Kin tells the parent.
- **Claude Code:** the coding assistant used to build Kin.

## Testing instructions

1. Open https://mzdg4f3stk.us-east-1.awsapprunner.com and press **Try the demo**. You get your own copy of the circle; **Start again** gives a fresh one.
2. Follow the five-step guide under the banner. Each step says whether it is **PayPal sandbox**, **Claude** or simulated.
3. For the top-up, pay with the PayPal sandbox buyer `sb-myskz53353349@personal.example.com` / `G_8h$[X+`.
4. To run it locally, see README.md, "Getting started".

## When it was built

Kin was started for this hackathon: the first commit is dated 14 October 2026, inside the submission period.
