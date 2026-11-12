# Kin: feature designs

Designs that extend Kin. Draft 2, 11 November 2026 (first written 13 October 2026). Decision numbers refer to `architecture.md` section 21.

They build on Kin as `project-description.md` and `architecture.md` describe it without changing its direction. Each deepens one of Kin's two new ideas (fairness as a payout, payment events as speech) or the rule behind both (the AI proposes, people approve, the record decides).

Parts of all five are built, as each section's status note says. Anything listed as not built is still a design; under `AGENTS.md` section 1, build it only from an approved spec.

| # | Feature | One line | Status |
|---|---|---|---|
| 1 | Spoken mandates | The parent's voice becomes a bounded standing permission the agent buys under | Partly built (decision 64) |
| 2 | The family office line | Kin takes the scam call so the parent never has to | Partly built and hosted (decisions 68, 85) |
| 3 | The independent auditor | A tamper-evident ledger, an offline verifier, and a second AI that checks the first | Partly built (decision 66) |
| 4 | The rehearsable agreement | Policy as code, a what-if simulator, a dry-run month | Simulator built (decision 65) |
| 5 | Cross-border circles | One fair pool for a family in three currencies | Display only, simulated rates |

---

## 1. Spoken mandates: the parent's standing permission

> **Status: built for the demo** (decision 64). Built: the `mandates` and `mandate_uses` tables, the pure checker in `packages/domain/src/mandate.ts`, the mandate-match approval in `propose_refill`, the family screen at `/dashboard/circle/mandates`, Rose's seeded permission in the demo circle, the simulated seller's allowance check. Not built: speech capture and Claude's compile of a spoken grant; the agent tools `propose_mandate`, `list_mandates` and `revoke_mandate`; voice review and revoke; the sibling co-signature above a limit; the merchant-initiated PayPal capture with `custom_id`; the demo pharmacy's HTTP allowance.

### What it is

Rose grants Kin a bounded standing permission by voice, once: "You may order my blood pressure medication every month, up to fifty dollars, from the pharmacy." Kin compiles it, reads it back and records her yes. The purchasing agent then buys within it without calling her; anything outside it needs a live yes.

### Why it matters

- Agentic commerce, as PayPal, Google and OpenAI define it, runs on mandates. Google's AP2, co-launched by PayPal in September 2025, has intent, cart and payment mandates; PayPal's ACP integration binds a delegated token to an allowance of merchant, maximum amount, currency and expiry. Kin applies this to a buyer who cannot read a screen.
- Approval moves from each purchase to each mandate without weakening, because plain code checks the cart.
- Calling an 81-year-old for every refill trains her to say yes to everything.
- The record traces each purchase from spoken words to PayPal capture.

### How it works

1. **Grant.** Rose speaks on a call or in the app. Claude extracts a strict schema (payee or category, merchant, maximum per purchase and per period, cadence, start and expiry, what to do when exceeded) and nothing else. After a full read-back Rose confirms, the voice evidence (call reference, read-back sentence, reply) is attached, and Kin signs the mandate with its key. The agreement can require a sibling co-signature above a limit; a new merchant always needs the family.
2. **Use.** When a refill is due, the purchasing agent's cart becomes a cart mandate (exact items, merchant, total, currency, time). A pure function in `packages/domain` checks it: mandate active and unexpired, circle not paused, merchant and category in scope, total within the per-purchase cap, period total within the period cap, cadence met. A pass approves the proposal with the mandate as approver, through the existing outbox path. A fail falls back to a live spoken approval, and Rose hears why ("the price has gone up to 80 dollars, more than you allowed").
3. **Record.** The PayPal order carries the mandate ID in `custom_id`, so PayPal's own record references the permission. The ledger entry links mandate, cart, approval and capture.
4. **Review and revoke.** "What have I allowed you to do?" reads the mandates aloud; "Stop ordering the supplements" revokes one after read-back and confirmation. The monthly statement lists mandate purchases separately. The family sees every mandate, and any member can pause one.

