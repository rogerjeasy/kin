# Kin: technology stack

---

## 1. The stack at a glance

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, 6.0 release line |
| Repository | One pnpm workspace: `apps/*`, `packages/*`, `infra` |
| Lint | ESLint, typescript-eslint strict preset |
| Web app | Next.js, React, Tailwind CSS, shadcn/ui, motion, three.js with React Three Fiber (section 4) |
| Data grid | AG Grid Community |
| Care calendar | Bryntum Scheduler, trial build (section 15) |
| Checkout | PayPal JavaScript SDK v6 |
| PayPal server side | Direct REST and the Agent Toolkit (section 5) |
| AI model | Claude on Amazon Bedrock through the Anthropic TypeScript SDK (section 6) |
| Speech | Amazon Transcribe and Amazon Polly (section 7) |
| Phone calls | Twilio voice, through `apps/voice` (section 7) |
| Containers | Docker, one image each for `apps/web`, `apps/worker`, `apps/voice`; locally also PostgreSQL and the queue stand-in (`pnpm db:up`, `pnpm queue:up`) |
| Compute | AWS App Runner for web and voice, ECS on Fargate for the worker (section 8) |
| Database | Amazon Aurora Serverless v2, PostgreSQL-compatible |
| Authentication and authorization | Amazon Cognito |
| File storage | Amazon S3 |
| Background work | Amazon SQS, EventBridge Scheduler |
| Secrets | AWS Secrets Manager |
| Infrastructure as code | AWS CDK in TypeScript |
| Build and deploy | GitHub Actions, Amazon ECR |
| Monitoring | Amazon CloudWatch |
| Tests | Vitest, Playwright, PayPal webhook simulator and negative testing |

---

## 2. What the hackathon requires

- Required: the PayPal developer platform in the free sandbox, central to the project, plus any AI tool, model or platform.
- Optional sponsor tools: AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render, Zapier.
- Unrestricted: language, framework, database, hosting. AWS is allowed.
- To submit: a public open-source repository with a visible license; a working build judges can reach free, with its demo, credentials and trials kept up until winners are announced on 21 December 2026; a video under three minutes. No edits after the submission deadline.

---

## 3. How the pieces fit

```
  Siblings (laptop/phone)    Caregiver (phone)    Parent (phone browser or phone call)
            |                        |               |                   |
            +-----------+------------+---------------+              Twilio voice
                        |                                                |
                 HTTPS, own address                          HTTPS webhooks, own address
                        |                                                |
                   web service              worker service          voice service
                   Next.js UI and API       queues and schedules    call webhooks
                   (App Runner)             (ECS Fargate)           (App Runner)
                        |                         |                      |
                        +-------------------------+----------------------+
                                                  |
   +----------------+------------------+----------+-----+----------------+
   |                |                  |                |                |
 Cognito      Aurora Serverless v2     S3              SQS         Secrets Manager
 sign-in      ledger, circles,     receipts and    jobs and        PayPal, Twilio,
 and tokens   approvals, audit     letter photos   webhook events  Gmail secrets

 No load balancer: each App Runner service serves https at its own address.
 External services:  PayPal sandbox  |  Claude on Amazon Bedrock  |  Amazon Transcribe and Polly
```

- Web: the app, its API and the PayPal webhook endpoint.
- Voice: Twilio's call webhooks, short requests as built. Live call audio is the section 8 target.
- Worker: webhook events, monthly settlement, refill scheduling, notifications.

---

## 4. Frontend

