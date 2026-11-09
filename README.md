# Kin

Kin is a shared money layer for families who care for an aging parent. Siblings pay into one family pool through PayPal, a written family agreement says how the cost is shared, and Kin keeps an append-only ledger of who gave what (in money and in care time) and plans the payments that bring everyone back to their agreed share. The parent stays part of every decision: Kin reads money events aloud and accepts a spoken yes or no. The rule throughout is that the AI proposes, people approve, and PayPal's own record decides what actually happened. Built for the PayPal AI Hackathon 2026, in the PayPal sandbox with test money.

**Live demo:** https://mzdg4f3stk.us-east-1.awsapprunner.com. Press **Demo** to get your own copy of a sample family's circle (Rose and her three children), with no account needed.

## What is live and what is simulated

Nothing here moves real money: every PayPal call goes to the PayPal sandbox. Within that, this table separates what reaches PayPal from what is a stand-in. The ledger and the interface label simulated entries as simulated.

| Part | Status | What it does |
| --- | --- | --- |
| Top-ups to the pool | **Live, PayPal sandbox** | Orders v2 and the PayPal JavaScript SDK v6 ("Add money"). The order is read back from PayPal after capture, and verified webhooks confirm it again. Needs a PayPal sandbox buyer account. |
| Monthly shares | **Live in real circles, simulated in demo circles** | A real circle's share is a PayPal Subscription (Catalog product and one plan per amount) the member approves at PayPal; charges are read back from PayPal. A demo circle's share is simulated and never calls PayPal. |
| Caregiver payouts and settlement payouts | **Live in real circles, simulated in demo circles** | PayPal Payouts, recorded as paid only when the payout batch read back from PayPal shows the item as `SUCCESS`. A demo circle's payout is written to the ledger as simulated and sends nothing, unless the worker is given `KIN_DEMO_SANDBOX_PAYEE_EMAIL` (built in this branch): it then pays an approved demo caregiver payout through PayPal's sandbox to Kin's own test account, never to an address a visitor typed, at most a set number a day, and falls back to simulated if PayPal refuses. |
| Invoicing requests to siblings | **Live in real circles, simulated in demo circles unless configured** | PayPal Invoicing v2 creates, sends, reads back and cancels an invoice from the pool; a request counts as paid only when PayPal reads the invoice back as paid and the capture reads back as completed. Run end to end against the sandbox on 8 November 2026: a $166.00 settlement invoice was sent, paid by a sandbox member and credited to the ledger once (`packages/paypal/src/fixtures/invoice-sandbox-2026-11-08.json`). A demo circle's request is simulated and labelled so, unless `KIN_DEMO_INVOICE_RECIPIENT_EMAIL` names a sandbox account of Kin's own. |
| Refills the parent approves by voice | **Simulated** | A stand-in seller simulated in process (or the demo pharmacy service, `apps/demo-merchant`, when configured). A real circle cannot raise a refill. The saved-wallet charge exists in the demo pharmacy, written against the sandbox, but no hosted flow uses it. |
| Claude on Amazon Bedrock | **Live** | Opus 4.6 through InvokeModel, switched on in the hosted app (`kin:claude` is `true`). Reads a caregiver's description of visits, reads a letter, and words spoken sentences and audit findings; see "The AI". |
| Speech | **Live** | Amazon Transcribe (speech to text) and Amazon Polly (text to speech), in the app on the Bills and Approvals screens. |
| Family office line (phone) | **Built, simulated** | `apps/voice` implements Twilio's Programmable Voice webhook and is tested with signed simulated calls (`pnpm --filter @kin/voice run simulate-call`). The web app has a simulator screen. It is not connected to a phone number and is not hosted. No model is in the call path. |
| Sign-in | **Live** | Amazon Cognito (PKCE), with a fresh multi-factor check before a yes to real money. Demo visitors need no account. |
| Not built | | OAuth for the Kin MCP server (it authenticates with delegation tokens a member grants; decision 93), the PayPal Agent Toolkit and PayPal's MCP server, shipment tracking, disputes, refunds, Transaction Search, Log in with PayPal, invoice reminders, photographing a receipt. `docs/architecture.md` marks each one "Planned, not built". |

## Judge quick start

**Hosted demo (about two minutes, no account).**

