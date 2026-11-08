# Kin: Devpost description (draft)

Nothing about Mom's money without Mom.

## Inspiration

Caring for an aging parent is a financial project that families run with a group chat and one sibling's credit card. About 63 million Americans are family caregivers, nearly one adult in four (AARP and National Alliance for Caregiving, 2025). They spend on average $7,242 a year out of pocket, about a quarter of their income (AARP, 2021). The unpaid care they give was valued at $600 billion a year in the United States alone (AARP, 2023).

The parent is left out too. Most of the 2.2 billion people worldwide with a vision impairment are over 50 (WHO), and payment apps, statements and paper bills are all visual. And Americans aged 60 and over reported nearly $4.9 billion in fraud losses in 2024 (FBI IC3); the typical scam is a call claiming a bill is overdue, to a parent who no longer knows which bills the children have paid.

<!-- owner: add your true personal origin in 2 sentences -->

## What it does

Kin is a shared money layer for a family caring for a parent.

- **A family pool and a written agreement.** Siblings pay into one pool through PayPal. The agreement says the shares, how care hours are valued and who must approve what, and every member accepts each version.
- **Fairness as a payout.** Kin keeps an append-only ledger of money and care time, measures the gap between the agreement and reality, and plans the settlement that closes it, each payment backed by an approval.
- **Caregiver billing.** A caregiver describes their visits in words or by voice; Claude fills in the days, the server values every day, the family reviews the bill and approves it, and PayPal pays the caregiver.
- **The parent has a voice.** Kin reads money events aloud, accepts a spoken yes or no, reads a letter held to the phone, and checks a demand for money against the record.
- **Ask Kin, an agent over the family's record.** A family member or the parent asks in plain words ("Has Amara been paid?", "Who owes whom this month?", "Is a $300 demand from Harbor Gas real?", "Reorder Rose's refill"). Claude chooses which tools to look things up with, including reading a payout's status back from PayPal, and the answer shows the steps it took. It can propose a refill the family already allowed, but it cannot approve, pay or edit anything.
- **Collecting from a sibling by PayPal invoice.** When the month's settlement says Marcus owes the pool $166.00, an organizer sends him a PayPal invoice from the pool, and the ledger credits it only after PayPal reads the invoice back as paid.
- **An audit trail the family can use.** The record is a grid they can filter, group by person or month, total and export, in seven languages.
- **Limits that protect the parent:** double approvals, a fresh multi-factor check before a yes to real money, a pause switch, and a record anyone can verify independently.

The rule throughout: the AI proposes, people approve, and PayPal's own record decides what happened.

## How we built it

**PayPal (sandbox).** Orders v2 with the JavaScript SDK v6 for top-ups, read back from PayPal after capture and confirmed again by verified webhooks. Subscriptions with Catalog products and plans for monthly shares. Payouts for caregiver pay and settlement, recorded as paid only when the batch read back from PayPal shows the item as `SUCCESS`. Webhook signatures are verified with PayPal's verify call on the raw body. Invoicing v2 sends a PayPal invoice from the pool to a sibling and counts it paid only when PayPal reads the invoice back as paid and its capture as completed; the invoice number is the idempotency key, because the sandbox made a second draft for a repeated request ID but refused a repeated number.

**AI.** Claude Opus 4.6 on Amazon Bedrock (InvokeModel), reached only through one package. It reads a caregiver's description of visits, reads a letter or a photograph of one, and words spoken sentences and audit findings. Those calls have no tools, answer in a validated schema, and never compute or decide an amount. A number guard compares every figure the model writes, in digits or in words, in all seven languages, with the record, and falls back to a fixed sentence on a mismatch. Safety decisions such as whether a demand is real are plain code. Every AI result says whether the model was used ("Read by Claude", or "Fixed wording" with the reason), and shows the exact words in the letter that each field was read from.

**Ask Kin is an agent-led loop with deterministic safety boundaries.** Claude decides which of ten tools to call; a gateway checks the person's role through the one authorization function, validates each argument against a schema, allows at most six calls, one proposal, eight seconds a call, and records each call. Nine tools only read (the pool, bills, fairness, the record, the claim check, waiting proposals, and a payout, top-up or subscription status read from PayPal through Kin's own adapter); one raises a refill proposal that still waits for the family's yes. The answer passes the number guard against every figure the tools returned, or Kin falls back to fixed wording built from them. A fixed evaluation set of 12 cases (tool choice, refusals, prompt injection in a question and in a tool result, role limits, number fidelity) scored 12 of 12 on the real model on 8 November 2026, after a first run of 9 of 12 that led us to correct the prompt.

**The money core.** `packages/domain` is pure TypeScript with no I/O: a double-entry ledger in integer cents, the fairness calculation, settlement, state machines that only move forward, and the approval engine. It is covered by unit and property tests.

**AWS.** The web app runs on App Runner and the worker on Fargate, on Aurora Serverless v2 (PostgreSQL) with Cognito for sign-in, SQS and an outbox for work, Secrets Manager, and Amazon Transcribe and Polly for speech. Infrastructure is CDK; GitHub Actions deploys over OpenID Connect. Access is enforced three times: the Cognito group, the member's role in the circle, and PostgreSQL row-level security on every table except `users`.

## What is live and what is simulated

Every PayPal call goes to the sandbox, so no real money moves. Simulated entries are labelled simulated in the ledger and the interface.

