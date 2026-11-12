# Kin: feature designs

Feature designs that extend Kin. Draft 2, 11 November 2026 (first written 13 October 2026).

**What is built now.** Parts of all five are built; each section's status note says which parts. (1) Spoken mandates: the mandate tables, checker, refill approval and family screen (`architecture.md` decision 64). (2) The office line: the call logic, the screen at `/dashboard/office-line` and the Twilio webhook service `apps/voice`, hosted on App Runner (decisions 68 and 85). (3) The auditor: `packages/verify` with `kin-verify`, the kept chain heads and the auditor panel at `/dashboard/record/verify` (decision 66). (4) The simulator: `simulateScenario` in `packages/domain` and the screen at `/dashboard/circle/agreement/simulate` (decision 65). (5) Cross-border circles: only a member's agreed share shown in their own currency at a fixed rate labelled simulated (`packages/domain/src/currency-conversion.ts`, on the Fairness page). Everything a section lists as not built is still a design, and `AGENTS.md` section 1 applies: build it only from an approved spec.

These five features extend Kin as described in `project-description.md` and `architecture.md`. None changes Kin's direction. Each deepens one of the two ideas that make Kin new (fairness as a payout, payment events as speech) or the rule behind both (the AI proposes, people approve, the record decides).

| # | Feature | One line | Status | Estimated effort when designed |
|---|---|---|---|---|
| 1 | Spoken mandates | The parent's voice becomes a bounded standing permission the agent buys under | Partly built (decision 64) | ~4 days |
| 2 | The family office line | Kin takes the scam call so the parent never has to | Partly built and hosted (decisions 68, 85) | ~3 days |
| 3 | The independent auditor | A tamper-evident ledger, an offline verifier, and a second AI that checks the first | Partly built (decision 66) | ~4 days |
| 4 | The rehearsable agreement | Policy as code, a what-if simulator, a dry-run month | Simulator built (decision 65) | ~3 days |
| 5 | Cross-border circles | One fair pool for a family in three currencies | Display only, simulated rates | ~3 days |

---

## 1. Spoken mandates: the parent's standing permission

> **Status: built for the demo** (decision 64 in `architecture.md` section 21). Built: the `mandates` and `mandate_uses` tables, the pure checker in `packages/domain/src/mandate.ts`, the mandate-match approval in `propose_refill`, the family screen at `/dashboard/circle/mandates`, Rose's seeded permission in the demo circle, and the simulated seller's allowance check. Not built: speech capture and the Claude compile of a spoken grant, the agent tools `propose_mandate`, `list_mandates` and `revoke_mandate`, voice review and revoke, the sibling co-signature above a limit, the merchant-initiated PayPal capture with `custom_id`, and the demo pharmacy's HTTP allowance.

### What it is

Rose grants Kin a bounded standing permission by voice, once: "You may order my blood pressure medication every month, up to fifty dollars, from the pharmacy." Kin compiles it, reads it back, records her confirmation, and from then on the purchasing agent acts within it without calling her each time. Anything outside it still needs a live yes.

### Why it matters

- Agentic commerce as PayPal, Google and OpenAI now define it runs on mandates. Google's AP2 protocol, which PayPal co-launched in September 2025, has an intent mandate, a cart mandate and a payment mandate. PayPal's ACP integration issues a delegated token bound to an allowance: merchant, maximum amount, currency, expiry. Kin brings that structure to the one buyer those protocols forget: a person who cannot read a screen.
- It is the deepest possible form of "the agent proposes, people approve". The approval moves from per-purchase to per-mandate without weakening, because the check that a cart fits a mandate is plain code.
- It fixes a real product flaw. Calling an 81-year-old for every refill trains her to say yes to everything. Mandates make the agent useful and keep her in charge.
- It produces a verifiable chain from spoken words to a PayPal capture that anyone reviewing the record can follow line by line.

### How it works