### PayPal and AI

- PayPal: Orders v2 captured by the merchant with the pool's saved payment token (already designed), `custom_id` carrying the mandate reference. Transaction Search proves each agent purchase traces to a mandate; Shipment tracking follows the delivery.
- The demo pharmacy becomes an agent-ready merchant: a checkout session and a `complete_checkout` tool enforcing an allowance (`merchant_id`, `max_amount`, `currency`, `expires_at`), the four fields PayPal documents for delegated tokens in its ACP integration. The mandate's cap becomes the allowance, so the merchant itself refuses a larger charge: a second, independent check. Label it a mirror of the published contract, not enrollment in Agent Ready, which is gated.
- AI: Claude compiles speech into the mandate schema with strict structured output, words the read-back and narration, and explains an exceedance. Code decides whether a cart fits.

### The demo moment

Day 1: Rose grants the mandate by voice. Day 9: the refill is bought silently and Rose hears "I ordered your refill for 64 dollars under the permission you gave me on the first." Day 23: the price rises to 80 dollars, the check fails, and Kin calls Rose to ask. Thirty seconds in all.

### What to build

- Tables `mandates` (circle, grantor, scope, caps, cadence, validity, signature, evidence, status) and `mandate_uses` (mandate, proposal, amount, period).
- `packages/domain/mandates`: schema, checker, period accounting, with property tests that no purchase outside a mandate executes without a live approval and no period cap is exceeded.
- Agent tools `propose_mandate` (parent, sibling), `list_mandates` and `revoke_mandate` (parent, with read-back); a "mandate match" standing approver between auto-pay and the parent's decisions.
- The demo merchant's checkout session and allowance check.
- Voice flows for grant, review and revoke; a family mandates panel.

### Guardrails and risks

- Caps are hard: no mandate exceeds the agreement ceiling or the parent's threshold, and mandate purchases count toward the monthly budget.
- Granting needs the same verification as any voice approval. Three failures drop the parent's level.
- Risk: merchant-initiated capture in the sandbox. Fallback: a member's wallet, reimbursed at settlement.

---

## 2. The family office line: Kin takes the call

### What it is

The family registers a number for Rose's money matters. Rose gives it to anyone who asks her for money ("call my family's office"), or taps one button to hand a live caller to Kin. Kin's receptionist takes the demand, checks it against the record in seconds, answers from fixed replies, never pays or discloses, and sends the family a transcript and verdict before the call ends.

### Why it matters

- Today's claim check runs after the call, if Rose remembers; scams work through pressure in the moment. Kin in the middle makes the check a protection.
- The verdict comes from PayPal's record, not a model.
- It reuses the claim check over the existing Twilio voice channel.

### How it works

1. **Entry.** A call to the circle's Kin number, a transfer or conference from Rose's phone, or the lighter "listen" variant: Rose puts the caller on speaker and says "Kin, is this real?" into the app.
2. **Disclosure.** Kin says it is the family's automated assistant and the call is recorded.
3. **Intake.** The receptionist asks who is calling, from which organization, how much, for what, and any account reference. Claude extracts a structured claim. The receptionist has two tools only, `check_payment_claim` and `alert_circle`, and cannot see balances, names or history.
4. **Verdict by code.** The existing four-way lookup: already paid, known and due, no record, unknown sender.
5. **Reply from a fixed script per verdict.** The model picks only tone and language; the number guard applies. Already paid, or known and due: "That account is handled by the family and is up to date. Please send any correspondence in writing to the address on file." No record or unknown: "I have no record of this account. This family does not make payments by phone. Please send the invoice in writing." The caller never hears an amount, date or name.
6. **Evidence and alert.** The call session stores claim, transcript, caller number and verdict. The family gets a two-line alert. Repeated calls, urgency and secrecy raise the circle's existing pressure flag.
7. **Legitimate billers benefit too:** a real utility hears that its bill is scheduled.

### PayPal and AI

