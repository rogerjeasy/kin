# Kin

Kin is a shared money layer for families who care for an aging parent. Siblings pay into one family pool through PayPal, a written family agreement says how the cost is shared, and Kin keeps a ledger of who gave what (in money and in care time) and plans the payments that bring everyone back to their agreed share. The parent stays part of every decision: Kin can read money events aloud and accept a spoken yes or no. The rule throughout is that the AI proposes, people approve, and PayPal's own record decides what actually happened.

Built for the PayPal AI Hackathon 2026.

**Live demo:** https://mzdg4f3stk.us-east-1.awsapprunner.com. Press **Demo** to get your own copy of a sample family's circle, with no account needed.

## Status

Hackathon project, in active development. The product described in `docs/project-description.md` is larger than what is built. `docs/architecture.md` section 23 records exactly what has been built, tested and verified.

Built and tested:

- The money core in `packages/domain`: a double-entry ledger, the fairness calculation, settlement planning, the proposal, bill and execution state machines, and the approval engine
- The PostgreSQL schema with row-level security per family circle, append-only and balancing triggers, and separate database roles for people, the worker and the demo provisioner
- Sign-in through Amazon Cognito, circle roles (organizer, contributor, parent, caregiver, observer), and a fresh multi-factor check before a yes to real money
- The demo: an anonymous, isolated copy of a sample circle per visitor, a role switcher, approving and declining proposals, pausing, inviting, CSV export of the record, and starting again
- Top-ups to the pool with the PayPal JavaScript SDK v6 (sandbox), confirmed by reading the order back and by verified webhooks
- Caregiver billing: rates, service days, server-calculated bills, family review, and payouts through PayPal Payouts (simulated in the demo, PayPal sandbox for real circles)
- The family agreement screen: proposing and accepting versions of shares, care time and approval thresholds
- In-app voice on the Bills and Approvals screens: speaking visits (Amazon Transcribe), hearing a bill read aloud (Amazon Polly) and answering by voice in the demo
- Claude (on Amazon Bedrock) reading a caregiver's spoken or written description of visits into a bill form. This is switched off in the hosted app until the AWS account has access to the model.

Not built yet: the separate `voice` service and phone calls, the `demo-merchant` purchasing flow, document photo reading, the scam check, the Kin MCP server, and settlement executions other than caregiver payouts. `apps/voice`, `apps/demo-merchant`, `packages/documents` and `packages/telephony` are empty placeholders.

## Tech stack

- TypeScript throughout, in one pnpm workspace
- Web: Next.js 16, React 19, Tailwind CSS 4, shadcn/ui and Radix, AG Grid Community for the record; seven languages including Arabic and Hebrew (right to left)
- Payments: PayPal REST APIs (Orders, Payouts, webhooks) and the PayPal JavaScript SDK v6, sandbox only
- AI: Claude through the Anthropic Bedrock SDK
- Speech: Amazon Transcribe streaming and Amazon Polly
- Data: PostgreSQL (Aurora Serverless v2 in AWS, PostgreSQL 17 in Docker locally), Drizzle ORM
- Auth: Amazon Cognito with PKCE
- Background work: a Node worker reading an SQS queue (ElasticMQ locally)
- Infrastructure: AWS CDK; App Runner for the web app, ECS Fargate for the worker
- Tests: Vitest and Playwright

`docs/tech-stack.md` explains each choice.

## Project structure

```
apps/
  web/            Next.js site, dashboard, HTTP API and PayPal webhook intake
  worker/         PayPal event inbox, caregiver payouts, Cognito email sender
  voice/          placeholder
  demo-merchant/  placeholder
packages/
  domain/         ledger, fairness, state machines, approval rules (pure code, no I/O)
  db/             schema, migrations, row-level security, repositories, demo provisioning
  paypal/         the only code that talks to PayPal
  agent/          the only code that calls the model; prompts and an evaluation set
  auth/           sessions, PKCE, step-up checks, circle access decisions
  speech/         Transcribe and Polly adapters
  notify/         email sending (Gmail SMTP)
  config/         typed configuration
  documents/, telephony/   placeholders
infra/            AWS CDK stacks
docs/             product description, architecture, tech stack, feature proposals, specs
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
| `KIN_BEDROCK_REGION`, `KIN_BEDROCK_MODEL` | Claude features; unset turns them off |
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
pnpm --filter @kin/agent run eval                    # prompt evaluation set (calls the real model)
```

## Tests

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
