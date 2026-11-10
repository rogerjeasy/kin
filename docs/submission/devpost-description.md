# Kin: Devpost description

**Tagline:** Nothing about Mom's money without Mom. A family money pool on PayPal, where Claude proposes, people approve and PayPal's record decides.

## Inspiration

Rose is 81. Her three children share the cost of her care through a group chat and one sibling's credit card. Nobody can see who has carried what, the caregiver is paid late and informally, and Rose, who can no longer read a bank statement, hears about her own money last, usually from a scammer who calls to say a bill is overdue.

That family is common. About 63 million Americans are family caregivers, spending on average $7,242 a year of their own money (AARP). Americans over 60 reported $4.9 billion in fraud losses in 2024 (FBI IC3). The tools that exist either watch the money and cannot move it (Carefull, EverSafe), or split a bill and hand the settling to someone else (Splitwise and the sibling apps). None puts the parent at the center.

## What it does

Kin is a shared money layer for a family caring for a parent, built on PayPal and Claude.

- **One family pool, paid in through PayPal.** Siblings top up with PayPal checkout (Orders v2 and the JavaScript SDK v6) or a monthly PayPal subscription. A sibling who owes the pool gets a PayPal invoice.
- **Fairness as a payout.** A written family agreement sets each share and values care hours. Kin's money core measures the gap between the agreement and what each person gave, in money and in time, and plans the PayPal payouts that close it.
- **The caregiver is paid the same week.** Amara describes her visits in her own words; Claude reads them into days and hours, the server values every day, the family approves, and PayPal Payouts pays her.
- **Rose hears every dollar.** Her first screen is Listen: each confirmed payment in one calm sentence, read aloud. She approves by voice, holds a letter up to the camera and hears it read, and has her own Purse for gifts.
- **Kin takes the scam call.** The family office line answers a caller demanding money, checks the claim against the record with plain code, and tells the family. "Is it really you?" texts the real grandson before anything is sent.
- **Ask Kin, an agent over the record.** Claude chooses among eleven tools to answer "Has Amara been paid?", "Who owes whom?" or "Is a $300 demand from Harbor Gas real?", and shows each step it took. Asked to "Pay Amara now", it refuses: no tool it holds moves money.
- **Open Kin.** A family member's own AI assistant (Claude Code, Claude Desktop) reaches the circle through Kin's MCP server, with scoped, expiring tokens that can read and propose but never approve. Home-care agencies report visits through a signed API.
- **A record that proves itself.** An append-only, double-entry ledger in an AG Grid audit view, exports in CSV and JSON, and `kin-verify`, which recomputes the hash chain offline.

The rule throughout: **the AI proposes, people approve, and PayPal's own record decides what happened.**

## How we built it

**PayPal is the system that moves every dollar and the record Kin treats as the truth.** Kin calls 22 PayPal endpoints from one package: Orders v2 and Payments v2 (create, capture, read back), Payouts (batch and item read-back), Subscriptions with Catalog products and plans (create, read, transactions, suspend, activate, cancel, revise), Invoicing v2, Transaction Search for nightly reconciliation, webhook verification and OAuth. Nothing is recorded from an API response: a top-up is written only after the worker reads the order back from PayPal, a payout only when the batch reads `SUCCESS`, an invoice only when PayPal reads it paid. A webhook's raw bytes are queued before PayPal hears 200, verified with PayPal on the exact bytes, and then the resource is read back again. A refund PayPal reports is read back from PayPal and reverses the top-up only when the reversal is exact; a partial refund waits for a person. A call that times out makes the execution `unknown`; Kin resends the same idempotency key and asks PayPal, never retrying blindly.

**Claude Opus 4.6 on Amazon Bedrock reads and words; it never decides an amount.** Twelve versioned prompts read caregivers' words, letters and photographs, a parent's spoken wishes and gifts, and word answers in seven languages. Every extraction has no tools and answers in a validated schema; every field is traced back to the source words, and a photographed amount is kept only if it appears in the words Claude says it read. A number guard compares every figure the model writes, in digits or in words, with the record, and falls back to fixed wording on any mismatch. Ask Kin is a real tool loop behind a gateway that checks the person's role through the one authorization function, validates each argument, and bounds calls, time and result size. Eight fixed evaluation sets run against the real model, with dated results in the repository: Ask Kin 15 of 15 (including prompt injection in a question and in a tool result), visits 12 of 12 and documents 8 of 8 (two of them photographs) on 10 November 2026.