- PayPal: the verdict reads Transaction Search and the stored webhook record. Nothing is paid.
- AI: the intake conversation, extraction, and phrasing in the caller's language. A pressure classifier over the transcript (urgency, secrecy, threats) can raise the flag, never lower it.

### The demo moment

Rose's phone rings: "Your gas is being cut off today unless you pay 300 dollars." Rose says "please call my family's office" and hands over. Kin: "I have no record of this account. This family does not make payments by phone." Elena's phone buzzes: "Unknown caller demanded 300 dollars for gas. Your gas bill of 57 dollars was paid on the 2nd. No action needed."

### What to build

- Twilio: a number per circle, or one number routing by the parent's registered number, plus transfer or conference from the parent's app.
- A receptionist persona in `packages/agent`: its own system prompt, two tools, fixed reply templates, a pressure classifier with structured output.
- `claim_checks` extended with caller metadata and a transcript reference; alerts.
- A fixed set of about thirty scripted scam and legitimate calls, scoring verdict accuracy and non-disclosure: no reply contains an amount, date or name outside the script.

### Built so far

- The call logic is plain code in `packages/domain/src/office-line.ts` (intake, the `checkClaim` verdict, pressure rules, the closed set of sentences), behind the `CallLine` interface of `packages/telephony`, with a scripted fake line.
- The "try the office line" screen (`/dashboard/office-line`) plays a written caller through the same `takeCall`, records an `office_calls` row (circle-scoped, row-level security) with its claim check, and alerts the family.
- The phone line follows Twilio's webhook contract (`apps/voice`, `packages/telephony`; decision 68): signed requests, `<Say>` and `<Gather>` TwiML, the same `takeCall` a turn at a time, the call recorded as a real call with its claim check and the family's alert. `pnpm --filter @kin/voice run simulate-call` plays a signed call without a Twilio account.
- Hosted on App Runner as `KinVoice` (decision 85). A call through a real Twilio number is not yet verified (`apps/voice/README.md`).
- Not built: transfer or conference from the parent's app; Claude extraction and phrasing (replies are fixed per language, so a model has nothing to disclose); the thirty-call evaluation set.

### Guardrails and risks

- Lying to the receptionist changes nothing: no write tools, scripted outputs, no data in replies.
- Recording consent: announce it, and keep transcript text rather than audio by default, as existing policy does.
- Risk: a live demo depends on telephony. Keep a recorded call as the fallback.

---

## 3. The independent auditor: a ledger that proves itself, and a second AI that checks the first

### What it is

Two layers. The ledger becomes tamper-evident, and the monthly audit export carries enough for anyone to verify it offline with a small open-source verifier in the repository. On top, an independent, read-only auditor agent, sharing no context with the family agent, reviews each month, reconciles it against PayPal and writes plain-language findings. The observer (the family lawyer) can run it on demand or connect their own agent through the Kin MCP server.

### Why it matters

- It turns "its record stands up to scrutiny", one of Kin's five differentiators, from a design claim into a one-command test.
- An accountant, lawyer or court can rely on a hash-chained, signed, reproducible ledger reconciled against PayPal without trusting Kin.
- Court-supervised guardians and conservators must file periodic accountings, and professional fiduciaries and elder-law attorneys are Kin's professional plan.
- Elder financial abuse is most often committed by someone close, and the auditor treats every asker alike.
- Its ground truth is PayPal's transaction history.

### How it works

**Layer 1: the tamper-evident record.**

- Each ledger entry stores a hash of its content and the previous entry's hash, per circle; a reversing entry chains like any other. Approvals are signed with a KMS key over proposal, amount, payee, member, time and method. PayPal events keep the raw body, transmission headers and verification result.
- The audit export bundles the ledger, approvals, PayPal events, settlements with their input snapshots, the documents, a manifest with the chain head and Kin's public key, and a PDF rendering.
- `kin-verify`, a CLI in `packages/verify`, recomputes the chain, checks the signatures and recomputes every settlement from its snapshot with the same `domain` code. With sandbox read credentials it replays Transaction Search for the period and diffs it. It prints a one-page verdict and runs in CI against a golden export.

