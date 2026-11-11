# Kin: technology stack

Recommended tools and services for building Kin for the PayPal AI Hackathon 2026. Draft 1, 13 October 2026.

This document says what to build with and why. It is not a design or an implementation plan. See `project-description.md` for the product.

---

## 1. The stack at a glance

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere, on the 6.0 release line |
| Repository | One pnpm workspace: `apps/*`, `packages/*` and `infra` |
| Lint | ESLint with typescript-eslint, strict preset |
| Web app | Next.js, React, Tailwind CSS, shadcn/ui, motion, three.js with React Three Fiber, installable to the home screen |
| Data grid | AG Grid Community for the family ledger and audit screens |
| Care calendar | Bryntum Scheduler, the trial build, read-only, for the family's week of care shifts |
| Checkout | PayPal JavaScript SDK v6 |
| PayPal server side | Direct REST calls from `packages/paypal` (built). The PayPal Agent Toolkit `@paypal/agent-toolkit` 1.11.0 for Ask Kin's reads of PayPal's own record, read actions only (built, architecture decision 105). The sandbox MCP server is **Planned, not built** |
| AI model | Claude through the Anthropic TypeScript SDK on Amazon Bedrock: Opus 4.6 by InvokeModel today, Opus 5.5 when the account is granted it |
| Speech | Amazon Transcribe and Amazon Polly (built, switched on; architecture decision 59) |
| Phone calls | Twilio voice, as a webhook service (`apps/voice`) hosted on App Runner by the `KinVoice` stack, with `kin:voice` on (architecture decision 85); a call through a real Twilio number is not yet verified |
| Containers | Docker, one image per service (`apps/web`, `apps/worker` and `apps/voice` each have a Dockerfile); locally, PostgreSQL and the queue stand-in run in Docker (`pnpm db:up`, `pnpm queue:up`) |
| Compute | AWS App Runner for the web app and the voice service (architecture decisions 35 and 85); ECS on Fargate for the worker |
| Database | Amazon Aurora Serverless v2, PostgreSQL-compatible |
| Authentication and authorization | Amazon Cognito |
| File storage | Amazon S3 |
| Background work | Amazon SQS and EventBridge Scheduler |
| Secrets | AWS Secrets Manager |
| Infrastructure as code | AWS CDK in TypeScript |
| Build and deploy | GitHub Actions, Amazon ECR |
| Monitoring | Amazon CloudWatch |
| Tests | Vitest, Playwright, PayPal webhook simulator and negative testing |

---

## 2. What the hackathon requires

- **Required:** the PayPal developer platform in the free sandbox, and an AI tool, model or platform of your choice. PayPal must be central to the project.
- **Optional:** sponsor tools from AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render and Zapier.
- **Not restricted:** language, framework, database and hosting. AWS is permitted.
- **Submission needs:** a public open-source repository with a visible license, a working build that judges can reach free of charge, with its demo, credentials and trials kept up until winners are announced on 21 December 2026, and a video under three minutes. No edits after the submission deadline.

---

## 3. How the pieces fit

```
  Siblings (laptop/phone)   Parent (phone call or phone browser)   Caregiver (phone)
            |                          |                                  |
            |                     Twilio voice                            |
            |                          |                                  |
            +------------+-------------+----------------+-----------------+
                         |                              |
                 Application Load Balancer  (HTTPS and WebSocket)
                         |
        +----------------+----------------+-------------------+
        |                                 |                   |
   web service                      voice service        worker service
   Next.js UI and API               live call audio      queues and schedules
   (ECS Fargate)                    (ECS Fargate)        (ECS Fargate)
        |                                 |                   |
        +-----------+---------------------+-------------------+
                    |
   +----------------+------------------+----------------+----------------+
   |                |                  |                |                |
 Cognito      Aurora Serverless v2     S3              SQS         Secrets Manager
 sign-in      ledger, circles,     receipts and    jobs and        PayPal, Claude,
 and tokens   approvals, audit     letter photos   webhook events  speech keys

 External services:  PayPal sandbox  |  Claude API  |  speech-to-text and text-to-speech
```

Three small services share one codebase:

- **Web** serves the app and its API, and receives PayPal webhooks.
- **Voice** holds the long-lived connections that live phone calls need.
- **Worker** processes webhook events, runs monthly settlement, schedules refills and sends notifications.

---