1. Open https://mzdg4f3stk.us-east-1.awsapprunner.com and press **Demo**. You get your own isolated copy of Rose's circle.
2. Use the role switcher to see the app as the organizer, a sibling, the parent and the caregiver. Approve or decline a proposal, open **Fairness** for the month's settlement, open **Record** for the ledger and its CSV, JSON and audit exports, and use the office-line simulator.
3. Money in the demo is simulated and labelled so. To see PayPal itself, press **Add money** on the overview: it opens PayPal's real sandbox checkout, even from a demo circle (a payment PayPal confirms is recorded as real sandbox money, not simulated). Pay with the sandbox buyer account below. The top-up appears in the record only after Kin has read the order back from PayPal, and PayPal's fee is shared by the circle.

**PayPal sandbox buyer for the top-up.**

<!-- owner: paste sandbox buyer email/password here -->

(Until the owner pastes the sandbox buyer account here, a judge can use any PayPal sandbox personal account of their own from https://developer.paypal.com/dashboard/accounts.)

**Run it locally.** See "Getting started" below: `pnpm install`, `pnpm db:up`, migrate, copy the two `.env` files, `pnpm --filter @kin/web dev`, then press **Demo** at http://localhost:3000. Top-ups locally also need the queue stand-in and the worker, and PayPal sandbox app credentials of your own.

## PayPal APIs the code calls

Every call is in `packages/paypal` (the only code that talks to PayPal), except the browser SDK and the demo pharmacy.

- **Orders v2** (`/v2/checkout/orders`, create, read, capture) with the **PayPal JavaScript SDK v6** for top-ups, including Pay Later where PayPal offers it, and **Payments v2** (`/v2/payments/captures`) to read a capture back.
- **Subscriptions** (`/v1/billing/subscriptions`, `/v1/billing/plans`, and their transactions) with the **Catalog Products** API (`/v1/catalogs/products`) for monthly shares.
- **Payouts** (`/v1/payments/payouts`, create and read the batch back) for caregiver and settlement payouts, with the execution's idempotency key as the batch ID.
- **Webhooks**: Kin subscribes to `PAYMENT.CAPTURE.COMPLETED`, the `BILLING.SUBSCRIPTION.*` events and `PAYMENT.SALE.COMPLETED`, and verifies every delivery with `/v1/notifications/verify-webhook-signature` before applying it. Webhook registration is a script (`/v1/notifications/webhooks`). Kin does not subscribe to payout-item events; it reads the payout batch.
- **OAuth** (`/v1/oauth2/token`) for the app's access token.
- **Vault** (`/v3/vault/setup-tokens`, `/v3/vault/payment-tokens`) is exercised only by the sandbox check script, and the demo pharmacy creates an order with a saved wallet (`vault_id`).
- **Invoicing v2** (`/v2/invoicing/invoices`: create, send, read back, cancel; `/v2/invoicing/search-invoices` by number) for requests to siblings, with the `INVOICING.INVOICE.PAID` and `INVOICING.INVOICE.CANCELLED` events.
Not called anywhere: Refunds, Shipment tracking, Disputes, Transaction Search, Log in with PayPal, the Agent Toolkit, the PayPal MCP server.

## The AI

Claude Opus 4.6 on Amazon Bedrock (InvokeModel, through `@anthropic-ai/bedrock-sdk`), reached only through `packages/agent`. The design rule is that Claude reads and words; it never decides an amount, a payee or whether a payment happened.

- **Reading a caregiver's description of visits** into service days and durations for the bill form. No tools; the request carries only the caregiver's words and today's date, never a rate or an amount. The answer follows a JSON schema and is checked in code (real days, whole minutes, each entry must quote the caregiver's own words), and the server values every day.
- **Reading a letter** (text or a photograph) into a payee, an amount and a date for a person to review. The extraction step has no tools, and what the letter says is data, never instructions.
- **Wording** spoken sentences and audit findings in the reader's language. The **number guard** compares every figure the model writes, in digits or in words, in all seven languages, with the figure in the record, and falls back to a fixed sentence on any mismatch. Whether a demand for money is real (the claim check) is decided by plain code over the ledger; the model only words the result.
- Prompts are versioned in `packages/agent`, with fixed evaluation sets (12 visit cases, 6 document cases and 12 Ask Kin cases) run by hand against the real model with `pnpm --filter @kin/agent run eval`, `run eval:documents` and `run eval:agent`. They cost money, so they are not run in CI. The Ask Kin set passed 12 of 12 on Opus 4.6 on 8 November 2026 (`packages/agent/evals/results/agent-2026-11-08.json`); no recorded results are kept for the other two sets.
- **Every AI result says whether the model was used.** A badge reads "Read by Claude" or "Worded by Claude" with the model, or "Read by fixed rules" or "Fixed wording" with the reason (busy, unreachable, limit reached). The fields read from a letter are shown beside the exact words they were found in. The Bills page has a sample letter photo that Claude reads, and a read-only preview of how a caregiver bills by describing visits.
- **Ask Kin** (`/dashboard/ask`): an agent-led question box over the record, where Claude chooses which tools to call and plain code bounds everything else. Its tool gateway checks the person's identity and role, validates every argument against a schema, bounds calls and time, and records each call. Its tools only read (the pool, bills, fairness, the claim check, proposals, the record, and the status of a payout, top-up or subscription read from PayPal through Kin's own adapter); one can only propose a refill the family's rules already allow, which still waits for the family's yes. No PayPal write tool is ever given to the model, and its answers pass the number guard. The same tools reach a member's own assistant through the Kin MCP server at `/api/mcp` (`/dashboard/circle/connections`, decision 93); none approves. The PayPal Agent Toolkit is not built.