**Layer 2: the auditor agent.**

- A distinct role: its own system prompt, read-only tools through the Kin MCP server and the same gateway, no access to the family agent's conversations. It runs at month close and on demand by the observer or organizer.
- Code runs the checks and the model orders and explains them: every movement has an approval and a receipt; no self-approval; every new payee was announced; caregiver hours against the visit schedule; amount drift per payee; mandate exceedances; reconciliation differences; pause events; claim checks and their outcomes.
- Its findings report (severity, evidence links, a recommendation) is attached to the statement. The organizer acknowledges each finding, and the acknowledgement is recorded.
- It computes the seven impact metrics from section 13 of the product description (decisions answered by the parent, days from visit to caregiver pay, demands checked and money not lost, the fairness gap, and the rest), so impact is measured from the record.

### PayPal and AI

- PayPal: Transaction Search through the Agent Toolkit's read tools as the reconciliation source; stored webhook signatures; captures and payouts referenced by PayPal ID.
- AI: the auditor narrates, prioritizes and explains, in a model context separate from the family agent's. The number guard applies to its report.

### The demo moment

`kin-verify october.zip` on Elena's audit export prints: chain intact across every entry, all approval signatures valid, settlement reproduced exactly, zero differences against PayPal. The auditor's one finding: "Amara billed four hours on a day with no scheduled visit. Approved by Elena. Receipt attached. Recommend confirming with Amara."

### What to build

- Hash and signature columns and the chain rule in `domain`; the export bundle builder in the worker; `packages/verify`.
- The auditor role in the agent package, MCP read tools, a findings schema and table, the acknowledge flow, the impact-metrics job.
- Tests: any mutation of an exported entry fails verification; the golden export verifies in CI.

### Built so far

- `packages/verify` and `kin-verify <export.json> [--head <hash>]`: recomputes a per-circle SHA-256 hash chain, re-checks every ledger rule (`auditLedger` in `domain`), recomputes the balances and each settlement from the entries, and checks every figure in the sentences Kin showed. Try `pnpm --filter @kin/verify run sample out.json`, then `... run kin-verify out.json`.
- The chain is computed from the ledger at export time, so no ledger table changed. Tamper evidence comes from the heads Kin keeps (`audit_heads`, decision 66): each visit to the verify screen and each download keeps the current head, and every export carries them, so a changed or removed past entry fails with no outside note. The heads sit in Kin's own database, where an administrator could rewrite both; saving a head elsewhere (`--head`) closes that gap. Not built: recording heads at the month's close, external anchoring, KMS-signed approvals, the PayPal Transaction Search diff, the findings table with acknowledgement, the impact metrics.
- `/dashboard/record/verify` shows the verdict and an auditor panel (separate prompt, no tools, `reviewFindings` in `packages/agent`). Plain code decides every finding and the model only words it; a sentence with a figure the code did not supply falls back to the fixed one.

### Guardrails and risks

- The export holds no medical data, as policy already requires.
- The auditor reads, and writes findings only. It cannot approve, pause or move money.
- Risk: Transaction Search lag. The verifier uses a window ending hours in the past, as nightly reconciliation does.

---

## 4. The rehearsable agreement: policy as code, a what-if simulator, a dry-run month

> **Status: the simulator is built** (decision 65). Built: `simulateScenario` in `packages/domain`, which rehearses a share change, a member stepping back, other approval amounts and a large bill by calling the real `settlePeriod` and `planApprovals` on a copy of the circle's state; and the read-only screen at `/dashboard/circle/agreement/simulate`. Not built: the compiled policy schema with stored versions, the agent tool `simulate_scenario`, voice phrasing, the dry-run settlement view, the diff view, the forecast job.

### What it is