- One Next.js, React and TypeScript app for siblings on a laptop and the parent and caregiver on a phone.
- Tailwind CSS and shadcn/ui on Radix primitives, with right-to-left support: quick, accessible, easy to restyle for very large type and high contrast. Buttons are resized so every control is at least 44 pixels.
- Installable: a manifest and service worker keep Kin on the parent's home screen, with notifications.
- AG Grid for the ledger, bills list and audit export (sorting, filtering, grouping, export).
- Browser microphone and camera, for in-app voice and photographing bills and letters.
- WCAG 2.2 level AA, tested with a screen reader.
- Public pages (homepage, How it works, Safety, For caregivers, Pricing) are prerendered static HTML under `src/app/[locale]`.
- Seven languages, no library: English, French, German, Italian, Spanish, Arabic, Hebrew. English has the short address (`/pricing`, rewritten by a proxy file), the rest a prefix (`/fr/pricing`). One JSON dictionary each, and a test fails the build if one's structure drifts from English. Arabic and Hebrew are right to left, so components use logical properties only (`ms-`, `pe-`, `text-start`).
- One WebGL scene (three.js, React Three Fiber, drei): the Kin knot in the home page hero, loaded only there, after the page is interactive. A still poster replaces it without WebGL or under reduced motion, so no GPU work is done (decision 95).
- motion for shared-layout transitions such as gliding navigation indicators, CSS elsewhere. Both follow the reduced-motion setting.
- Light and dark themes, no library: a `data-theme` attribute on `<html>`, set before first paint by a small inline script and kept in the browser. Colours are CSS variables under shadcn/ui's token names.
- Fonts, self-hosted at build time through `next/font`: Newsreader (headlines, spoken sentences), IBM Plex Sans (text), IBM Plex Mono (records), backed by IBM Plex Sans Arabic, IBM Plex Sans Hebrew, Noto Naskh Arabic and Frank Ruhl Libre.
- Packages export TypeScript source that Next.js compiles (`transpilePackages`); imports use the real `.ts` extension (`allowImportingTsExtensions` in the base config).

---

## 5. PayPal

| Kin feature | PayPal product | How Kin reaches it |
|---|---|---|
| Monthly sibling contributions | Subscriptions and Catalog | Direct REST for product and plan; PayPal's approval link for consent |
| One-off top-ups | Orders v2 | JavaScript SDK v6, captured on the server |
| Top-up and settlement requests to siblings | Invoicing v2 | Direct REST |
| Purchases for the parent | Vault payment token and Orders v2 at a linked merchant | Direct REST by the merchant |
| Paying caregivers and rebalancing siblings | Payouts | Direct REST |
| Spreading a large cost | Pay Later | JavaScript SDK v6 |
| The record of what happened | Webhooks, read-backs (Payments v2), Transaction Search | Webhook endpoint, direct REST reads |
| Following a delivery | Shipment tracking | Planned, not built |
| Contesting a wrong charge | Disputes | Planned, not built |
| Signing in with PayPal | Log in with PayPal | Federated through Cognito (section 9); Planned, not built |

**Status in this build.** Built, all by direct REST from `packages/paypal`: Orders v2 with the JavaScript SDK v6 (and Pay Later when PayPal offers it); Payments v2 read-backs of a capture or refund; Subscriptions with Catalog products and plans (create, read, transactions, suspend, activate, cancel, revise); Payouts (batch and item); Invoicing v2 (`architecture.md` section 8.2); Transaction Search for nightly reconciliation of real Purse payments (section 8.6a); signature-verified webhooks, refunds included (decision 97); the demo pharmacy's vault-backed Orders request. Creating a refund is **Planned, not built**, like the three planned rows above.

**Packages and endpoints.** The model never holds a PayPal write, and neither option below has a Payouts tool, so Kin exposes its own MCP server instead (decision 93).

- `@paypal/agent-toolkit` 1.11.0, built for four read actions: Ask Kin's reads of PayPal's own record (decision 106).
- The hosted sandbox MCP server `https://mcp.sandbox.paypal.com` (`/sse` and `/http` transports), or locally `npx @paypal/mcp --tools=all`: **Planned, not built**.
- The JavaScript SDK v6 in the browser, and REST directly wherever the toolkit has no tool.

**Rules for every PayPal call:**