## 4. Frontend

- **Next.js with React and TypeScript.** One app serves siblings on a laptop, and the parent and caregiver on a phone.
- **Tailwind CSS and shadcn/ui.** Fast to build, accessible by default, easy to restyle for very large type and high contrast.
- **Installable web app.** A manifest and service worker let the parent's phone keep Kin on the home screen and receive notifications.
- **AG Grid.** The ledger, the list of bills and the audit export are tables with sorting, filtering, grouping and export. This is exactly what AG Grid is for, and it carries the largest sponsor prize.
- **Browser microphone and camera.** Used for voice in the app and for photographing bills and letters.
- **Accessibility target:** WCAG 2.2 level AA, tested with a screen reader.
- **Public pages.** The homepage, How it works, Safety, For caregivers and Pricing live in the same app under `src/app/[locale]`, and are prerendered as static HTML.
- **Seven languages, no library.** English, French, German, Italian, Spanish, Arabic and Hebrew. English sits at the short address (`/pricing`) and the others are prefixed (`/fr/pricing`). A proxy file rewrites the short address, and each language is one JSON dictionary. A test fails the build if a translation's structure drifts from the English one. Arabic and Hebrew render right to left, so components use logical properties only (`ms-`, `pe-`, `text-start`).
- **three.js, React Three Fiber and drei for one 3D scene.** The home page's hero draws the Kin knot in WebGL. It loads only on that page, after it is interactive, a still poster stands in where WebGL is missing, and a reader who asks for reduced motion keeps the poster, so no GPU work is done (`architecture.md` decision 95).
- **motion for shared-layout transitions.** Navigation indicators glide between items; everything else moves in CSS. Both follow the reader's reduced-motion setting.
- **Light and dark themes, no library.** The theme is a `data-theme` attribute on `<html>`, set before first paint by a small inline script, with the choice kept in the browser. The colours are CSS variables under shadcn/ui's token names.
- **shadcn/ui on Radix primitives**, initialised with right-to-left support. Buttons are resized so every control is at least 44 pixels.
- **Type.** Newsreader for headlines and spoken sentences, IBM Plex Sans for text and IBM Plex Mono for records, with IBM Plex Sans Arabic, IBM Plex Sans Hebrew, Noto Naskh Arabic and Frank Ruhl Libre behind them. All are self-hosted at build time through `next/font`.
- **Workspace imports.** Packages export TypeScript source and Next.js compiles them (`transpilePackages`). Files are imported by their real `.ts` extension, which `allowImportingTsExtensions` in the base config permits.

---

## 5. PayPal

| Kin feature | PayPal product | How Kin reaches it |
|---|---|---|
| Monthly sibling contributions | Subscriptions and Catalog | Direct REST calls for the product and plan, PayPal's approval link for the sibling's consent |
| One-off top-ups | Orders v2 | JavaScript SDK v6, with capture on the server |
| Top-up and settlement requests to siblings | Invoicing v2 | Direct REST calls |
| Purchases for the parent | Vault payment token and Orders v2 at a linked merchant | Direct REST calls by the merchant |
| Paying caregivers and rebalancing siblings | Payouts | Direct REST calls |
| Spreading a large cost | Pay Later | JavaScript SDK v6 |
| The record of what happened | Webhooks, read-backs (Payments v2) and Transaction Search | A webhook endpoint, and direct REST reads |
| Following a delivery | Shipment tracking | Planned, not built |
| Contesting a wrong charge | Disputes | Planned, not built |
| Signing in with PayPal | Log in with PayPal | Federated through Cognito, see section 9 |

**Status in this build.** Called by the code today, all by direct REST calls from `packages/paypal`: Orders v2 with the JavaScript SDK v6 (and Pay Later when PayPal offers it), Payments v2 (reading a capture or a refund back), Subscriptions with Catalog products and plans (create, read, transactions, suspend, activate, cancel, revise), Payouts (batch and item), Invoicing v2, Transaction Search (the nightly reconciliation of real Purse payments, architecture section 8.6a), webhooks with signature verification (including refunds, decision 97), and the vault-backed Orders request in the demo pharmacy. Shipment tracking, Disputes, creating a refund and Log in with PayPal are **Planned, not built**. Invoicing is covered in `architecture.md` section 8.2.