## How we use AG Grid

AG Grid Community (v36) is the family's audit tool, not decoration. The **Record** page is one grid over the append-only ledger: sort and floating filters on every column (a date filter by calendar day, an amount filter parsed to exact cents), a quick-filter search, a column chooser, a pinned totals row, grouping by person, category or month with subtotals, multi-row selection with a live selected total, and a CSV export of exactly the filtered and sorted view. Column and filter state is kept per person in the browser. The same grid, opened on the proof columns, is the **audit trail** (`/dashboard/record/audit/view`) with a line showing that debits equal credits, and the **statement** page shows the year in review in a grid with its total pinned. All sums are integer cents from one pure function in `packages/domain`; the grid labels are translated into the seven languages, it runs right to left in Arabic and Hebrew, follows reduced motion, prints in full, and on a phone becomes stacked cards driven by the same grid state.

## Architecture

`docs/architecture.md` has the diagrams: the [system context](docs/architecture.md#3-system-context), the [services and stores](docs/architecture.md#4-services-and-stores), the [money core and its state machines](docs/architecture.md#7-the-money-core), the [PayPal integration](docs/architecture.md#8-paypal-integration) and the [AWS layout](docs/architecture.md#141-layout). Section 21 is the decision record and section 23 says how certain each part is.

In short: a deterministic TypeScript money core (`packages/domain`, no I/O) holds the double-entry ledger, the fairness calculation, settlement and the approval engine. PostgreSQL enforces access and the money rules again. The web app (App Runner) and the worker (Fargate) reach PayPal, Claude and speech only through adapters.

## Security model

- **Three layers of access.** The Cognito account group, the member's role in the circle checked in the service by the one authorization function in `packages/auth` (organizer, contributor, parent, caregiver, observer), and PostgreSQL row-level security. Every table except `users` carries `circle_id` and a policy, with tests that try to cross circles and must fail.
- **A fresh multi-factor check** before a yes to real money, even in an active session. No member is the sole approver of a payment to themselves.
- **The ledger is append-only and balances**, enforced by triggers even against the table owner. A hash chain over the entries, with heads kept at each check, lets an independent tool (`kin-verify`, `packages/verify`) prove a past entry was not changed.
- **PayPal's record decides.** Money is recorded only from a verified webhook or a direct read from PayPal. A PayPal call that times out makes the execution `unknown`: Kin queries PayPal and waits, never retrying blindly. Every movement has a recorded approval and an idempotency key.
- **The agent cannot move money**, and the number guard stops a wrong figure reaching a person.
- **The browser is untrusted**: it never decides access, computes money or holds a secret. Secrets are in AWS Secrets Manager.

## Who holds the money

Kin does not take custody of the family's money in a bank account of its own. In this sandbox build every top-up lands in Kin's PayPal account, and Kin's ledger attributes it to the circle. A production launch would use PayPal's multiparty or partner platform (or a licensed partner), so that each circle's funds are held and moved under PayPal's licences, not Kin's. Until then, the ledger's per-circle attribution, the rule that a payout is bounded by the circle's confirmed balance, and row-level security keep one circle's money apart from another's. See `docs/architecture.md` decision 70 and section 22.3.

## Tech stack

- TypeScript throughout, in one pnpm workspace
- Web: Next.js 16, React 19, Tailwind CSS 4, shadcn/ui and Radix, AG Grid Community for the record; seven languages including Arabic and Hebrew (right to left)
- Payments: PayPal REST APIs (Orders, Subscriptions, Payouts, webhooks) and the PayPal JavaScript SDK v6, sandbox only
- AI: Claude Opus 4.6 on Amazon Bedrock (InvokeModel) through the Anthropic Bedrock SDK
- Speech: Amazon Transcribe streaming and Amazon Polly
- Phone: Twilio Programmable Voice webhook contract (built, not connected)
- Data: PostgreSQL (Aurora Serverless v2 in AWS, PostgreSQL 17 in Docker locally), Drizzle ORM
- Auth: Amazon Cognito with PKCE
- Background work: a Node worker reading an SQS queue (ElasticMQ locally) and an outbox table
- Infrastructure: AWS CDK; App Runner for the web app, ECS Fargate for the worker
- Tests: Vitest and Playwright

`docs/tech-stack.md` explains each choice.

## Project structure

```
apps/
  web/            Next.js site, dashboard, HTTP API and PayPal webhook intake
  worker/         PayPal event inbox, payouts, refills, receipts, Cognito email sender
  voice/          the family office line: Twilio voice webhook service (built, not hosted)
  demo-merchant/  the stand-in pharmacy: catalog, orders, delivery, saved-wallet charge
packages/
  domain/         ledger, fairness, state machines, approval rules, claim check (pure code, no I/O)
  db/             schema, migrations, row-level security, repositories, demo provisioning
  paypal/         the only code that talks to PayPal
  agent/          the only code that calls the model; prompts, number guard, evaluation sets
  auth/           sessions, PKCE, step-up checks, circle access decisions
  speech/         Transcribe and Polly adapters
  documents/      reading a letter into a stored, checked reading
  telephony/      the office-line conversation and its fixed sentences
  verify/         kin-verify: independent check of an exported ledger's hash chain
  notify/         email sending (Gmail SMTP)
  config/         typed configuration
infra/            AWS CDK stacks
docs/             product description, architecture, tech stack, feature proposals, submission draft
```

`AGENTS.md` holds the engineering rules, including the dependency rule between packages and the money and security invariants.

## Getting started

### Prerequisites

- Node.js 24 or later
- pnpm 12 (the version is pinned in `package.json`)
- Docker, for the local database, the queue stand-in and the tests

### Install and run the web app locally

```bash
pnpm install

# Root settings: fill in the KIN_DATABASE_* lines (choose any local passwords)
cp .env.example .env

pnpm db:up                           # PostgreSQL in Docker
pnpm --filter @kin/db run migrate    # schema and roles

# Web app settings: copy the database passwords from .env,
# keep KIN_DEMO_CIRCLES=on and set KIN_DEMO_SESSION_KEY to a random string of 32+ characters
cp apps/web/.env.example apps/web/.env.local

pnpm --filter @kin/web dev
```

Open http://localhost:3000 and press **Demo**. Keep port 3000: it is the callback origin registered for sign-in.

### Configuration

Every setting is listed, with comments, in `.env.example` and `apps/web/.env.example`. The groups are:

| Variables | Needed for |
| --- | --- |
| `KIN_DATABASE_*` | The database (always) |
| `KIN_DEMO_CIRCLES`, `KIN_DEMO_SESSION_KEY` | The Demo button |
| `KIN_AUTH_ISSUER`, `KIN_AUTH_LOGIN_URL`, `KIN_AUTH_CLIENT_ID`, `KIN_WEB_ORIGIN` | Signing in, from a deployed Cognito user pool |
| `KIN_PAYPAL_CLIENT_ID`, `KIN_PAYPAL_CLIENT_SECRET`, `KIN_PAYPAL_WEBHOOK_ID`, `KIN_QUEUE_ENDPOINT`, `KIN_PAYPAL_INBOX_URL` | Top-ups and payouts (PayPal sandbox app) |
| `PAYPAL_SANDBOX_*`, `PAYPAL_TRIAL_CURRENCY` | The PayPal sandbox check script |
| `KIN_DEMO_SANDBOX_PAYEE_EMAIL`, `KIN_DEMO_SANDBOX_PAYOUTS_PER_DAY` | Optional: pay an approved demo caregiver payout through the PayPal sandbox to Kin's own test account (otherwise simulated) |
| `KIN_DEMO_INVOICE_RECIPIENT_EMAIL` | Optional: send a demo circle's invoice requests as real sandbox invoices to Kin's own test account (otherwise simulated) |
| `KIN_BEDROCK_REGION`, `KIN_BEDROCK_API`, `KIN_BEDROCK_MODEL` | Claude features, including Ask Kin; unset turns them off |
| `KIN_SPEECH_REGION` | Listening and speaking; unset turns them off |
| `KIN_SENDER_EMAIL`, `KIN_GMAIL_APP_PASSWORD` | Sign-in codes by email in AWS |

Bedrock and speech use the standard AWS credential chain (for example `AWS_PROFILE`).

### Top-ups locally

Top-ups need the queue stand-in and the worker beside the web app, plus a PayPal sandbox buyer account:

```bash
pnpm db:up
pnpm queue:up                        # SQS stand-in; prints the two queue settings
pnpm --filter @kin/worker dev
pnpm --filter @kin/web dev
```

### Other scripts

```bash
pnpm db:down / pnpm queue:down                       # stop the containers
pnpm --filter @kin/db run demo:reset -- <visitor-id> # fresh demo circle for a visitor
pnpm --filter @kin/paypal run sandbox:check          # exercise the PayPal sandbox app
pnpm --filter @kin/agent run eval                    # visit prompt evaluation set (calls the real model)
pnpm --filter @kin/agent run eval:documents          # document prompt evaluation set (calls the real model)
pnpm --filter @kin/agent run eval:agent              # Ask Kin evaluation set: tool choice, refusals, injection (calls the real model)
```

## Tests

1,831 unit and integration tests (Vitest) pass across 16 workspaces, from a full `pnpm check` run on 8 November 2026 (lint, strict typecheck and tests all green): `packages/domain` 528 (including property tests of the ledger, fairness and approval rules), `apps/web` 458, `packages/db` 215 (against a real PostgreSQL, including isolation between circles and each role's limits), `apps/worker` 120, `packages/agent` 101, `packages/auth` 91, and the rest in the other packages and `infra`. A further 28 Playwright spec files cover the main journeys at the four required viewports. The counts move as tests are added; `pnpm check` and `pnpm test:e2e` give the current result.

```bash
pnpm check        # lint, typecheck and unit/integration tests in every workspace
pnpm test:e2e     # Playwright against the production build of the web app
```

Before the first end-to-end run, install the browser with `pnpm --filter @kin/web exec playwright install chromium`. The database, web and end-to-end tests start their own throwaway PostgreSQL in Docker, so Docker must be running. The end-to-end tests use a local stand-in for Cognito and need no AWS access.

## Deployment

The infrastructure is AWS CDK in `infra/`, with these stacks: KinGuardrails, KinOps, KinNetwork, KinData (Aurora, Cognito), KinCi (GitHub OIDC role), KinWeb (App Runner) and KinWorker (Fargate, created when PayPal is configured).

- GitHub Actions `ci.yml` runs on every pull request: `pnpm check`, the end-to-end tests, Docker builds of the web, migration and worker images, and `cdk synth`.
- `deploy.yml` runs after CI passes on `main`: it deploys the stacks, runs the database migration task, rolls out the web image, and smoke-tests the live app. GitHub reaches AWS through OpenID Connect, with no stored keys.

To run the CDK by hand: `AWS_PROFILE=<profile> KIN_ALERT_EMAIL=<address> pnpm --filter @kin/infra run <synth|diff|deploy>`. See `AGENTS.md` section 3 for bootstrapping and for switching on email, PayPal, Claude and speech in AWS.

## Documentation

- `docs/project-description.md`: the product, the people it is for, and the full feature set it aims at
- `docs/architecture.md`: services, data model, money flow, PayPal, AI, voice, security, testing, decisions and what is verified
- `docs/tech-stack.md`: tool choices and their reasons
- `docs/feature-proposals.md`: proposed features, not yet approved or built
- `docs/submission/devpost-description.md`: a draft of the Devpost write-up

## License

MIT. See `LICENSE`.