- PayPal's record is the source of truth: a payment is done only when a verified webhook or a direct read from PayPal says so. Every webhook signature is verified. Payouts are read back from the batch, not from payout-item events.
- Every write carries an idempotency key, so a retry never pays twice.
- Every money movement needs an approval record in Kin's database; the toolkit has no confirmation step.

---

## 6. AI

- **Model, as built:** Claude Opus 4.6 on Bedrock InvokeModel (`us.anthropic.claude-opus-4-6-v1`). **Target:** Opus 5.5 (`claude-opus-5-5`) once the account is granted it. It reasons for the agent, reads bills, letters and receipts from photographs, and writes statements and spoken sentences.
- **SDK, as built:** `@anthropic-ai/bedrock-sdk`. Ask Kin (`packages/agent/src/ask-kin`, decision 74) runs a manual, non-streaming tool loop with strict tool schemas. Bedrock's strict mode refuses integer minimum and maximum bounds, so Kin's own gateway enforces them. The `@anthropic-ai/sdk` tool runner, the first design, is not used.
- **Structured outputs** for anything Kin stores, such as a bill's amount, payee and due date.
- **Streaming** was the design for spoken replies. As built, no call streams: answers are short, and non-streaming stays inside the SDK's timeout.

**Settings to get right from the start:**

- Set the effort level explicitly; this model defaults to medium. Use low for short spoken turns, high for the monthly statement and difficult documents. As built: every structured read, documents included, runs at low (`packages/agent/src/bedrock-model.ts`); Ask Kin and the calendar assistant at medium; no call at high; the monthly statement is plain code with no model.
- Do not force a tool call: Opus 5.5 rejects forced tool choice. Use automatic tool choice with strict tool schemas.
- Check the stop reason on every response and handle a refusal cleanly. Built: a refusal or cut-off falls back to fixed wording. Server-side fallbacks are not configured (decision 58).
- If spoken replies feel slow at low effort, test Claude Haiku 5.5 (`claude-haiku-5-5`) for those turns only. Not done: every call uses one model.

**Two calls that differ.** The care calendar's assistant (decision 82) sends its tools with thinking off and effort medium, since the calendar widget holds the conversation and cannot carry thinking blocks between requests. That needs a model that allows thinking off: Opus 4.6, which the hosted app runs; Opus 5.5 would need this revisited. The shift wording (decision 81) is the one-shot structured call at low effort, with no tools.

**Not done by AI:** ledger arithmetic, settlement, and deciding that a payment happened. Deterministic code does these from PayPal's records.

**Where Kin reaches Claude: Amazon Bedrock** (decisions 58 and 67), with AWS credentials and no Anthropic key, through `@anthropic-ai/bedrock-sdk`. `KIN_BEDROCK_API` picks the endpoint: `mantle` (default; `AnthropicBedrockMantle`, model ID `anthropic.claude-opus-5-5`) or `invoke` (Bedrock Runtime InvokeModel; `AnthropicBedrock`, model ID `us.anthropic.claude-opus-4-6-v1`). The hosted app uses `invoke` because its AWS account is not entitled to Opus 5.5 on Mantle. Once AWS grants it, set `KIN_BEDROCK_API=mantle` and `KIN_BEDROCK_MODEL=anthropic.claude-opus-5-5`, then re-run every evaluation set in `packages/agent/evals`. Both adapters send the same Messages body (low effort, `output_config.format` json_schema, no tools, no prefill, which Opus 4.6 refuses), and the caller validates the reply. The settings above apply on Bedrock unchanged but were not written for Opus 4.6: re-check the effort and tool-choice lines against it.

---

## 7. Voice

Claude's API takes text and images, not audio, so speech needs its own services.

| Need | Recommended | AWS alternative |
|---|---|---|
| Speech to text | Deepgram | Transcribe |
| Text to speech | ElevenLabs | Polly |
| Calls with the parent | Twilio voice | Amazon Connect or Chime SDK |