| Part | Status |
| --- | --- |
| Top-ups (Orders v2, JS SDK v6, webhooks) | Live, PayPal sandbox |
| Monthly shares | PayPal Subscriptions in real circles; simulated in demo circles |
| Caregiver and settlement payouts | PayPal Payouts in real circles; simulated in demo circles, or paid through the sandbox to Kin's own test account when `KIN_DEMO_SANDBOX_PAYEE_EMAIL` is set on the worker |
| Invoicing requests to siblings (Invoicing v2) | PayPal sandbox in real circles (run end to end on 8 November 2026: a $166.00 invoice sent, paid by a sandbox member and credited once); simulated in demo circles unless a Kin-owned sandbox recipient is configured |
| Refills the parent approves | Simulated, with a stand-in seller |
| Claude on Bedrock | Live |
| Speech (Transcribe, Polly) | Live |
| Family office line (phone) | Built and tested with signed simulated calls; not connected to a phone number |
| Not built | Kin MCP server, PayPal Agent Toolkit, shipment tracking, disputes, refunds |

## Who holds the money

Kin does not take custody of the family's money in a bank account of its own. In this sandbox build every top-up lands in Kin's PayPal account, and Kin's ledger attributes it to the circle. A production launch would use PayPal's multiparty or partner platform (or a licensed partner), so that each circle's funds are held and moved under PayPal's licences, not Kin's. Until then, per-circle attribution in the ledger, payouts bounded by the circle's confirmed balance, and row-level security keep circles apart.

## Challenges we ran into

- **Not knowing whether a payout happened.** A PayPal call that times out leaves the money in an unknown state. Kin marks the execution `unknown`, resends the same idempotency key (PayPal's sandbox refused a repeated batch ID with a 400 and linked the original batch, which is how a lost reply is recovered) and records the payout only when the batch read back from PayPal says `SUCCESS`.
- **Webhook verification.** The signature covers the exact bytes PayPal sent, so the event is stored raw and placed byte for byte in the verification request. A forged webhook sent to the live app was refused by PayPal's verification and stored nowhere; the same event also arrives by read-back, so each entry is written once in either order.
- **Row-level security.** Every table carries its circle and a policy, and every new table needs a test that another circle cannot read or write it. A security review caught a flaw in our first agreement-acceptance rule (an organizer could write themselves the only share and be the only one asked), and a migration replaced it.
- **A fresh multi-factor check on Cognito.** A yes to real money needs a recent sign-in with a second factor. When we built it, Cognito's authentication-context claims were still rolling out, so a real yes is refused unless the claims are present: a limit we record rather than bypass.
- **A model the account could not serve.** Bedrock refused our account the Opus 5.5 endpoint, so we moved to Opus 4.6 through InvokeModel without changing the adapter's contract.

## Accomplishments that we're proud of

Counted on 8 November 2026 from the repository:

- 1,831 unit and integration tests (Vitest) pass across 16 workspaces, from a full `pnpm check` on 8 November 2026 with lint and strict typecheck green (528 in the pure money core, 215 against a real PostgreSQL for isolation between circles and each role's limits), plus 32 Playwright spec files that run the main journeys at four viewport sizes and at 320 pixels.
- 7 languages, including right-to-left Arabic and Hebrew, with parity tests across the dictionaries.
- 11 packages and 4 apps in one TypeScript workspace, 32 database migrations, about 66,000 lines of TypeScript (about 21,000 of them tests).
- A ledger anyone can check offline: `kin-verify` recomputes the hash chain of an exported record and fails if a past entry changed.
- Real sandbox runs of the paths that move money out and in: a payout batch paid by the worker's own code and read back `SUCCESS` on 8 November 2026, and a $166.00 invoice sent, paid by a sandbox member and credited to the ledger exactly once (asking again returned "already recorded").
- One real sandbox top-up through the hosted app on 16 October 2026: $100.00 paid, PayPal took a $3.98 fee, the pool rose by $96.02, and the verified webhook arriving nine seconds later found the entry and wrote nothing.

## What we learned

- Put the model where understanding is needed and keep it away from certainty: every wrong figure we feared was stopped by code that compares the model's words with the record.
- "Done" belongs to PayPal's record, not to our API response. Designing for unknown outcomes first made the rest simpler.
- Say what is simulated. Labelling simulated money in the ledger cost little and made every demo claim defensible.

## What's next

- Move custody to PayPal's partner platform so each circle's funds sit under PayPal's licences.
- Connect the office line to a real phone number and host `apps/voice`.
- Let a real circle raise a refill with a saved PayPal wallet and a fresh multi-factor yes.
- A Kin MCP server and PayPal's Agent Toolkit for outside agents' read access.
- Shipment tracking, disputes and refunds; photographing a receipt.

## Built with

TypeScript, Next.js 16, React 19, Tailwind CSS, shadcn/ui, AG Grid, PostgreSQL 17 and Aurora Serverless v2, Drizzle ORM, PayPal REST APIs (Orders v2, Subscriptions, Payouts, Webhooks) and JavaScript SDK v6, Claude Opus 4.6 on Amazon Bedrock, Amazon Cognito, Amazon Transcribe and Polly, AWS App Runner, ECS Fargate, SQS, Secrets Manager, AWS CDK, GitHub Actions, Twilio Programmable Voice (webhook contract), Vitest, Playwright, Docker, pnpm.

Source and run instructions: README.md. Live demo: https://mzdg4f3stk.us-east-1.awsapprunner.com (press Demo).