**Packages and endpoints (the toolkit is built for four read actions, architecture decision 105; the MCP line is Planned, not built; neither has a Payouts tool, and the model never holds a PayPal write, so Kin exposes its own MCP server instead, architecture decision 93):**

- `@paypal/agent-toolkit` for the agent's PayPal tools.
- The hosted sandbox MCP server at `https://mcp.sandbox.paypal.com`, with `/sse` and `/http` transports. It can also run locally with `npx @paypal/mcp --tools=all`.
- PayPal JavaScript SDK v6 in the browser.
- PayPal REST APIs called directly where the toolkit has no tool.

**Rules for every PayPal call:**

- **PayPal's record is the source of truth.** Kin records a payment as done only when a verified webhook, or a direct read of the resource from PayPal, says so. Every webhook signature is verified. Kin reads payouts back from the batch rather than subscribing to payout-item events.
- **Every write carries an idempotency key**, so a retry never pays twice.
- **Every movement of money sits behind an approval record** in Kin's own database. PayPal's toolkit has no built-in confirmation step, so Kin supplies one.

---

## 6. AI

- **Model, as built: Claude Opus 4.6 on Bedrock InvokeModel (`us.anthropic.claude-opus-4-6-v1`); Opus 5.5 (`claude-opus-5-5`) is the target once the account is granted it (see the Bedrock paragraph below).** Used for the agent's reasoning, for reading bills, letters and receipts from photographs, and for writing statements and spoken sentences.
- **SDK, as built: `@anthropic-ai/bedrock-sdk`.** Ask Kin (`packages/agent/src/ask-kin`, architecture decision 74) runs a manual tool loop on `@anthropic-ai/bedrock-sdk`, non-streaming, with strict tool schemas; Bedrock's strict mode refuses integer minimum and maximum bounds, so Kin's own gateway enforces them. The `@anthropic-ai/sdk` tool runner, the first design, is not used.
- **Structured outputs** for anything Kin stores, such as the amount, payee and due date read from a bill.
- **Streaming** for spoken replies was the design; **as built, no call streams** (each answer is short and non-streaming stays inside the SDK's timeout).

**Settings to get right from the start:**

- Set the effort level explicitly. Its default on this model is medium. Use low for short spoken turns and high for the monthly statement and for reading difficult documents. **As built:** every structured read, including documents, runs at low effort (`packages/agent/src/bedrock-model.ts`), and Ask Kin and the calendar assistant at medium; no call uses high, and the monthly statement is plain code with no model.
- Do not force a specific tool call. Opus 5.5 rejects forced tool choice. Use automatic tool choice with strict tool schemas.
- Check the stop reason on every response and handle a refusal cleanly (built: a refusal or a cut-off falls back to fixed wording). Server-side fallbacks are not configured (decision 58).
- If spoken replies feel slow at low effort, test Claude Haiku 5.5 (`claude-haiku-5-5`) for those turns only. Not done: every call uses one model.

**Two calls that differ from the settings above.** The care calendar's assistant (architecture decision 82) sends the model its tools with thinking switched off and effort medium, because the calendar widget holds the conversation and cannot carry thinking blocks between requests; it needs a model that allows thinking off (Opus 4.6, which the hosted app runs; Opus 5.5 would need this revisited). The shift wording (decision 81) uses the one-shot structured call at low effort, with no tools.

**What AI is not used for:** the ledger arithmetic, the settlement calculation and the decision that a payment happened. Those are plain deterministic code reading PayPal's records.

**Where Kin reaches Claude: Amazon Bedrock** (decisions 58 and 67 in `architecture.md`). The project owner runs Anthropic's models on Bedrock, with AWS credentials and no Anthropic key, through `@anthropic-ai/bedrock-sdk`. `KIN_BEDROCK_API` picks the endpoint: `mantle` (the default; `AnthropicBedrockMantle`, model ID `anthropic.claude-opus-5-5`) or `invoke` (Bedrock Runtime InvokeModel, `AnthropicBedrock`, model ID `us.anthropic.claude-opus-4-6-v1`). The hosted app uses `invoke` because its AWS account is not entitled to Opus 5.5 on the Mantle endpoint; moving to Opus 5.5 is setting `KIN_BEDROCK_API=mantle` and `KIN_BEDROCK_MODEL=anthropic.claude-opus-5-5` once AWS grants it, then re-running every evaluation set in `packages/agent/evals`. Both adapters send the same Messages body (low effort, `output_config.format` json_schema, no tools, no prefill, which Opus 4.6 refuses), and the reply is validated by the caller. The settings above apply unchanged on Bedrock, except that Opus 4.6 is not the model those lines were written for: re-check the effort and tool-choice lines against it.

---

## 7. Voice

Claude's API takes text and images, not audio, so speech needs its own services.

| Need | Recommended | AWS alternative |
|---|---|---|
| Speech to text | Deepgram | Amazon Transcribe |
| Text to speech | ElevenLabs | Amazon Polly |
| Phone calls to and from the parent | Twilio voice | Amazon Connect or the Amazon Chime SDK |

**Chosen: Amazon Transcribe and Amazon Polly** (decision 59 in `architecture.md`), in the same AWS account as Bedrock, with no new vendor keys. Transcribe streaming hears all seven of Kin's languages; Polly has neural voices for all but Hebrew (Danielle, Léa, Vicki, Lucia, Bianca, Hala), so in Hebrew Kin's words are shown, not spoken.

- **Phone calls are the parent's main channel.** Kin rings an ordinary phone, including a landline, and speaks. This avoids the limit that a web app cannot wake a locked phone.
- **In the app,** the same speech services run through the browser microphone.
- **Choose the voice by ear.** Warmth and clarity matter more for an 81-year-old listener than any benchmark. Compare the candidates with a real older listener before deciding.
- **Languages.** Pick services that cover every language your pilot families speak.

---

## 8. Compute: AWS ECS on Fargate

> **Today:** the web app and the voice service run on AWS App Runner (architecture decisions 35 and 85), each serving https at its own address without a domain, and there is no load balancer. Only the worker runs on Fargate. The design below is the target for live audio, which needs long-lived connections; Twilio's webhooks, as built, are short requests.

- **Three Fargate services** from one container image: web, voice and worker.
- **Application Load Balancer** in front of web and voice, with HTTPS certificates from AWS Certificate Manager and a domain in Route 53.
- **Why Fargate and not a serverless-only setup:** live calls need connections that stay open for minutes, and PayPal webhooks need an endpoint that is always awake.
- **Docker.** One multi-stage Dockerfile builds one image. Web, voice and worker start from it with different commands. Docker Compose runs them with PostgreSQL for local development.
- **Match the processor architecture.** Build the image for the architecture Fargate runs.
- **Amazon ECR** stores the images.
- **Amazon CloudFront** in front of the load balancer is optional, for static assets and caching.

---

## 9. Authentication and authorization: Amazon Cognito

### 9.1 Authentication

- **One Cognito user pool** holds every person: siblings, parents, caregivers and professionals.
- **Passwordless sign-in.** A one-time code by email, or a passkey. Nobody in a family should have to remember a password for Kin.
- **Cognito managed login** for the sign-in pages, so Kin does not build or host credential forms.
- **Log in with PayPal as a federated identity provider.** Cognito accepts OpenID Connect providers, and Log in with PayPal is built on OpenID Connect. This lets a sibling sign in with the PayPal account they will pay from.
- **Multi-factor authentication** required for organizers and for anyone who can approve a payout.
- **Tokens.** Cognito issues signed tokens. Each service verifies them with the `aws-jwt-verify` library before doing anything.

### 9.2 Authorization

Cognito answers "who is this?" Kin's database answers "what may they do in this circle?" Both are needed, because one person can hold different roles in different circles.

| Level | Held in | Examples |
|---|---|---|
| Account type | Cognito groups | family member, caregiver, professional, administrator |
| Role in a circle | Aurora, checked on every request | organizer, contributor, parent, caregiver, observer |
| Limits and approvals | Aurora, from the family agreement | spending thresholds, who must approve, second approval above an amount |

- **Cognito groups** give coarse access, such as whether someone sees the caregiver screens or the family screens.
- **Per-circle roles** are enforced in the service on every request. A caregiver can see only their own bills. An observer can read and never write.
- **Row-level security in Aurora** is a second line of defense, so a coding mistake in the service cannot expose another family's data.
- **Amazon Verified Permissions** is an option later if the rules outgrow simple role checks. It is not needed for the hackathon.

### 9.3 The parent on a phone call

A phone call is not a browser session, so Cognito does not sign the parent in there.

- **Outbound calls** go only to the number the family registered for the parent.
- **Inbound calls** are matched to that number, and the parent confirms with a short spoken phrase or PIN before Kin discusses money.
- **Approvals given by voice** are recorded with the call reference, the time and the words confirmed.
- The voice service acts with its own service identity and is limited to that one parent's circle.

### 9.4 Service access

- **Kin's own MCP server** (built, decision 93) makes Kin usable by a member's own AI assistant. It is protected by delegation tokens the member grants and revokes in Kin; Cognito-issued OAuth tokens with PKCE are **Planned, not built**.
- **Service-to-service calls** inside AWS use IAM roles, not shared keys.

---

## 10. Database: Amazon Aurora Serverless v2

- **Aurora Serverless v2, PostgreSQL-compatible.** It scales capacity up and down with load, which suits a demo that is idle most of the day and busy when a judge arrives.
- **Access library:** Drizzle ORM (`drizzle-orm` 0.45) over node-postgres (`pg` 8), with `drizzle-kit` generating migrations kept in `packages/db/migrations`. Drizzle infers every row type from the one schema in `packages/db/src/schema`, and its enums are built from the money core's own constants. Row-level security, roles, triggers and grants are plain SQL in a hand-written migration (`0001_security.sql`), so nothing about access is hidden behind the library (architecture decision 37).

**How the data is kept:**

- **An append-only ledger.** Entries are never edited or deleted. Corrections are new entries. This is what makes the audit export trustworthy.
- **Money as whole cents** in integer columns, with the currency stored beside each amount. No floating-point arithmetic anywhere.
- **Approvals as records.** Each one stores who approved, when, by what means and for which movement.
- **PayPal events stored as received**, each with its PayPal identifier, so every ledger entry can be traced to the event that caused it.
- **Row-level security** by circle.

**Operating notes:**

- **Minimum capacity.** Aurora Serverless v2 can pause when idle and takes several seconds to resume. During the judging period, set a minimum capacity above zero so a judge's first visit is not slow.
- **Backups** with point-in-time recovery switched on.
- **Encryption at rest** with AWS KMS.

---

## 11. Files, queues and schedules

- **Amazon S3** stores photographs of receipts, bills and letters. Uploads go straight from the phone to S3 through short-lived signed links. Buckets are private and encrypted.
- **Amazon SQS** carries work that should not block a request: processing a PayPal webhook, reading a photographed bill, sending a notification. Each queue has a dead-letter queue. Locally, ElasticMQ (`softwaremill/elasticmq-native` in Docker, `pnpm queue:up`) answers SQS's API, so the web app and the worker run the same code as in AWS. The SQS client is `@aws-sdk/client-sqs`, the same SDK family and version as the Secrets Manager client already in use.
- **Amazon EventBridge Scheduler** triggers the timed work: monthly settlement, the monthly statement, refill reminders and the parent's scheduled calls.
- **Amazon SES** sends email, including statements and sign-in codes.

---

## 12. Infrastructure, delivery and monitoring

- **AWS CDK in TypeScript** defines every resource, so the whole environment can be recreated from the repository. This also serves the rule that the repository must contain everything needed to run the project.
- **GitHub Actions** builds, tests and deploys. It signs in to AWS through OpenID Connect, with no long-lived keys stored in GitHub.
- **AWS Secrets Manager** holds the PayPal credentials, the Claude key and the speech and telephony keys.
- **Amazon CloudWatch** for logs, metrics and alarms. Alarms on failed webhooks, failed payouts and queue backlogs.
- **AWS WAF** on the load balancer is optional, for rate limiting on public endpoints.

---

## 13. Security

- **Least privilege.** Each Fargate service has its own IAM role with only the access it needs.
- **No secrets in the repository or the container image.**
- **Webhook signatures verified** for PayPal and for the telephony provider.
- **Encryption** in transit everywhere and at rest in Aurora and S3.
- **Minimal personal data.** Financial records and receipts only. No medical records.
- **Audit trail** of every sign-in, approval and payment movement.

---

## 14. Testing

- **Vitest** for unit tests. The ledger and the settlement calculation get the heaviest coverage, because they are the heart of the fairness claim.
- **Playwright** for end-to-end tests of the main journeys in a real browser.
- **PayPal sandbox** with seeded personal and business accounts for each member of the demo family.
- **PayPal webhook simulator** to replay payment events.
- **PayPal negative testing** to prove Kin behaves correctly when a payment fails, is declined or is reversed.
- **Recorded test calls** for the voice flows.

---

## 15. Sponsor tools

A project can win one sponsor prize, so the aim is one strong fit.

| Tool | Use in Kin | Verdict |
|---|---|---|
| **AG Grid** | Family ledger, bills list, audit export | Use. Best fit and largest sponsor prize |
| **APIMatic** | Context plugins while coding the PayPal integration | Use during development |
| **Postman** | Sandbox testing, and a published collection for judges | Use |
| **Channel3** | Product search inside the purchasing agent | Use if the purchasing agent searches real catalogs |
| **Render** | Hosting | Not used, because hosting is on AWS |
| **Bryntum** | The care calendar: a week of shifts with a row for each person (`apps/web`, `components/dashboard/shifts`). The trial build, approved by the owner on 8 November 2026, is read-only and loaded only on the calendar page, as a static file the browser fetches at runtime and the bundler never reads (architecture decision 84). Its install script is off, and a licensed build is a change of the npm alias | Use |
| **Elastic, KERNEL, Zapier, Astropods** | No natural role | Skip |

---

## 16. Things to settle on day one

Each of these should be tried against the real services before the build depends on it.

1. **How the agent connects to PayPal's tools.** Try the MCP server and the toolkit's other adapters with Claude, and keep whichever is more reliable.
2. **Payouts.** The Agent Toolkit has no payout tool. Confirm that Payouts is enabled on the sandbox business account and call the REST API directly.
3. **Subscriptions in the sandbox.** Billing happens in real time and cannot be fast-forwarded. Confirm the shortest billing cycle the sandbox allows, and plan to use short cycles or simulated webhook events for the demo.
4. **Log in with PayPal through Cognito.** Confirm that PayPal's OpenID Connect endpoints work with Cognito federation. If they do not, keep email codes and passkeys, and link each sibling's PayPal account at the first payment.
5. **Text-message sign-in codes.** Cognito sends them through Amazon SNS, which starts in a restricted mode and takes time to open up. Use email codes for the hackathon.
6. **Live call audio on AWS.** Confirm that the load balancer and the voice service hold a connection for the length of a real call.
7. **Pay Later.** Availability depends on the buyer's country, including in the sandbox. Treat it as optional.

---

## 17. Access for judges

- **A hosted demo** at a stable address, with a one-click demo mode.
- **Seeded demo accounts** in Cognito for each role, with the sign-in details in the README.
- **Matching sandbox PayPal accounts** for each demo person.
- **A reset script** that returns the demo family to its starting state.
- **A demo phone number** judges can call to hear the parent's experience, or a recorded call if a live number is not practical.
- **Full setup instructions** in the repository, so a judge can also run it themselves.

---

## 18. Cost and running through judging

- The environment must stay up from submission on 12 November until winners are announced on 21 December 2026: the demo, its credentials and any trials it relies on. No edits after the submission deadline.
- Keep Fargate tasks small and Aurora's maximum capacity low.
- Set an AWS billing alarm before deploying anything.
- Set spending limits on the Claude, speech and telephony accounts, since the demo is public.

---

## 19. How certain each part is

**Checked against the source during this session:**

- The hackathon's technology rules and sponsor list.
- The PayPal Agent Toolkit's tool list, including the absence of a payout tool.
- The PayPal sandbox MCP server address and transports.
- The Claude model identifiers and the behavior notes in section 6.
- Claude in the hosted app: `kin:claude` is `true` and the deployed model is `us.anthropic.claude-opus-4-6-v1` through Bedrock InvokeModel (`infra/src/web-stack.ts`). The fixed evaluation sets in `packages/agent/evals` are run by hand against the real model (`pnpm --filter @kin/agent run eval`, `eval:documents`, `eval:agent` and the others in its `package.json`), and each run is kept in `packages/agent/evals/results/`: on Opus 4.6 through InvokeModel, visits 12 of 12 and documents 8 of 8 (10 November 2026), Ask Kin 15 of 15 (11 November 2026), and every other set passing in full.

**Written from general knowledge and to be confirmed before relying on it:**

- Aurora Serverless v2 pause and resume behavior.
- Cognito's passwordless sign-in options and its handling of OpenID Connect providers.
- The need for Amazon SNS configuration before Cognito can send text messages.
- The capabilities of the speech and telephony services named in section 7.