**Chosen: Amazon Transcribe and Amazon Polly** (decision 59), built and switched on, in Bedrock's AWS account, so no new vendor keys. Transcribe streaming hears all seven of Kin's languages. Polly has neural voices for all but Hebrew (Danielle, Léa, Vicki, Lucia, Bianca, Hala), so Hebrew is shown, not spoken.

- Phone calls are the parent's main channel, since a web app cannot wake a locked phone. Kin rings any phone, landlines included, through Twilio voice and `apps/voice`, a webhook service on App Runner (stack `KinVoice`, `kin:voice` on, decision 85). A call through a real Twilio number is not yet verified.
- In the app, the same speech services use the browser microphone.
- Choose the voice by ear with a real older listener: for an 81-year-old, warmth and clarity beat any benchmark.
- Cover every language the pilot families speak.

---

## 8. Compute: AWS ECS on Fargate

> **Today:** web and voice run on AWS App Runner (decisions 35 and 85), each serving https at its own address, with no domain and no load balancer. Only the worker runs on Fargate. Below is the target for live audio, which needs long-lived connections; Twilio's webhooks, as built, are short requests.

- Three Fargate services from one container image: web, voice, worker.
- An Application Load Balancer in front of web and voice, with AWS Certificate Manager certificates and a Route 53 domain.
- Not serverless only: live calls hold connections for minutes, and PayPal webhooks need an always-awake endpoint.
- One multi-stage Dockerfile; each service starts the image with its own command. Docker Compose runs them with PostgreSQL locally.
- Build for the processor architecture Fargate runs. Amazon ECR stores the images.
- Optional: Amazon CloudFront in front of the load balancer, for static assets and caching.

---

## 9. Authentication and authorization: Amazon Cognito

### 9.1 Authentication

- One Cognito user pool for siblings, parents, caregivers and professionals.
- Passwordless sign-in by one-time email code or passkey. Nobody in a family should need a Kin password.
- Cognito managed login, so Kin hosts no credential forms.
- Log in with PayPal as a federated identity provider: it is built on OpenID Connect, which Cognito accepts, so a sibling signs in with the PayPal account they pay from.
- Multi-factor authentication for organizers and anyone who can approve a payout.
- Every service verifies Cognito's signed tokens with `aws-jwt-verify` before doing anything.

### 9.2 Authorization

Cognito answers "who is this?" Kin's database answers "what may they do in this circle?" One person can hold different roles in different circles, so both are needed.

| Level | Held in | Examples |
|---|---|---|
| Account type | Cognito groups | family member, caregiver, professional, administrator |
| Role in a circle | Aurora, checked on every request | organizer, contributor, parent, caregiver, observer |
| Limits and approvals | Aurora, from the family agreement | spending thresholds, who must approve, second approval above an amount |

- Cognito groups give coarse access, such as caregiver versus family screens.
- The service checks per-circle roles on every request: a caregiver sees only their own bills, and an observer reads and never writes.
- Row-level security in Aurora is a second line of defense, so a service bug cannot expose another family's data.
- Amazon Verified Permissions is an option if the rules outgrow simple role checks. Not needed for the hackathon.

### 9.3 The parent on a phone call

A phone call is not a browser session, so Cognito does not sign the parent in there.

- Outbound calls go only to the parent's registered number.
- Inbound calls are matched to that number, and the parent confirms with a short spoken phrase or PIN before Kin discusses money.
- Voice approvals record the call reference, time and words confirmed.
- The voice service has its own service identity, limited to that parent's circle.

### 9.4 Service access