1. **Grant.** Rose speaks the permission on a call or in the app. Claude extracts it into a strict schema: payee or category, merchant, maximum per purchase, maximum per period, cadence, start and expiry, and what to do when exceeded. Nothing outside the schema is accepted. Kin reads the compiled mandate back in full. Rose confirms. The voice-approval evidence (call reference, read-back sentence, reply) is attached and the mandate is signed with Kin's key. The agreement can require a sibling co-signature above a limit. A new merchant always needs the family.
2. **Use.** When the scheduler says a refill is due, the purchasing agent builds a cart. The cart becomes a cart mandate: exact items, merchant, total, currency, time. A pure function in `packages/domain` checks it: mandate active and unexpired, circle not paused, merchant and category in scope, total within the per-purchase cap, period total within the period cap, cadence satisfied. Pass: the proposal is approved with the mandate recorded as the approver and executes through the existing outbox path. Fail: it falls back to a live spoken approval, and Rose hears why ("the price has gone up to 80 dollars, more than you allowed").
3. **Record.** The PayPal order carries the mandate ID in `custom_id`, so PayPal's own record references the permission. The ledger entry links mandate, cart, approval and PayPal capture.
4. **Review and revoke.** "What have I allowed you to do?" reads the mandates aloud. "Stop ordering the supplements" revokes one, with read-back and confirmation. The monthly statement lists mandate purchases separately. The family sees every mandate and any member can pause one.

### PayPal and AI

- **PayPal.** Orders v2 captured by the merchant with the pool's saved payment token (already designed). `custom_id` carries the mandate reference. Transaction Search proves every agent purchase traces to a mandate. Shipment tracking follows the delivery.
- **The demo pharmacy becomes an agent-ready merchant.** It exposes a checkout session and a `complete_checkout` tool that enforce an allowance (`merchant_id`, `max_amount`, `currency`, `expires_at`), the same four fields PayPal documents for delegated tokens in its ACP integration. The mandate's cap becomes the allowance, so the merchant refuses any charge beyond it: a second, independent enforcement point. Label it as a mirror of the published contract, not as enrollment in Agent Ready, which is gated.
- **AI.** Claude compiles speech into the mandate schema with strict structured output, words the read-back and the narration, and explains an exceedance. It never decides whether a cart fits. Code does.

### The demo moment

Day 1: Rose grants the mandate by voice. Day 9: the refill is bought silently and Rose hears "I ordered your refill for 64 dollars under the permission you gave me on the first." Day 23: the pharmacy's price rises to 80 dollars, the check fails, and Kin calls Rose to ask. Thirty seconds that show bounded autonomy.

### What to build

- Tables `mandates` (circle, grantor, scope, caps, cadence, validity, signature, evidence, status) and `mandate_uses` (mandate, proposal, amount, period).
- `packages/domain/mandates`: schema, checker, period accounting. Property tests: no purchase outside a mandate ever executes without a live approval; a period cap is never exceeded.
- Agent tools: `propose_mandate` (parent, sibling), `list_mandates`, `revoke_mandate` (parent, with read-back). The approval engine gains a rule between auto-pay and the parent's decisions: "mandate match" as a standing approver.
- Demo merchant: checkout session and allowance check.
- Voice flows for grant, review and revoke. A mandates panel for the family.

### Guardrails and risks