**The money core is deterministic.** `packages/domain` is pure TypeScript with no I/O: integer cents, double entry, fairness, settlement, forward-only state machines and the approval engine, where nobody is the sole approver of a payment to themselves. PostgreSQL enforces it again: append-only triggers, a balance check at commit, unique idempotency keys, and row-level security on every table, with a test that reads each table from another circle and expects nothing.

**AWS.** App Runner for the web app and the voice service, Fargate for the worker, Aurora Serverless v2, Cognito with a fresh multi-factor check before a yes to real money, SQS FIFO, Secrets Manager, Transcribe and Polly, all in CDK and deployed by GitHub Actions through OpenID Connect.

## What is live and what is simulated

Every PayPal call goes to the sandbox. In the hosted demo, the family's history is simulated and labelled "Simulated"; a top-up a judge makes goes through PayPal's real sandbox checkout and is labelled "PayPal sandbox". Orders, Payouts and Invoicing have each been run end to end against the sandbox through Kin's own code, with recorded responses in the repository. Monthly subscriptions are wired and unit-tested against PayPal's documented shapes but have not yet been run through Kin's adapter. Refills the parent approves are bought from a simulated pharmacy. The phone service is hosted; a call through a real Twilio number has not yet been verified.

## Challenges we ran into

- **Not knowing whether money moved.** We designed for the unknown outcome first. PayPal's sandbox refuses a repeated payout batch ID with a 400 that links the original batch, and that is how Kin recovers a lost reply without paying twice.
- **Webhook signatures cover exact bytes**, so the web tier stores nothing and queues the raw delivery; a forged webhook sent to the live app was refused by PayPal and written nowhere.
- **A structured-output schema with limits is refused by the API**, while a fake model accepts it. Our shared fake now refuses such schemas, so a unit test catches what would fail every real call.
- **Bedrock did not serve our account the newest model**, so we moved to Opus 4.6 through InvokeModel without changing the adapter's contract, and re-ran every evaluation.

## Accomplishments that we're proud of

- 3,303 unit and integration tests pass across 16 workspaces, with lint and strict TypeScript green and zero `any`; 596 Playwright tests in 45 specs check every screen at four viewport sizes and at 320 pixels for overflow, the security headers, and WCAG 2.2 AA with axe.
- Seven languages, with Arabic and Hebrew right to left, and identical key sets enforced by a test.
- A parent who cannot read a screen can still run her own affairs.

## What we learned

Put the model where understanding is needed and keep it away from certainty. "Done" belongs to PayPal's record, not to our API response. And say what is simulated: labelling it cost little and made every claim in the demo defensible.

## What's next

A pilot with real families; custody through PayPal's partner platform so each circle's funds sit under PayPal's licences; a real circle's refill bought with a saved PayPal wallet under the parent's spoken mandate; PayPal disputes in the ledger; cross-border circles.

## Built with

TypeScript, Next.js 16, React 19, Tailwind CSS, shadcn/ui, AG Grid Community, Bryntum Scheduler, PostgreSQL 17 and Aurora Serverless v2, Drizzle ORM, PayPal REST APIs (Orders v2, Payments v2, Payouts, Subscriptions, Catalog, Invoicing v2, Transaction Search, Webhooks) and the PayPal JavaScript SDK v6, Claude Opus 4.6 on Amazon Bedrock, Amazon Cognito, Transcribe and Polly, Twilio Programmable Voice, AWS App Runner, ECS Fargate, SQS, Secrets Manager, AWS CDK, GitHub Actions, Vitest, Playwright, axe-core.

## AI tools used

- **Claude Opus 4.6 on Amazon Bedrock** (InvokeModel, through the Anthropic Bedrock SDK): Ask Kin's tool loop and the calendar assistant; reading caregivers' visit descriptions, letters and photographs, scam-call accounts, sealed offers, wishes and gifts; wording spoken sentences, audit findings and shift questions.
- **Amazon Transcribe and Amazon Polly:** speech to text for a spoken yes or no and spoken wishes; text to speech for what Kin tells the parent.
- **Claude Code:** the coding assistant used to build Kin.

## When it was built

Kin was started for this hackathon: the first commit is dated 14 October 2026, inside the submission period.

Source and run instructions: README.md. Live demo: https://mzdg4f3stk.us-east-1.awsapprunner.com (press "Try the demo").