- Kin's own MCP server (built, decision 93; `architecture.md` section 13.4) lets a member's own AI assistant use Kin with a delegation token the member grants and revokes on `/dashboard/circle/connections`.
- A client can instead get that token by OAuth 2.1, with Kin as its own authorization server (built, decision 112): discovery from the 401, client registration, consent at `/dashboard/circle/connections/authorize`, S256 PKCE required, a `kin_dlg_…` delegation token as the access token, no refresh token. Cognito was rejected for this role: its tokens are not delegations. The official MCP TypeScript SDK client completed the flow against a local Kin; a deployed Kin, Claude Code, Claude Desktop and ChatGPT are not yet verified.
- Service-to-service calls inside AWS use IAM roles, not shared keys.

---

## 10. Database: Amazon Aurora Serverless v2

- Aurora Serverless v2, PostgreSQL-compatible. Capacity follows load, which suits a demo that is idle most of the day and busy when a judge arrives.
- Drizzle ORM (`drizzle-orm` 0.45) over node-postgres (`pg` 8); `drizzle-kit` generates migrations into `packages/db/migrations`. Row types come from the one schema in `packages/db/src/schema`, enums from the money core's constants. Row-level security, roles, triggers and grants are plain SQL in a hand-written migration (`0001_security.sql`), so nothing about access hides behind the library (decision 37).

**How the data is kept:**

- An append-only ledger: no edits or deletes, and corrections are new entries. That makes the audit export trustworthy.
- Money in whole cents in integer columns, with the currency beside each amount. No floating-point arithmetic anywhere.
- Each approval is a record: who, when, by what means, for which movement.
- PayPal events stored as received with their PayPal IDs, so every ledger entry traces to its cause.
- Row-level security by circle.

**Operating notes:**

- Aurora Serverless v2 can pause when idle and takes several seconds to resume. During judging, keep minimum capacity above zero so a judge's first visit is not slow.
- Point-in-time recovery on. Encryption at rest with AWS KMS.

---

## 11. Files, queues and schedules

- Amazon S3 for photographs of receipts, bills and letters, uploaded from the phone through short-lived signed links into private, encrypted buckets.
- Amazon SQS for work that should not block a request (a PayPal webhook, reading a photographed bill, a notification), each queue with a dead-letter queue. Locally, ElasticMQ (`softwaremill/elasticmq-native` in Docker, `pnpm queue:up`) answers SQS's API, so web and worker run the same code as in AWS. The client is `@aws-sdk/client-sqs`, the same SDK family and version as the Secrets Manager client.
- Amazon EventBridge Scheduler for monthly settlement, the monthly statement, refill reminders and the parent's scheduled calls.
- Amazon SES for email, including statements and sign-in codes.

---

## 12. Infrastructure, delivery and monitoring

- AWS CDK in TypeScript defines every resource, so the environment can be recreated from the repository, which must hold everything needed to run the project.
- GitHub Actions builds, tests and deploys, signing in to AWS through OpenID Connect with no long-lived keys in GitHub.
- AWS Secrets Manager holds the PayPal client secret, the Twilio credentials, the Gmail app password, the demo pharmacy's secrets, the demo session key and the database passwords. Bedrock and speech need no key: they use the service's IAM role.
- Amazon CloudWatch logs, metrics and alarms, including alarms on failed webhooks, failed payouts and queue backlogs.
- Optional: AWS WAF on the load balancer, to rate-limit public endpoints.

---

## 13. Security

Sections 5 and 9 to 12 cover webhook signatures, access, row-level security, encryption at rest, uploads, secrets and keyless deploys. Also:

- A least-privilege IAM role per Fargate service.
- No secrets in the repository or container image.
- Telephony webhook signatures verified.
- Encryption in transit everywhere.
- Minimal personal data: financial records and receipts, no medical records.
- An audit trail of every sign-in, approval and payment movement.

---

## 14. Testing

- Vitest for unit tests, heaviest on the ledger and settlement, since the fairness claim rests on them.
- Playwright for end-to-end tests of the main journeys in a real browser.
- PayPal sandbox with seeded personal and business accounts for each member of the demo family.
- PayPal's webhook simulator to replay payment events, and negative testing for failed, declined and reversed payments.
- Recorded test calls for the voice flows.