The plain-language family agreement compiles into a versioned, executable policy that anyone can rehearse the future against. "What if the stairlift repair costs 900 dollars?" "What if Ana's share drops to 10 percent and her hours count at 20 dollars?" Kin runs the real approval engine and fairness calculator on a copy of today's state and answers exactly: who must approve, who pays what, what settlement follows, what Rose would be asked. A change to the agreement shows as a diff explained in words, takes effect only when every member accepts, and is read to the parent.

### Why it matters

- Fairness as a payout is Kin's first new primitive. The simulator lets a family check it (same inputs, same answer) before money moves, removing the surprises conflicts come from.
- It shows the money core is deterministic and the AI only drafts.
- Expense tools show balances; none rehearses a decision through the actual rules engine.
- The agent simulates before proposing, for example choosing Pay Later for the stairlift because a one-off top-up would exceed Ana's affordable share.

### How it works

1. **Compile.** The agreement conversation becomes a strict policy schema: shares in basis points, thresholds, approval rules, care rate and cap, mandate limits, calling hours, currencies. Structured output, then code validation (shares sum to 10,000, thresholds ordered). Every version is stored, and every settlement and approval records its version, as already designed.
2. **Simulate.** A pure function in `packages/domain` takes the policy, a snapshot and hypothetical events (a bill, a purchase, a share change, a member pausing, a mandate, a care-hour change, a month close). It returns the required approvals, the pool's balance path, each member's position, the proposed settlement, the prompts the parent would hear, and any rule that would refuse.
3. **Expose.** An agent tool `simulate_scenario` for every family role, so the parent can ask "what happens if I say no?" A "Try it" panel beside the agreement and any large proposal. On voice, Kin answers with the result's numbers, checked by the number guard.
4. **Dry-run month.** Before settlement approval, the family sees the exact invoices and payouts to be sent, with the input snapshot. Approving the settlement approves exactly that.
5. **Renegotiate.** A proposed change produces a diff, an explanation, and a simulation of next month under old and new versions. Members accept, Rose hears it, the version increments.
6. **Forecast.** The worker projects three months from subscriptions, auto-pay bills, mandates and history, warns when the pool would fall short, and proposes options through the simulator.

### PayPal and AI

- PayPal: the simulation returns the exact PayPal actions that would follow (invoices, payouts, a Pay Later session), so the family sees PayPal's part in advance. Pay Later eligibility is checked through the SDK where the sandbox allows.
- AI: compiles, explains diffs, words results, suggests options. Never computes.

### The demo moment

Elena: "What if the stairlift repair is 900 dollars?" Kin: "The pool holds 610. A one-off top-up would be 145 from Marcus, 87 from you and 58 from Ana. Rose must approve because it is above 50, and a second approval is needed because it is above 500. Or the family can spread it over six months with Pay Later." They choose.

### What to build

- Policy schema, compiler and validators. The simulate function, with property tests: simulating a real event sequence equals the real outcome, and a simulation never writes.
- The tool, the panel, voice phrasing, the dry-run view on settlement, the diff view on the agreement, the forecast job.

### Guardrails and risks

- Simulations are labelled and never create proposals on their own.
- Risk: UI scope creep. Start with three scenario types: a large bill, a share change, a month close.

---

## 5. Cross-border circles: a family in three currencies, one fair pool

> **Status: display only.** Built: `convertMoney` and a fixed rate table in `packages/domain/src/currency-conversion.ts` (integer rates, stamped, labelled simulated), and the Fairness page, which shows a member who gives in another currency (Marcus, in euros, in the demo) their agreed share in that currency, marked "simulated rate". Not built: conversion taken from PayPal's record, conversion-cost ledger lines, per-currency subscription plans, invoices and payouts, narration per currency. Sandbox multi-currency behavior is unverified (`architecture.md` section 23).

### What it is

Marcus lives abroad and pays his share in euros; the pool is in dollars; a caregiver may be paid in a third currency. Kin keeps each amount in its own currency, records the conversion PayPal actually applied, treats conversion cost like fees (a shared cost of the circle), computes fairness in the pool currency, and speaks to each person in their own currency and language.