- Caps are hard. A mandate cannot exceed the agreement ceiling or the parent's threshold, and mandate purchases count toward the monthly budget.
- Verification before granting a mandate is the same as for any voice approval. Three failures drop the parent's level.
- Risk: merchant-initiated capture in the sandbox. The fallback already exists (a member's wallet, reimbursed at settlement).

---

## 2. The family office line: Kin takes the call

### What it is

The family registers a phone number for Rose's money matters. Rose gives it to anyone who asks her for money ("call my family's office"), or taps one button to hand a live caller to Kin. Kin's receptionist takes the demand, checks it against the real record in seconds, answers the caller from a fixed set of replies, never pays, never discloses, and sends the family a transcript and verdict before the call ends.

### Why it matters

- The present claim check works after the call, once Rose remembers to ask. Scams work through pressure in the moment. Putting Kin between the caller and the parent turns a feature into a protection.
- The verdict comes from PayPal's record, not from a model's judgment: PayPal's data is the ground truth for a safety decision.
- It extends an existing feature (the claim check) over an existing channel (Twilio voice).

### How it works

1. **Entry.** An inbound call to the circle's Kin number, a transfer or conference from Rose's phone, or the lighter "listen" variant: Rose puts the caller on speaker and says "Kin, is this real?" into the app.
2. **Disclosure.** Kin states that it is an automated assistant for the family and that the call is recorded.
3. **Intake.** The receptionist asks who is calling, from which organization, how much, for what, and any account reference. Claude extracts a structured claim. The receptionist has exactly two tools, `check_payment_claim` and `alert_circle`, and cannot see balances, names or history.
4. **Verdict by code.** The existing four-way lookup: already paid, known and due, no record, unknown sender.
5. **Reply from a fixed script per verdict.** The model chooses tone and language only; the number guard applies. Already paid or known and due: "That account is handled by the family and is up to date. Please send any correspondence in writing to the address on file." No record or unknown: "I have no record of this account. This family does not make payments by phone. Please send the invoice in writing." The caller never hears an amount, a date or a name.
6. **Evidence and alert.** The call session stores the claim, transcript, caller number and verdict. The family receives a two-line alert. Repeated calls, urgency and secrecy raise the circle's existing pressure flag.
7. **Legitimate billers benefit too.** A real utility hears that its bill is scheduled.

### PayPal and AI

- **PayPal.** Transaction Search and the stored webhook record are what the verdict reads. Nothing is paid.
- **AI.** The intake conversation, extraction, and phrasing in the caller's language. A pressure classifier over the transcript (urgency, secrecy, threats) can raise the flag and never lower it.

### The demo moment

Rose's phone rings. "Your gas is being cut off today unless you pay 300 dollars." Rose says "please call my family's office" and hands over. Kin: "I have no record of this account. This family does not make payments by phone." Elena's phone buzzes: "Unknown caller demanded 300 dollars for gas. Your gas bill of 57 dollars was paid on the 2nd. No action needed." Rose never had to argue.

### What to build

- Twilio: a number per circle, or one number with routing by the parent's registered number, plus transfer or conference from the parent's app.
- A receptionist persona in `packages/agent`: its own system prompt, two tools, fixed reply templates, the pressure classifier with structured output.
- `claim_checks` extended with caller metadata and a transcript reference. Alerts.
- A fixed test set of about thirty scripted scam and legitimate calls. Measure verdict accuracy and non-disclosure: assert that no reply contains an amount, date or name outside the script.

### Built so far

The call logic is plain code: `packages/domain/src/office-line.ts` (intake, `checkClaim` verdict, pressure rules, the closed set of sentences) behind the `CallLine` interface of `packages/telephony`, with a scripted fake line. The dashboard's "try the office line" screen (`/dashboard/office-line`) plays a written caller through the same `takeCall`, records an `office_calls` row (circle-scoped, row-level security) with its claim check, and alerts the family. The phone line is built to Twilio's webhook contract (`apps/voice`, `packages/telephony`; architecture decision 68): signed requests, `<Say>` and `<Gather>` TwiML, the same `takeCall` conducted a turn at a time, the call recorded as a real call with its claim check and the family's alert, and `pnpm --filter @kin/voice run simulate-call` plays a signed call without a Twilio account. The service is hosted on App Runner as `KinVoice` (decision 85); a call through a real Twilio number is not yet verified (`apps/voice/README.md`). Not built: transfer or conference from the parent's app, Claude extraction and phrasing (replies are fixed per language, so nothing is left for a model to disclose), and the thirty-call evaluation set.

### Guardrails and risks

- The receptionist can be lied to and it changes nothing: no write tools, scripted outputs, no data in replies.
- Recording consent: announce it, and keep transcript text rather than audio by default, consistent with the existing policy.
- Risk: a live demonstration depends on telephony. Keep a recorded call as the fallback.

---

## 3. The independent auditor: a ledger that proves itself, and a second AI that checks the first

### What it is

Two layers. The ledger becomes tamper-evident, and the monthly audit export carries enough to be verified by anyone, offline, with a small open-source verifier shipped in the repository. On top, an independent auditor agent with read-only access and no shared context with the family agent reviews each month, reconciles it against PayPal, and writes findings in plain language. The observer (the family lawyer) can run it on demand or connect their own agent through the Kin MCP server.

### Why it matters

- "Its record stands up to scrutiny" is one of Kin's five differentiators. Without this it is a design claim. This makes it a property anyone can test by running one command.
- A hash-chained, signed, reproducible ledger reconciled against PayPal is what an accountant, a lawyer or a court can rely on without trusting Kin.
- Court-supervised guardians and conservators must file periodic accountings, and professional fiduciaries and elder-law attorneys are Kin's professional plan. Elder financial abuse is most often committed by someone close; an auditor that does not care who asks is protection from the inside.
- The auditor's ground truth is PayPal's transaction history.

### How it works

**Layer 1: the tamper-evident record.**

- Each ledger entry stores a hash of its content together with the previous entry's hash, per circle. A reversing entry chains like any other. Approvals are signed with a KMS key over proposal, amount, payee, member, time and method. PayPal events keep the raw body, transmission headers and verification result.
- The audit export is a bundle: ledger, approvals, PayPal events, settlements with their input snapshots, the documents, a manifest with the chain head and Kin's public key, and a PDF rendering.
- `kin-verify`, a CLI in `packages/verify`, recomputes the chain, checks the signatures, recomputes every settlement from its snapshot with the same `domain` code, and, given sandbox read credentials, replays Transaction Search for the period and diffs it. It prints a one-page verdict. It also runs in CI against a golden export.

**Layer 2: the auditor agent.**

- A distinct role: separate system prompt, read-only tools through the Kin MCP server and the same gateway, no access to the family agent's conversations. Runs at month close and on demand by the observer or organizer.
- Code performs the checks and the model orders and explains them: every movement has an approval and a receipt; no self-approval; every new payee was announced; caregiver hours against the visit schedule; amount drift per payee; mandate exceedances; reconciliation differences; pause events; claim checks and their outcomes.
- It writes a findings report with severity, evidence links and a recommendation, attached to the statement. The organizer acknowledges each finding, and the acknowledgement is recorded.
- It computes the seven impact metrics from section 13 of the product description (decisions answered by the parent, days from visit to caregiver pay, demands checked and money not lost, the fairness gap, and the rest) so impact is measured, not claimed.

### PayPal and AI

- **PayPal.** Transaction Search through the Agent Toolkit's read tools as the reconciliation source; stored webhook signatures; captures and payouts referenced by PayPal ID.
- **AI.** The auditor narrates, prioritizes and explains in a separate model context from the family agent. The number guard applies to its report.

### The demo moment

Elena opens the audit export, and `kin-verify october.zip` prints: chain intact across every entry, all approval signatures valid, settlement reproduced exactly, zero differences against PayPal. Then the auditor's single finding appears: "Amara billed four hours on a day with no scheduled visit. Approved by Elena. Receipt attached. Recommend confirming with Amara."

### What to build

- Hash and signature columns and the chain rule in `domain`. The export bundle builder in the worker. `packages/verify`.
- The auditor role in the agent package, MCP read tools, a findings schema and table, the acknowledge flow, the impact-metrics job.
- Tests: any mutation of an exported entry fails verification; the golden export verifies in CI.

### Built so far

- `packages/verify` and `kin-verify <export.json> [--head <hash>]`: recomputes a per-circle SHA-256 hash chain, re-checks every ledger rule (`auditLedger` in `domain`), recomputes the balances and each settlement from the entries, and checks every figure in the sentences Kin showed. Try it with `pnpm --filter @kin/verify run sample out.json` then `... run kin-verify out.json`.
- The chain is computed at export time from the ledger, so no ledger table changed. Tamper evidence comes from the heads Kin kept (`audit_heads`, decision 66): each visit to the verify screen and each download keeps the current head, and every export carries them, so a changed or removed past entry fails without any outside note. They sit in Kin's own database, so an administrator of it could rewrite both; saving a head elsewhere (`--head`) closes that. Recording heads at the month's close, external anchoring, KMS-signed approvals, the PayPal Transaction Search diff, the findings table with acknowledgement and the impact metrics are not built.
- The dashboard screen `/dashboard/record/verify` shows the verdict and an auditor panel (separate prompt, no tools, `reviewFindings` in `packages/agent`): plain code decides every finding, the model only words it, and a sentence with a figure the code did not supply falls back to the fixed one.

### Guardrails and risks

- The export contains no medical data, as policy already requires.
- The auditor reads and writes findings only. It cannot approve, pause or move money.
- Risk: Transaction Search lag. The verifier uses a window ending hours in the past, as nightly reconciliation already does.

---

## 4. The rehearsable agreement: policy as code, a what-if simulator, a dry-run month

> **Status: the simulator is built** (decision 65 in `architecture.md` section 21). Built: `simulateScenario` in `packages/domain`, which rehearses a share change, a member stepping back, other approval amounts and a large bill by calling the real `settlePeriod` and `planApprovals` on a copy of the circle's state, and the read-only screen at `/dashboard/circle/agreement/simulate`. Not built: the compiled policy schema with stored versions, the agent tool `simulate_scenario`, voice phrasing, the dry-run settlement view, the diff view and the forecast job.

### What it is

The family agreement is already drafted in plain language. Now it compiles into a versioned, executable policy, and anyone can rehearse the future against it. "What if the stairlift repair costs 900 dollars?" "What if Ana's share drops to 10 percent and her hours count at 20 dollars?" Kin runs the real approval engine and the real fairness calculator on a copy of today's state and answers exactly: who must approve, who pays what, what settlement follows, what Rose would be asked. Changes to the agreement appear as a diff, explained in words, and take effect only when every member accepts. The parent hears the change.

### Why it matters

- Fairness as a payout is Kin's first new primitive, and the simulator is how a family comes to trust it: same inputs, same answer, before any money moves. Conflicts come from surprises; this removes them.
- It is the most visible proof that the money core is deterministic and the AI only drafts. A family money product without a what-if is incomplete.
- Expense tools show balances. None lets a family rehearse a decision through the actual rules engine.
- It deepens agentic commerce. The agent uses the simulator itself before proposing, for example choosing Pay Later for the stairlift because a one-off top-up would exceed Ana's affordable share.

### How it works

1. **Compile.** The agreement conversation becomes a strict policy schema: shares in basis points, thresholds, approval rules, care rate and cap, mandate limits, calling hours, currencies. Structured output, then code validation (shares sum to 10,000, thresholds ordered). Every version is stored, and every settlement and approval records the version it ran under, as already designed.
2. **Simulate.** A pure function in `packages/domain`: policy, snapshot and a list of hypothetical events (a bill, a purchase, a share change, a member pausing, a mandate, a care-hour change, a month close) return the required approvals, the pool's balance path, each member's position, the proposed settlement, the prompts the parent would hear, and any rule that would refuse.
3. **Expose.** An agent tool `simulate_scenario` for every family role, so the parent can ask "what happens if I say no?" A "Try it" panel beside the agreement and beside any large proposal. On voice, Kin answers in words with the result's numbers, checked by the number guard.
4. **Dry-run month.** Before settlement approval, the family sees the exact invoices and payouts that will be sent, with the input snapshot. Approving the settlement approves exactly that.
5. **Renegotiate.** A proposed change produces a diff, an explanation, and a simulation of next month under the old and new versions. Members accept, Rose hears it, the version increments.
6. **Forecast.** The worker projects the next three months from subscriptions, auto-pay bills, mandates and history, warns when the pool would fall short, and proposes options through the simulator.

### PayPal and AI

- **PayPal.** The simulation returns the exact PayPal actions that would follow (invoices, payouts, a Pay Later session), so the family sees PayPal's part before it happens. Pay Later eligibility is checked through the SDK where the sandbox allows.
- **AI.** Compiles, explains diffs, words results, suggests options. Never computes.

### The demo moment

Elena: "What if the stairlift repair is 900 dollars?" Kin: "The pool holds 610. A one-off top-up would be 145 from Marcus, 87 from you and 58 from Ana. Rose must approve because it is above 50, and a second approval is needed because it is above 500. Or the family can spread it over six months with Pay Later." They choose. The month closes with no surprises.

### What to build

- Policy schema, compiler and validators. The simulate function with property tests: simulating a real event sequence equals the real outcome, and a simulation never writes.
- The tool, the panel, voice phrasing, the dry-run view on settlement, the diff view on the agreement, the forecast job.

### Guardrails and risks

- Simulations are labelled and never create proposals by themselves.
- Risk: scope creep in the UI. Start with three scenario types: a large bill, a share change, a month close.

---

## 5. Cross-border circles: a family in three currencies, one fair pool

> **Status: display only.** Built: `convertMoney` and a fixed rate table in `packages/domain/src/currency-conversion.ts` (integer rates, stamped, labelled simulated), and the Fairness page showing a member who gives in another currency (Marcus, in euros, in the demo) their agreed share in that currency, marked "simulated rate". Not built: conversion taken from PayPal's record, conversion-cost ledger lines, per-currency subscription plans, invoices and payouts, and narration per currency. Sandbox multi-currency behavior is unverified (`architecture.md` section 23).

### What it is

Marcus lives abroad and pays his share in euros. The pool is in dollars. A caregiver may be paid in a third currency. Kin keeps each amount in its own currency, records the conversion PayPal actually applied, treats conversion cost like fees (a shared cost of the circle), computes fairness in the pool currency, and speaks to each person in their own currency and language.

### Why it matters

- Families spread across countries are Kin's stated wider audience and the roadmap's next step. The diaspora caring for a parent at home is one of the largest money flows in the world. The World Bank put remittances to low- and middle-income countries at roughly $685 billion in 2024; confirm the figure before citing it.
- Cross-border is PayPal's home ground. Doing it correctly means integer cents and conversion taken from PayPal's record, never from a model or a rate guess.
- It stresses the money core in the right way while keeping the same primitive: fairness as a payout, now across borders.

### How it works

1. **Conversion as a ledger fact.** Ledger lines already carry a currency. When a contribution arrives in euros and settles into the dollar pool, the ledger records the gross in the member's currency, the converted amount in the pool currency, and a conversion-cost line, all from PayPal's transaction records and never from an external rate.
2. **Fairness in pool currency.** Members are credited with the converted gross, consistent with "credited gross, fees shared", and conversion cost is a shared cost. The statement shows each member in the pool currency and in their own.
3. **PayPal objects per currency.** A subscription plan per member in that member's currency. Top-up invoices in the member's currency. Payouts to a caregiver in theirs.
4. **Narration.** Rose hears dollars, Marcus reads euros, and the number guard checks amounts against the record in the currency spoken.
5. **Policy.** The agreement names the pool currency and each member's currency. Shares are percentages, so the fairness arithmetic does not change.

### PayPal and AI

- **PayPal.** A multi-currency business account, Subscriptions and Invoicing in the payer's currency, Payouts in the recipient's currency, Transaction Search for the conversion records.
- **AI.** Wording in each person's language and currency, and explanation of conversion lines: "Marcus's 180 euros arrived as 192 dollars and 71 cents. The conversion cost 4 dollars and 12 cents, shared by the family."

### The demo moment

Marcus's euro subscription payment lands. The ledger shows the conversion line. Rose hears "Marcus's share arrived." The month's statement shows Marcus in euros and everyone else in dollars, and the settlement payout to Elena goes out in dollars.

### What to build

- Currency on the agreement and on members. Conversion entries in `domain`. Statement rendering per currency. A plan per currency. Payout currency. A euro sandbox account for Marcus.
- Tests: rounding never creates or loses a cent in any currency; conversion lines balance.

### Guardrails and risks

- Day-one sandbox check: can a sandbox business account receive euros and hold a dollar balance, and pay out in euros. If conversion behaves differently in the sandbox, label simulated conversions, consistent with demo mode's honesty rule.
- Do not promise rate optimization. Kin records what PayPal did.

---

## 6. Two smaller additions worth carrying

- **A production path for the pool account.** PayPal Partner Referrals onboarding, so Kin acts on a family's account as a platform with granted permissions and never holds credentials. It answers the architecture's largest open question (section 22.2). It is infrastructure rather than a visible feature, and is listed as next work.
- **A live impact panel.** The seven metrics from section 13 of the product description, computed from the record and shown in the family's view, so impact is measured rather than claimed. About half a day.

---

## 7. Build order

Order as designed: 1 (mandates), 2 (office line), 3 (auditor and verifier), 4 (simulator), 5 (cross-border). 3 and 4 reuse domain code. Total about 17 days on top of the essential spine named in section 22.3 of the architecture. If time runs short, cut 5 first, then the forecast part of 4.

---

## 8. Sources checked on 13 October 2026

- Google's AP2 announcement (16 September 2025) and protocol summaries: intent, cart and payment mandates as signed credentials; PayPal among the launch partners.
- PayPal developer docs: the Agent Ready overview, and the ACP integration page describing the delegated token's allowance fields (`merchant_id`, `max_amount`, `currency`, `expires_at`).
- PayPal tech blog, 16 September 2026: WebMCP support through the JavaScript SDK for Store Sync merchants. "The buyer remains in charge of approving the transaction."
- Not verified in this session: sandbox multi-currency behavior, the remittance figure in section 5, and PayPal's current Agent Ready enrollment rules. Agent Ready and Store Sync are gated programs, which is why feature 1 mirrors the published contract instead of depending on enrollment.