---

## 15. Sponsor tools

A project can win one sponsor prize, so aim for one strong fit.

| Tool | Use in Kin | Verdict |
|---|---|---|
| **AG Grid** | Family ledger, bills list, audit export | Use. Best fit and largest sponsor prize |
| **APIMatic** | Context plugins while coding the PayPal integration | Use during development |
| **Postman** | Sandbox testing, and a published collection for judges | Use |
| **Channel3** | Product search inside the purchasing agent | Use if the purchasing agent searches real catalogs |
| **Render** | Hosting | Not used: hosting is on AWS |
| **Bryntum** | Care calendar: a week of shifts, one row per person (`apps/web`, `components/dashboard/shifts`). Trial build, approved by the owner on 8 November 2026; read-only, loaded only on the calendar page as a static file fetched at runtime that the bundler never reads (decision 84). Install script off; a licensed build is an npm alias change | Use |
| **Elastic, KERNEL, Zapier, Astropods** | No natural role | Skip |

---

## 16. Things to settle on day one

Try each against the real service before the build depends on it.

1. How the agent reaches PayPal's tools: try the MCP server and the toolkit's other adapters with Claude, and keep the more reliable.
2. Payouts, which have no toolkit tool: confirm Payouts is enabled on the sandbox business account and call the REST API directly.
3. Sandbox subscriptions bill in real time and cannot be fast-forwarded. Find the shortest billing cycle, and plan on short cycles or simulated webhook events for the demo.
4. Log in with PayPal: confirm PayPal's OpenID Connect endpoints work with Cognito federation. If not, keep email codes and passkeys, and link each sibling's PayPal account at their first payment.
5. Text-message sign-in codes go through Amazon SNS, which starts restricted and takes time to open up. Use email codes for the hackathon.
6. Live call audio on AWS: confirm the load balancer and voice service hold a connection for a full call.
7. Pay Later depends on the buyer's country, in the sandbox too. Treat it as optional.

---

## 17. Access for judges

- A hosted demo at a stable address, with a one-click demo mode.
- Seeded Cognito demo accounts for each role (sign-in details in the README) and matching sandbox PayPal accounts.
- A reset script that returns the demo family to its starting state.
- A number judges can call to hear the parent's experience, or a recorded call if a live number is impractical.
- Full setup instructions in the repository, so judges can run it themselves.

---

## 18. Cost and running through judging

- Keep everything section 2 lists up from submission on 12 November to 21 December 2026.
- Small Fargate tasks and a low Aurora maximum capacity.
- An AWS billing alarm before deploying anything.
- Spending limits on the Claude, speech and telephony accounts, since the demo is public.

---

## 19. How certain each part is

**Checked against the source during this session:**

- The hackathon's technology rules and sponsor list.
- The PayPal Agent Toolkit's tool list, including the absence of a payout tool.
- The PayPal sandbox MCP server address and transports.
- The Claude model identifiers and the behavior notes in section 6.
- Claude in the hosted app: `kin:claude` is `true`; the deployed model is `us.anthropic.claude-opus-4-6-v1` through Bedrock InvokeModel (`infra/src/web-stack.ts`). The fixed evaluation sets in `packages/agent/evals` run by hand against the real model (`pnpm --filter @kin/agent run eval`, `eval:documents`, `eval:agent` and the others in its `package.json`), each run kept in `packages/agent/evals/results/`. On Opus 4.6 through InvokeModel: visits 12 of 12 and documents 8 of 8 (10 November 2026), Ask Kin 15 of 15 (11 November 2026), every other set passing in full.

**From general knowledge, to confirm before relying on it:**

- Aurora Serverless v2 pause and resume behavior.
- Cognito's passwordless sign-in options and its handling of OpenID Connect providers.
- The need for Amazon SNS configuration before Cognito can send text messages.
- The capabilities of the speech and telephony services named in section 7.