### Why it matters

- Families across countries are Kin's stated wider audience and the roadmap's next step. The diaspora caring for a parent at home is one of the world's largest money flows: the World Bank put remittances to low- and middle-income countries at roughly $685 billion in 2024 (confirm before citing).
- Cross-border is PayPal's home ground. Doing it right means integer cents and conversion from PayPal's record, never from a model or a guessed rate.
- The primitive stays the same: fairness as a payout, across borders.

### How it works

1. **Conversion as a ledger fact.** Ledger lines already carry a currency. When a euro contribution settles into the dollar pool, the ledger records the gross in the member's currency, the converted amount in the pool currency, and a conversion-cost line, all from PayPal's transaction records, never an external rate.
2. **Fairness in pool currency.** Members are credited with the converted gross ("credited gross, fees shared"), and conversion cost is shared. The statement shows each member in the pool currency and their own.
3. **PayPal objects per currency.** A subscription plan per member in that member's currency, top-up invoices in the member's currency, payouts to a caregiver in theirs.
4. **Narration.** Rose hears dollars, Marcus reads euros, and the number guard checks amounts against the record in the currency spoken.
5. **Policy.** The agreement names the pool currency and each member's currency. Shares are percentages, so the fairness arithmetic does not change.

### PayPal and AI

- PayPal: a multi-currency business account, Subscriptions and Invoicing in the payer's currency, Payouts in the recipient's, Transaction Search for the conversion records.
- AI: wording in each person's language and currency, and explaining conversion lines: "Marcus's 180 euros arrived as 192 dollars and 71 cents. The conversion cost 4 dollars and 12 cents, shared by the family."

### The demo moment

Marcus's euro subscription payment lands and the ledger shows the conversion line. Rose hears "Marcus's share arrived." The statement shows Marcus in euros and everyone else in dollars; the settlement payout to Elena goes out in dollars.

### What to build

- Currency on the agreement and on members; conversion entries in `domain`; statement rendering per currency; a plan per currency; payout currency; a euro sandbox account for Marcus.
- Tests: rounding never creates or loses a cent in any currency; conversion lines balance.

### Guardrails and risks

- Day-one sandbox check: can a sandbox business account receive euros, hold a dollar balance and pay out in euros? If sandbox conversion behaves differently, label conversions simulated, as demo mode's honesty rule requires.
- Do not promise rate optimization. Kin records what PayPal did.

---

## 6. Two smaller additions worth carrying

- A production path for the pool account: PayPal Partner Referrals onboarding, so Kin acts on a family's account as a platform with granted permissions and never holds credentials. It answers the architecture's largest open question (section 22.2). Infrastructure rather than a visible feature; listed as next work.
- A live impact panel: the seven metrics from section 13 of the product description, computed from the record and shown in the family's view. About half a day.

---

## 7. Build order

As designed: 1 (mandates), 2 (office line), 3 (auditor and verifier), 4 (simulator), 5 (cross-border). 3 and 4 reuse domain code. About 17 days in total, on top of the essential spine in architecture section 22.3. If time runs short, cut 5 first, then the forecast part of 4.

---

## 8. Sources checked on 13 October 2026

- Google's AP2 announcement (16 September 2025) and protocol summaries: intent, cart and payment mandates as signed credentials; PayPal among the launch partners.
- PayPal developer docs: the Agent Ready overview, and the ACP integration page describing the delegated token's allowance fields (`merchant_id`, `max_amount`, `currency`, `expires_at`).
- PayPal tech blog, 16 September 2026: WebMCP support through the JavaScript SDK for Store Sync merchants. "The buyer remains in charge of approving the transaction."
- Not verified in this session: sandbox multi-currency behavior, the remittance figure in section 5, and PayPal's current Agent Ready enrollment rules. Agent Ready and Store Sync are gated programs, which is why spoken mandates (section 1) mirror the published contract instead of depending on enrollment.
