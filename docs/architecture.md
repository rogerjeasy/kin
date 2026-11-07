# Kin: architecture

Architecture of the complete Kin application for the PayPal AI Hackathon 2026. Draft 1, 13 October 2026.

Read `project-description.md` for what Kin is and `tech-stack.md` for the tools. This document explains how the system is built: its parts, its data, how money moves, how the AI is contained, and how it runs on AWS.

**Contents**

1. Summary
2. What drives the architecture
3. System context
4. Services and stores
5. Code structure
6. Domain model
7. The money core
8. PayPal integration
9. AI architecture
10. Voice architecture
11. Key flows
12. Identity and access
13. Interfaces
14. Infrastructure on AWS
15. Security
16. Reliability and failure handling
17. Observability and audit
18. Performance and scale
19. Testing
20. Environments, deployment and demo mode
21. Decision record
22. Risks, assumptions and open questions
23. How certain each part is

---

## 1. Summary

Kin is a TypeScript system of three services on AWS Fargate, one PostgreSQL database on Aurora Serverless v2, and a small set of managed AWS services. It talks to four outside systems: PayPal, Claude, a speech provider and a telephony provider.

The architecture rests on seven decisions.

1. **A deterministic money core.** A double-entry ledger, a fairness calculator and a set of state machines hold every fact about money. They are plain code with no AI inside.
2. **PayPal's record is the truth.** Kin treats a payment as done only when a verified PayPal webhook, or a direct read from PayPal, says so.
3. **The AI proposes and never executes.** The agent can read freely. Anything that moves money becomes a proposal, which a person approves and the money core executes.
4. **Every movement has an approval and an idempotency key.** Nothing is paid without a recorded yes, and nothing is paid twice.
5. **Each family is isolated.** Every row belongs to one circle. The service checks access on every request and the database enforces it again with row-level security.
6. **Voice is a first-class channel.** The same agent and the same rules serve a phone call, the in-app microphone and the screen.
7. **Money facts are never written by the model.** Amounts, names and dates in spoken or written output come from the ledger and are checked before delivery.

---

## 2. What drives the architecture

| Quality                            | What it means for Kin                                | How the architecture answers                                                                |
| ---------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Correctness of money**     | No lost, duplicated or invented payment              | Double-entry ledger, integer cents, idempotency keys, webhook truth, nightly reconciliation |
| **Trust**                    | A family lets software near a parent's money         | Human approval on every movement, limits, second approvals, a pause switch                  |
| **Auditability**             | A lawyer or court can follow every dollar            | Append-only ledger, stored PayPal events, approval evidence, exportable trail               |
| **Accessibility**            | A parent with low vision takes part fully            | Voice channel with the same capabilities as the screen                                      |
| **Responsiveness in speech** | A spoken reply must not feel slow                    | Streaming at every stage, a dedicated voice service, short context                          |
| **Isolation**                | One family never sees another                        | Circle scoping in the service and row-level security in the database                        |
| **Safety of AI**             | A letter or caller cannot talk the agent into paying | Untrusted content is data, tools are scoped, writes are proposals only                      |
| **Demo reliability**         | Judges can run it for five weeks                     | Always-on services, seeded data, reset script, simulated time                               |

---

## 3. System context

```mermaid
flowchart TB
    sib["Siblings<br/>laptop or phone browser"]
    par["Parent<br/>phone call or phone browser"]
    care["Caregiver<br/>phone browser"]
    pro["Professional or observer<br/>browser"]
    ext["Other AI agents<br/>through Kin MCP server"]

    kin["Kin"]

    pp["PayPal sandbox<br/>REST APIs, webhooks, MCP server"]
    claude["Claude API<br/>reasoning, vision, language"]
    speech["Speech provider<br/>speech to text, text to speech"]
    tel["Telephony provider<br/>phone calls"]
    merch["Participating merchant<br/>demo pharmacy in the hackathon"]
    mail["Amazon SES<br/>email"]

    sib --> kin
    par --> tel
    tel --> kin
    par --> kin
    care --> kin
    pro --> kin
    ext --> kin

    kin --> pp
    pp --> kin
    kin --> claude
    kin --> speech
    kin --> tel
    kin --> merch
    kin --> mail
```

**People**

- **Siblings** set up the circle, contribute, approve and review.
- **The parent** listens, asks, approves and photographs letters.
- **The caregiver** bills hours and receives pay.
- **Professionals and observers** read and export.

**Outside systems**

- **PayPal** moves every dollar and reports every event.
- **Claude** reads documents, runs the agent and writes language.
- **The speech provider** turns audio into text and text into audio.
- **The telephony provider** connects phone calls.
- **A participating merchant** sells what the parent needs. In the hackathon this is a demo pharmacy that ships in the repository.

---

## 4. Services and stores

```mermaid
flowchart TB
    alb["Application Load Balancer"]

    subgraph compute["ECS Fargate"]
        web["web<br/>Next.js UI, HTTP API,<br/>webhook intake, Kin MCP server"]
        voice["voice<br/>live audio sessions"]
        worker["worker<br/>events, executions, documents,<br/>schedules, notifications"]
    end

    subgraph data["Data and messaging"]
        db[("Aurora Serverless v2<br/>PostgreSQL")]
        s3[("S3<br/>documents and exports")]
        sqs["SQS queues"]
        sched["EventBridge Scheduler"]
    end

    cog["Cognito"]
    sec["Secrets Manager"]

    alb --> web
    alb --> voice
    web --> db
    web --> s3
    web --> sqs
    web --> cog
    voice --> db
    voice --> sqs
    worker --> db
    worker --> s3
    sqs --> worker
    sched --> sqs
    web --> sec
    voice --> sec
    worker --> sec
```

| Part                            | Responsibility                                                                                                                               | Never does                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **web**                   | Serves the app. Exposes the HTTP API. Receives PayPal and telephony webhooks. Hosts the Kin MCP server. Runs typed agent conversations. Captures a top-up the payer has just approved, as PayPal requires while the payer waits. | Send money out of the pool in a request, or write the ledger |
| **voice**                 | Holds live audio connections. Streams speech in and out. Runs spoken agent turns. Records voice approvals.                                   | Execute payments                       |
| **worker**                | Verifies and applies PayPal events. Executes approved proposals. Reads photographed documents. Runs settlement, schedules and notifications. | Serve user requests                    |
| **Aurora**                | Ledger, circles, bills, approvals, PayPal events, audit log                                                                                  |                                        |
| **S3**                    | Photographs, statements, audit exports                                                                                                       |                                        |
| **SQS**                   | Hands work from web and voice to worker, with retries                                                                                        |                                        |
| **EventBridge Scheduler** | Starts timed work                                                                                                                            |                                        |
| **Cognito**               | Signs people in and issues tokens                                                                                                            |                                        |
| **Secrets Manager**       | Holds every credential                                                                                                                       |                                        |

**Why three services and not one.** Live audio needs connections that stay open for minutes and must not be disturbed by a web deployment. Payment execution must continue when the web tier is busy and must be retried independently. Separating them keeps each simple.

**Why not more.** The three services share one codebase and one database. Splitting further would add network calls and failure modes without solving a problem Kin has.

---

## 5. Code structure

One repository with shared packages.

```
kin/
  apps/
    web/              Next.js app, HTTP API, webhook intake, Kin MCP server
    voice/            live audio service
    worker/           queue consumers and scheduled jobs
    demo-merchant/    stand-in pharmacy for the hackathon
  packages/
    domain/           ledger, fairness, state machines, policies. Pure code.
    db/               schema, migrations, repositories, row-level security
    paypal/           PayPal adapter, webhook verification, event mapping
    agent/            agent loop, tool gateway, prompts, number guard
    documents/        photo intake and extraction
    speech/           speech-to-text and text-to-speech adapters
    telephony/        call control adapter
    auth/             token verification, circle authorization
    notify/           email, push and narration queue
    config/           typed configuration and secrets loading
  infra/              AWS CDK stacks
  docs/
```

**The dependency rule.** `domain` depends on nothing. It has no database, no network and no AI. Every other package may depend on `domain`. Apps depend on packages and never on each other.

This rule is what makes the money logic testable in isolation and what makes the claim "the AI does not do the arithmetic" true in the code and not just in the pitch.

**Ports and adapters.** PayPal, Claude, speech, telephony and the merchant are each reached through an interface defined beside the code that needs it. The real adapters live in their own packages. Tests use fakes. Replacing a provider means writing one adapter.

---

## 6. Domain model

### 6.1 Concepts

| Concept                | Meaning                                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| **Circle**       | One person cared for and the people who share responsibility for them                  |
| **Member**       | A person's role within one circle                                                      |
| **Agreement**    | The versioned rules of a circle: shares, thresholds, care-hour rate, the parent's role |
| **Pool account** | The PayPal account that holds the circle's shared money                                |
| **Contribution** | Money a member puts in, by subscription, top-up or out-of-pocket spending              |
| **Care entry**   | Hours of hands-on care logged by a member                                              |
| **Bill**         | Something to be paid: a utility, a caregiver's hours, a repair                         |
| **Payee**        | A biller, caregiver or merchant, with an approval status                               |
| **Proposal**     | A requested movement of money, awaiting approval                                       |
| **Approval**     | One person's recorded yes or no, with evidence                                         |
| **Execution**    | The attempt to carry out an approved proposal through PayPal                           |
| **Ledger entry** | A balanced, permanent record of a financial fact                                       |
| **Settlement**   | The month-end calculation and the movements that restore the agreed shares             |
| **Document**     | A photographed or forwarded letter, bill or receipt                                    |
| **Claim check**  | A payment demand the parent asked Kin to verify                                        |
| **Narration**    | A money event prepared for the parent to hear                                          |

### 6.2 Entity relationships

```mermaid
erDiagram
    USER ||--o{ MEMBER : "is"
    CIRCLE ||--o{ MEMBER : "has"
    CIRCLE ||--o{ AGREEMENT : "versions"
    CIRCLE ||--|| POOL_ACCOUNT : "owns"
    CIRCLE ||--o{ PAYEE : "knows"
    CIRCLE ||--o{ BILL : "receives"
    CIRCLE ||--o{ PROPOSAL : "raises"
    CIRCLE ||--o{ LEDGER_ENTRY : "records"
    CIRCLE ||--o{ SETTLEMENT : "closes"
    CIRCLE ||--o{ DOCUMENT : "stores"
    MEMBER ||--o{ CONTRIBUTION : "makes"
    MEMBER ||--o{ CARE_ENTRY : "logs"
    MEMBER ||--o{ APPROVAL : "gives"
    PAYEE ||--o{ BILL : "issues"
    DOCUMENT ||--o| BILL : "becomes"
    BILL ||--o| PROPOSAL : "leads to"
    PROPOSAL ||--o{ APPROVAL : "needs"
    PROPOSAL ||--o{ EXECUTION : "attempts"
    EXECUTION ||--o{ PAYPAL_EVENT : "confirmed by"
    LEDGER_ENTRY ||--|{ LEDGER_LINE : "contains"
    PAYPAL_EVENT ||--o{ LEDGER_ENTRY : "causes"
    SETTLEMENT ||--o{ PROPOSAL : "generates"
```

### 6.3 Tables

Every table except `users` carries a `circle_id`. Built in `packages/db/src/schema` (decision 37), with these choices:

- Every row has a UUID that Kin makes, and every reference to a row of the same circle is a composite foreign key on `(circle_id, id)`, so the database refuses a link from one family's row to another's.
- Amounts are `bigint` cents beside a three-letter currency. Each enum is built from the money core's constant (`CIRCLE_ROLES`, `PROPOSAL_KINDS`, `ENTRY_KINDS`, the state machines' states), so the database cannot hold a value the code does not know.
- Tables marked *not yet* below are designed but not created. Each comes with the feature that writes it.
- The rows the dashboard showed only as copy or constants are now data: the circle's name, demo flag and demo clock; members' display names, relationships and portraits; payees' names; the bills the family expects; the false-demand check; and what Kin told the parent.

| Table               | Key contents                                                                        |
| ------------------- | ----------------------------------------------------------------------------------- |
| `users`           | Cognito subject as the ID (or `demo:…` for an anonymous demo visitor, with kind `demo_visitor`), email and whether Cognito verified it, name, language, linked PayPal payer ID, last seen. The only table without a circle. |
| `circles`         | Name, timezone, currency, status (active or archived), demo flag, demo clock, pause until and by whom, the transaction that created it |
| `members`         | User (empty until the person joins), display name, role, parent participation level (for the parent only), relationship, portrait, status, the visitor's demo seat |
| `invitations`     | Email, role, who invited, status, expiry                                            |
| `agreements`      | Version, care rate and whether care is paid in cash, the three thresholds, effective date. Never changed: a new term is a new version. |
| `agreement_shares` | Each member's share of a version in basis points, in the family's order. A version's shares total 10 000, checked at commit. |
| `agreement_acceptances` | Who accepted a version, how (app or voice) and when. A version governs from its start date once every member it asks has accepted it: every organizer and contributor, and a parent who decides and can sign in, fixed in `agreements.requires` when it is proposed. The newest such version is in force (decision 57). |
| `pool_accounts`   | *Not yet.* PayPal merchant ID, credential reference, webhook ID, mode               |
| `payees`          | Name, spending category, status, the member it pays, PayPal recipient, auto-pay rule and range; a nullable caregiver hourly rate, distinct from the family care-credit rate. At most one rate-configured payee per caregiver and circle. |
| `monthly_shares`  | Member, amount in cents and currency, state (`approval_pending`, `active`, `paused`, `cancelled`), PayPal subscription ID and the page where the member approves it (none for a simulated share), simulated, failed charges as PayPal last reported, next billing time. One live share per member. Changed only through the member's own operations and the worker. |
| `contributions`   | *Not yet.* Member, kind, amount, period, source reference                            |
| `care_entries`    | Member, date, minutes, note, approved, the care-credit entry that values it         |
| `documents`       | S3 key (none for a simulated document), kind, uploader, extraction result, confidence, simulated |
| `bills`           | Payee, document, amount, received and due dates, state, duplicate link; caregiver bills additionally hold immutable versioned service-day details, the original rate and currency, and a submission key unique within the circle. |
| `expected_bills`  | Payee, kind, expected amount, due date: what the family expects before the bill arrives |
| `proposals`       | Kind, amount, payee or member paid, purpose and the family's note, who raised it (none for Kin), state, expiry, agreement version, the approval plan made when it was raised, bill, settlement and document links. Only the state and expiry can change. |
| `approvals`       | Proposal, member, role when answering, decision, method, evidence reference, time. Never changed. |
| `executions`      | Proposal, idempotency key, PayPal resource IDs, state, attempts                     |
| `paypal_events`   | PayPal event ID, type, raw body, headers, verification state, processing state      |
| `ledger_entries`  | Date, kind, description, source type and ID (unique per circle: the idempotency key), period, currency, simulated, reversal link, order of acceptance |
| `ledger_lines`    | Entry, position, account, direction, amount in cents                                |
| `ledger_accounts` | Account code, member or payee link                                                  |
| `settlements`     | Period, agreement version, inputs, fairness result and plan as calculated, state    |
| `claim_checks`    | What was claimed and for whom, the amount, the entry it was checked against, verdict, members alerted |
| `narrations`      | Member told, topic, amount and the entry it came from, the words spoken after the number guard, delivery state |
| `conversations`   | *Not yet.* Channel, participant, turns, tool calls                                  |
| `call_sessions`   | *Not yet.* Call reference, verification result, transcript reference                |
| `outbox`          | Pending messages written in the same transaction as state changes                   |
| `audit_log`       | Who did what (member, service or provisioner), to what, when, from where. Never changed. |

---

## 7. The money core

This is the part of Kin that must never be wrong. It lives in `packages/domain` and is plain, deterministic code.

### 7.1 The ledger

Kin keeps a double-entry ledger for each circle.

- **Every entry balances.** The debits equal the credits, or the entry is rejected.
- **Entries are permanent.** There is no update and no delete. A mistake is corrected by a new reversing entry that points to the original.
- **Amounts are integer cents** with a currency code. There is no floating-point arithmetic.
- **Every entry names its cause:** a PayPal event, an approval or a settlement.

**Accounts per circle**

| Account                | Type      | Holds                                                                  |
| ---------------------- | --------- | ---------------------------------------------------------------------- |
| `pool_cash`          | Asset     | Mirrors the pool's PayPal balance                                      |
| `pool_clearing`      | Asset     | Money in motion, awaiting PayPal confirmation                          |
| `member:{id}`        | Equity    | What each member has contributed                                       |
| `expense:{category}` | Expense   | Care costs by category                                                 |
| `payable:{payee}`    | Liability | Approved bills not yet paid                                            |
| `fees`               | Expense   | PayPal fees                                                            |
| `care_credit:{id}`   | Memo      | Valued care hours. Tracked beside the cash ledger, never mixed into it |
| `care_received`      | Memo      | The other side of every care credit, so memo entries balance too       |

**Example entries**

| Event                                              | Debit                               | Credit                   |
| -------------------------------------------------- | ----------------------------------- | ------------------------ |
| Marcus's monthly share of 200.00 arrives, fee 7.28 | `pool_cash` 192.72, `fees` 7.28 | `member:marcus` 200.00 |
| Elena's 42.00 pharmacy receipt is approved         | `expense:pharmacy` 42.00          | `member:elena` 42.00   |
| Amara's 240.00 bill is approved                    | `expense:care` 240.00             | `payable:amara` 240.00 |
| The payout to Amara is confirmed, fee 0.25         | `payable:amara` 240.00, `fees` 0.25 | `pool_cash` 240.25   |
| The refill of 42.00 is captured                    | `expense:pharmacy` 42.00          | `pool_cash` 42.00      |
| Settlement pays Elena 126.00, fee 0.25             | `member:elena` 126.00, `fees` 0.25 | `pool_cash` 126.25    |

A member is credited with the gross amount they paid, and a payee or member is paid the full amount owed. PayPal's fees, on money coming in and on payouts going out, are a shared cost of the circle, read from PayPal's record of each transaction.

**How the code holds these rules** (`packages/domain`, `ledger*.ts` and `postings.ts`)

- An entry touches cash accounts or memo accounts, never both. Approved care is posted as debit `care_received`, credit `care_credit:{id}`, valued once at approval to the nearest cent, halves up.
- The entry's source (a PayPal event, an approval or a settlement, with its ID) is its idempotency key. Applying an entry whose source is recorded changes nothing. A different entry claiming a recorded source is refused.
- A reversal mirrors its original line for line, keeps the original's kind and names it. An entry is reversed at most once, and a reversal is never itself reversed.
- `postings.ts` holds one builder per row of the table above, plus settlement collections and care credit. Callers state what happened. Which accounts move is decided there.

### 7.2 The fairness calculation

At any moment, and formally at month end, Kin answers one question for each member: are you ahead of your agreed share or behind it?

**Inputs for a period**

- `s_i`: the member's share, in basis points. All shares total 10,000.
- `P_i`: cash the member paid into the pool, net of refunds.
- `O_i`: approved out-of-pocket spending by the member.
- `C_i`: care credit, which is approved hours multiplied by the agreed rate. Zero if the family has not enabled it.
- `B_i`: the balance carried in from the previous period.

**Calculation**

1. Total contribution: `K = sum of (P_i + O_i + C_i)`.
2. Target for each member: `T_i = s_i × K ÷ 10,000`, rounded by the largest-remainder method so the targets total exactly `K`.
3. Cash due from each member: `D_i = max(0, T_i − C_i)`. Care hours reduce what a member owes in cash.
4. Cash position: `X_i = P_i + O_i − D_i + B_i`.
5. If `X_i` is positive, the pool owes the member. If negative, the member owes the pool.

**Rules**

- **Care credit lowers what a member owes. It is not paid out in cash** unless the family switches that on in the agreement. When it is on, step 3 is skipped and `X_i = P_i + O_i + C_i − T_i + B_i`.
- **Rounding never creates or loses a cent.** The largest-remainder method assigns leftover cents in a fixed, documented order: largest remainder first, and between equal remainders, the member whose ID sorts first. The result does not depend on the order members are listed in.
- **The calculation is a pure function.** The same inputs always give the same result, and the inputs are stored with each settlement so the result can be reproduced years later.
- **Inputs come from the ledger.** `P_i`, `O_i` and `C_i` are the period's net credits to the member's accounts from contribution, out-of-pocket and care-credit entries. A refund is a reversal, so it nets out. Settlement collections and payouts are left out, because they close an earlier period and reach the next one through `B_i`. A member who gave something but holds no share stops the calculation.
- **Care credit beyond the target earns nothing by default.** When `C_i > T_i`, the excess still counts in `K`, so the others' targets include it, but the carer is not paid for it. The pool keeps that cash. Each position reports it as unused care credit, so positions total `ΣB_i` minus the unused credit.

### 7.3 Settlement

Settlement turns the calculation into movements. Money moves through the pool, so a settlement holds exactly one movement for each member who is not level, which is the smallest set that closes every gap.

1. **Snapshot.** At period close, Kin freezes the inputs.
2. **Calculate.** The fairness function produces each member's position.
3. **Propose.** Members who owe receive a top-up request. Members who are owed become payout proposals.
4. **Approve.** The circle approves the settlement as a whole, under the agreement's rules.
5. **Collect, then pay.** Payouts are released only as far as the pool's confirmed balance allows, less every approved bill not yet paid and PayPal's fee for sending each payout. Kin never pays out money that has not arrived, nor money already promised to a caregiver or a biller, nor money the fees will take. When the balance cannot cover every payout, it is shared among them in proportion to what each member is owed, by the same largest-remainder method, and the rest waits for collections.
6. **Close.** When every movement is confirmed or carried forward, the period is closed and the statement is produced. Unpaid amounts carry into the next period as `B_i`.

### 7.4 State machines

Each money-related record moves through explicit states. A transition that is not listed cannot happen.

**Proposal**

```mermaid
stateDiagram-v2
    [*] --> proposed
    proposed --> pending_approval
    pending_approval --> approved
    pending_approval --> rejected
    pending_approval --> expired
    pending_approval --> cancelled
    approved --> executing
    executing --> settled
    executing --> failed
    failed --> executing
    failed --> cancelled
    settled --> [*]
    rejected --> [*]
    expired --> [*]
    cancelled --> [*]
```

**Bill**

```mermaid
stateDiagram-v2
    [*] --> received
    received --> extracted
    received --> ready
    received --> rejected
    extracted --> needs_review
    extracted --> ready
    needs_review --> ready
    needs_review --> rejected
    extracted --> duplicate
    ready --> proposed
    proposed --> paid
    proposed --> ready
    paid --> [*]
    rejected --> [*]
    duplicate --> [*]
```

**Execution**

```mermaid
stateDiagram-v2
    [*] --> created
    created --> submitted
    submitted --> confirmed
    submitted --> pending_at_paypal
    pending_at_paypal --> confirmed
    pending_at_paypal --> failed
    submitted --> failed
    submitted --> unknown
    unknown --> confirmed
    unknown --> failed
    confirmed --> [*]
    failed --> [*]
```

**Monthly share** (`MONTHLY_SHARE_TRANSITIONS` in `packages/domain`, enforced by a trigger on `monthly_shares`)

```mermaid
stateDiagram-v2
    [*] --> approval_pending
    approval_pending --> active
    approval_pending --> cancelled
    active --> paused
    paused --> active
    active --> cancelled
    paused --> cancelled
    cancelled --> [*]
```

The `unknown` state matters. If a call to PayPal times out, Kin does not assume success or failure. It asks PayPal for the resource by its idempotency key and waits for the webhook.

**Delivery** (the goods of a purchase, beside its execution; `packages/domain` `DELIVERY_TRANSITIONS`)

```mermaid
stateDiagram-v2
    [*] --> awaiting
    awaiting --> ordered
    ordered --> shipped
    shipped --> out_for_delivery
    out_for_delivery --> delivered
    delivered --> [*]
```

A purchase is `awaiting` from the moment it is proposed until the seller has the order. Only Kin's worker moves it on, from the seller's own report, one step at a time.

### 7.5 The approval engine

Before any proposal can execute, the approval engine decides who must say yes.

**Inputs:** the kind of movement, the amount, whether the payee is known and approved, who raised the proposal, the current agreement and the parent's participation level.

**Output:** the set of approvals required and an expiry time.

**Rules, in order**

1. **Pause.** If the circle is paused, nothing is approved.
2. **Hard limits.** An amount above the agreement's ceiling is refused, whoever asks.
3. **Auto-pay.** A recurring bill from an approved payee, within its expected range, needs no new approval. The standing rule is recorded as the approver.
4. **The parent's decisions.** If the parent's level is "decides" and the amount is above their threshold, the parent's approval is required.
5. **Organizer approval** for everything else.
6. **Second approval** above the agreement's large-payment threshold.
7. **No self-approval.** A member cannot be the only approver of a payment to themselves.
8. **New payees** always need a person, and the whole circle is told.

The agreement holds three amounts for these rules: the ceiling (rule 2), the large-payment threshold (rule 6) and the parent's threshold (rule 4). An amount equal to a threshold does not cross it. A proposal waits 72 hours for its approvals and then expires.

**Counting the answers.** Each approval the plan asks for is a place that needs a yes from a different member: the parent's place takes the parent, the organizer's place an organizer, and the second approval an organizer or a contributor. A no from any member whose yes could fill a place rejects the proposal, even after a yes. When the payee is a member, they may say yes, but another organizer or contributor must say yes too, and that member's no also counts. Caregivers and observers never approve or reject. While the circle is paused, no proposal becomes approved, and answers already given count again once the pause lifts. A member holds one role per circle, so answers that give one member two roles are refused.

`planApprovals` and `decideApprovals` in `packages/domain` implement this section, and the state machines of section 7.4 live in `state-machines.ts` beside them. A test pins every move the diagrams above draw, so a transition is added to the diagram, that test and the code together.

**Evidence.** Each approval records how it was given:

| Method         | Evidence stored                                                                 |
| -------------- | ------------------------------------------------------------------------------- |
| Tap in the app | Cognito session, device, time, and a fresh multi-factor check for payouts       |
| Voice          | Call reference, verification result, the sentence read back, the parent's reply |
| Standing rule  | The rule's ID and the agreement version                                         |

### 7.6 Execution, the outbox and idempotency

Moving money involves a database and an outside API, which cannot share a transaction. Kin handles this with the outbox pattern.

1. In one database transaction, Kin marks the proposal approved, creates an execution with a fresh idempotency key, and writes an outbox row. Built: the trigger `queue_payout` does both for a caregiver payout, in the transaction of the answer that approves it (migration `0008_payouts`). The key is `kin-payout-{proposal}`.
2. The worker leases the outbox row from PostgreSQL (`kin_private.claim_outbox`, callable by `kin_service` alone, `FOR UPDATE SKIP LOCKED`, hidden for 120 seconds) instead of passing it through an executions queue (decision 53).
3. The worker checks the pool can pay the bill and PayPal's fee from money that has arrived (`canPayOut`), writes the family's approval to the ledger once, moves the proposal to executing, and calls PayPal, passing the idempotency key.
4. The worker records PayPal's reply and marks the execution submitted. No reply means unknown: the same key is sent again later, and PayPal answers with the batch it already made (decision 55).
5. The execution is confirmed only when PayPal's record says the item succeeded: today by reading the batch back (`GET /v1/payments/payouts/{batch}`); the payout-item webhook is not yet handled.

**Idempotency at each layer**

- **To PayPal:** the `PayPal-Request-Id` header carries the execution's key. For payouts, the `sender_batch_id` does. A retry cannot pay twice.
- **From PayPal:** each event's ID is unique in `paypal_events`. A redelivered event is ignored.
- **In the ledger:** each entry has a unique source reference. Applying the same event twice cannot write two entries.
- **In the queues:** per-circle ordering means two workers never act on the same circle at once. The payout outbox is leased row by row instead, and each database step locks the execution, so two workers never move one payout at once.

---

## 8. PayPal integration

### 8.1 The pool account

Each circle has one PayPal account that holds its shared money. Kin does not hold funds.

**In the hackathon,** every circle's pool is the one sandbox business account (decision 46). Each order Kin creates names its circle and member in `custom_id` (`kin1:<circle>:<member>`), PayPal copies it onto the capture, and Kin trusts it only after reading the capture back from PayPal, so PayPal's own record still says whose money each payment is. The app's client secret is in Secrets Manager (`kin/paypal/client-secret`); its client ID and webhook ID, which are not secret, are in `infra/cdk.json` under `kin:paypal`.

**In production,** Kin would act on a family's account through PayPal's partner model, with the family's consent and without holding their credentials. The code reaches the pool through one function, `poolFor` in `packages/paypal`, so that change is confined to it. This is the largest open question in the architecture and is listed in section 22.

### 8.2 Which PayPal capability does what

| Kin need                              | PayPal capability                                             | Direction         | Confirmed by                                           |
| ------------------------------------- | ------------------------------------------------------------- | ----------------- | ------------------------------------------------------ |
| Monthly share                         | Subscriptions, with a Catalog product and one plan per amount | Sibling to pool   | `PAYMENT.SALE.COMPLETED`, `BILLING.SUBSCRIPTION.*` |
| One-off top-up in the app             | Orders v2 with JavaScript SDK v6, PayPal or Pay Later         | Sibling to pool   | `PAYMENT.CAPTURE.COMPLETED`                          |
| Top-up or settlement request by email | Invoicing v2, with reminders and QR code                      | Sibling to pool   | `INVOICING.INVOICE.PAID`                             |
| Caregiver pay                         | Payouts                                                       | Pool to caregiver | `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`                     |
| Settlement payout                     | Payouts                                                       | Pool to sibling   | `PAYMENT.PAYOUTS-ITEM.SUCCEEDED`                     |
| Purchases for the parent              | Vault payment token and Orders v2 at a participating merchant | Pool to merchant  | Merchant order status, then reconciliation             |
| Refund of a contribution              | Refunds                                                       | Pool to sibling   | `PAYMENT.CAPTURE.REFUNDED`                           |
| Delivery tracking                     | Shipment tracking on the merchant's order                     | Read              | Tracking status                                        |
| Disputed contribution                 | Disputes                                                      | Read and respond  | `CUSTOMER.DISPUTE.*`                                 |
| The record of truth                   | Webhooks and Transaction Search                               | Read              |                                                        |
| Identity of a payer                   | Log in with PayPal                                            | Read              |                                                        |
| Agent access to PayPal data           | Agent Toolkit and sandbox MCP server                          | Read              |                                                        |

### 8.3 Three corrections to the earlier documents

Checking the APIs changed three things. The PayPal tables in `project-description.md` and `tech-stack.md` have been updated to match.

1. **Caregivers are paid by payout, not by a PayPal invoice.** PayPal has no API for an account to pay an invoice it has received. The payer must sign in and pay by hand. So the caregiver's bill is a Kin record, and the payment is a PayPal payout from the pool. This is simpler and is paid the same day.
2. **Invoicing is used for requests to siblings.** When Kin asks a sibling for a top-up or a settlement amount, it sends a PayPal invoice from the pool. The sibling pays from the email or the QR code, and Kin can send reminders.
3. **Agent purchases need a saved payment method at the merchant.** A payer cannot be charged without either approving in PayPal or having saved their wallet with that merchant. Kin uses the second: the pool's wallet is saved once with a participating merchant, and later purchases are created by the merchant after Kin's approval. Saving a wallet this way works in the sandbox. In production PayPal must approve the merchant for it.

### 8.4 Contributions

**Subscriptions**

1. When a circle is created, Kin creates a Catalog product for it in the pool account.
2. For each sibling's share, Kin creates a plan for that amount and a subscription.
3. The sibling approves the subscription in PayPal. Kin uses the approval link PayPal returns, which works without depending on any SDK feature.
4. Each billing cycle, PayPal charges the sibling and sends `PAYMENT.SALE.COMPLETED`.
5. Kin credits the member in the ledger.
6. A failed charge arrives as `BILLING.SUBSCRIPTION.PAYMENT.FAILED`. Kin tells the circle and the fairness ledger shows the gap.

**Monthly shares in the app** (built; "Monthly shares" on the circle screen, for organizers and contributors)

1. The member enters a monthly amount (the same limits as a top-up, `checkMonthlyShare`). `POST /api/monthly-shares` makes the circle's Catalog product, a plan for the amount and a subscription in the pool account, every request keyed by the share's own row ID so a repeat makes nothing new. The subscription's `custom_id` names the circle and member, like a top-up order's.
2. Kin records the share (`start_my_share`) as `approval_pending`, with PayPal's approval page, and sends the member there. Only the member it belongs to is given that page. Nothing is charged until they approve.
3. Back from PayPal, the screen asks the worker to read the subscription (`subscription_checked` on the inbox queue). The worker reads it and every completed charge since the share began from PayPal, moves the share to `active` and credits each charge once by its PayPal transaction ID, as a top-up is credited: the member the gross, the pool the net, PayPal's fee to `fees`. `PAYMENT.SALE.COMPLETED` and `BILLING.SUBSCRIPTION.*` webhooks say the same later; a sale names only its subscription, so after the signature checks out the worker asks PayPal whose subscription it is.
4. Pausing, resuming and ending ask PayPal first (suspend, activate, cancel) and change Kin's record only once PayPal has agreed. A share only moves along `MONTHLY_SHARE_TRANSITIONS`, and a cancelled one stays cancelled (a trigger enforces it, whoever writes). A member who wants a different amount ends the share and starts a new one.
5. A failed charge shows on the share as PayPal's count of failures. Telling the circle about it is not built.
6. **Demo circles** make no PayPal subscription. Their share is `simulated`, runs at once, and the worker credits its month once for each calendar month of the circle's own clock, labelled simulated, with no fee. It never writes a simulated month into a share that is not simulated, or into a circle that is not a demo.

**Top-ups in the app** (built; "Add money" on the overview, for organizers and contributors)

1. The member chooses an amount between $1.00 and $5,000.00 (`checkTopUp` in `packages/domain`). The browser checks it for quick feedback; the server reads it again from the typed text, digit by digit, into integer cents (`centsFromDecimal`).
2. The server (`POST /api/top-ups`) creates an Orders v2 order in the pool account: one unit, no shipping, `custom_id` naming the circle and the member.
3. The browser runs a one-time payment session with JavaScript SDK v6, loaded from PayPal's sandbox. Where PayPal says the payer is eligible, a Pay Later button is offered beside PayPal's.
4. On approval the server (`POST /api/top-ups/{order}/capture`) reads the order back, refuses it unless it is this member's in this circle, and captures it with the request ID `kin-capture-{order}`, so a repeated click cannot capture twice. It then puts `order_captured` on the PayPal inbox queue.
5. The worker reads the order back from PayPal and records each completed capture (`recordContribution` in `packages/db`): the member is credited the gross, the pool receives the net, and PayPal's fee goes to `fees`. The capture's ID is the entry's source, so the webhook `PAYMENT.CAPTURE.COMPLETED` for the same capture finds the entry there and writes nothing (decision 47).
6. The sheet asks `GET /api/top-ups/captures/{capture}` until the entry exists, then says the amount is in the pool. If PayPal could not be reached during the capture, whether it happened is unknown: the worker is asked to look anyway, and the sheet says the record will show it once PayPal confirms.

**Requests by invoice**

1. Kin creates and sends an invoice from the pool to the sibling's email.
2. The sibling pays from the email or the QR code.
3. `INVOICING.INVOICE.PAID` confirms it.
4. If it stays unpaid, Kin sends a reminder on the schedule in the agreement.

### 8.5 Payouts

Used for caregiver pay and for settlement payouts to siblings.

1. The approved proposal becomes a payout batch with one item.
2. The recipient is identified by PayPal email, phone or payer ID.
3. The batch ID is the execution's idempotency key.
4. PayPal reports the result per item. Kin acts on each outcome:

| Item outcome                           | Kin's action                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| Succeeded                              | Confirm the execution, write the payout and PayPal's fee to the ledger, settle the proposal and mark the bill paid. *Telling the recipient and the circle is not built.* |
| Pending, unclaimed or held             | Wait, and read the batch again later. The family's approval already holds the money back as owed to the payee (decision 54). *Telling anyone is not built.* |
| Returned, failed, blocked, refunded or reversed; or PayPal refuses the request | Mark the execution and proposal failed. The payee is still owed. *Alerting the organizer is not built.* |

**Built for caregiver payouts** (`packages/paypal` `payout.ts`, `packages/db` `payouts.ts`, `apps/worker/src/payouts`). The caregiver records their own PayPal email on their Bills screen (`set_own_receiver`); nobody else can (decision 56). Once recorded, it cannot change while a payment to them waits for approval, is approved, is being paid or has failed, and each execution keeps the address it was approved with. Screens show it masked, and each caregiver payout's card shows the family where the money will go before they say yes. A demo circle's payout is simulated: no PayPal call, and both ledger entries say so. A payout waits, recorded once as held, while the circle is paused (section 15.3: a payout already at PayPal is still tracked), while the payee has no address, or while the pool cannot pay it and the fee.

### 8.6 Purchases for the parent

1. **Linking, once.** The pool account holder saves the pool's PayPal wallet with the merchant. PayPal returns a setup token, the holder approves in PayPal, and the merchant receives a payment token.
2. **Finding.** The agent searches the merchant's catalog and builds a cart.
3. **Proposing.** The cart becomes a proposal with the exact items and total.
4. **Approving.** The parent or the family approves under the agreement's rules.
5. **Buying.** Kin sends the merchant a signed instruction that names the cart, the total and the approval. The merchant creates and captures a PayPal order with the saved payment token.
6. **Confirming.** Kin reads the order's status from the merchant and writes the ledger entry. The nightly reconciliation checks it against the pool's own transaction history.
7. **Tracking.** The merchant adds tracking to the order and Kin follows it.

**The amount is bound to the approval.** The signed instruction carries the approved total. The merchant must charge exactly that. A different amount is refused.

**The fallback.** If a merchant cannot save the pool's wallet, the purchase is paid from a member's own PayPal wallet with their approval in PayPal. Kin records it as that member's out-of-pocket contribution, and settlement reimburses them. The fairness model absorbs this case without any special handling.

**The demo merchant.** `apps/demo-merchant` is a small pharmacy with its own sandbox business account. It exists so the hackathon can show a complete purchase. It is labelled as a stand-in everywhere it appears.

### 8.7 The webhook pipeline

```mermaid
sequenceDiagram
    participant PP as PayPal
    participant WEB as web
    participant Q as SQS (FIFO)
    participant WK as worker
    participant DB as Aurora

    PP->>WEB: POST event with transmission headers
    WEB->>Q: the raw body and headers, grouped by circle
    WEB-->>PP: 200 OK once SQS holds it
    Q->>WK: deliver the delivery
    WK->>PP: verify the signature
    WK->>DB: store raw body and headers, unique on event ID
    WK->>PP: GET the resource the event names
    PP-->>WK: current state of the resource
    WK->>DB: one transaction. write ledger entry, mark the event processed
```

As built (decision 44), the web app does not write to Aurora: it holds no service role (decision 38). It hands the delivery, byte for byte, to the `kin-paypal-events.fifo` queue (`POST /api/paypal/webhook`), and the worker verifies it with PayPal and then stores it in `paypal_events`. Nothing from a body PayPal has not vouched for is written anywhere, so a forged delivery cannot file an event ID that would make the genuine event look like a repeat. SQS holds the delivery durably before PayPal hears 200, so nothing is lost between the two. The worker is `apps/worker` (`handleInboxMessage`); publishing domain events for notifications and narration comes with those features.

**Rules**

- **Store first.** The raw body is kept before anything else, so no event is lost and the signature can be checked against the exact bytes received: on the queue before PayPal hears 200, then in `paypal_events` once verified. Verification sends PayPal the event exactly as received, never parsed and re-encoded. An event ID already stored under another circle is not stored again, so a genuine event replayed with a different circle in its body changes nothing.
- **Answer quickly.** PayPal retries a delivery that does not return success, up to 25 times over three days. Kin returns success once the event is safely stored.
- **Verify before applying, and before storing.** An event that fails verification is never applied or stored; the worker logs its event ID and PayPal's transmission ID for inspection.
- **Read the resource back.** Kin does not trust the event body for amounts or status. It fetches the resource from PayPal and uses that.
- **Tolerate disorder.** Events can arrive late or out of order. State machines only move forward, so a stale event changes nothing.
- **One circle at a time.** Events are queued in a group per circle, so they are processed in order for that circle.

**Simulator events.** PayPal's webhook simulator sends events that cannot be verified by PayPal's verification call. Kin accepts them only in the test environment, behind an explicit setting, and marks them as simulated.

### 8.8 Reconciliation

Webhooks are fast but can be missed. Every night Kin reads the pool's transaction history and balance from PayPal and compares them with the ledger.

- **A PayPal transaction with no ledger entry** means a missed event. Kin fetches the resource and applies it through the normal path.
- **A ledger entry with no PayPal transaction** is a serious fault. Kin alerts and does not correct it automatically.
- **A balance difference** is reported to the organizer with the entries that explain it.

PayPal's transaction history can lag behind real time, so reconciliation looks at a window that ends several hours in the past.

### 8.9 The PayPal adapter

`packages/paypal` is the only code that talks to PayPal.

- **Token handling.** Access tokens are fetched per pool account, cached until shortly before expiry and never logged.
- **One method per business action,** such as `createPayout` or `captureOrder`, each requiring an idempotency key.
- **Typed results and typed errors,** so callers can tell a decline from an outage.
- **Debug IDs.** PayPal returns a debug ID with each response. Kin logs it with every call, which makes support requests to PayPal possible.
- **Retry policy.** Network errors and server errors are retried with backoff, using the same idempotency key. Client errors are not retried.

---

## 9. AI architecture

### 9.1 The principle

The agent is powerful at understanding and powerless over money. It reads documents, holds conversations, explains balances and drafts proposals. It cannot approve, execute or alter a record of what happened.

```mermaid
flowchart LR
    user["Person<br/>typed or spoken"]
    ctx["Context builder<br/>role, circle snapshot"]
    llm["Claude Opus 5.5"]
    gw["Tool gateway<br/>authorization and policy"]

    read["Read tools<br/>ledger, bills, PayPal data"]
    prop["Propose tools<br/>create proposals only"]

    core["Money core<br/>approval engine, executor"]
    human["Human approval"]
    guard["Number guard"]
    out["Reply<br/>text or speech"]

    user --> ctx
    ctx --> llm
    llm --> gw
    gw --> read
    gw --> prop
    read --> llm
    prop --> core
    core --> human
    human --> core
    llm --> guard
    guard --> out
```

### 9.2 The agent loop

One agent serves every channel. What changes is who it is speaking to.

1. **Build context.** The context builder loads the speaker's role, language and permissions, and a compact snapshot of the circle: balances, open bills, pending approvals and recent events. This snapshot is produced by the money core, not by the model.
2. **Run the model** with the tools the speaker's role allows.
3. **Route tool calls** through the tool gateway.
4. **Check the reply** with the number guard.
5. **Deliver** as text or speech and store the turn.

**Model configuration**

- Model `claude-opus-5-5` through the Anthropic TypeScript SDK and its tool runner.
- Effort is set explicitly on every call: low for spoken turns, medium for typed conversation, high for documents and statements.
- Tool choice is automatic, with strict tool schemas. This model rejects forced tool choice.
- Structured output for anything Kin stores.
- Streaming for every reply a person waits for.
- The stop reason is checked on every response. A refusal is handled as a normal outcome, and server-side fallbacks are enabled.
- The system prompt and tool list are stable and cached. The changing circle snapshot comes after the cached part.

### 9.3 The tool gateway

Every tool call passes through one gateway, which does four things before any tool runs.

1. **Identity.** Confirms who is speaking and in which circle.
2. **Scope.** Confirms the role may use this tool.
3. **Validation.** Validates arguments against the tool's schema.
4. **Record.** Writes the call to the conversation log.

**Tools by role**

| Tool                                | Parent | Sibling | Caregiver | Kind                             |
| ----------------------------------- | ------ | ------- | --------- | -------------------------------- |
| `get_circle_summary`              | Yes    | Yes     | No        | Read                             |
| `list_bills`, `get_bill`        | Yes    | Yes     | Own only  | Read                             |
| `get_ledger`, `explain_balance` | Yes    | Yes     | No        | Read                             |
| `get_payment_status`              | Yes    | Yes     | Own only  | Read                             |
| `search_paypal_transactions`      | No     | Yes     | No        | Read, through the PayPal toolkit |
| `search_merchant_catalog`         | Yes    | Yes     | No        | Read                             |
| `check_payment_claim`             | Yes    | Yes     | No        | Read                             |
| `submit_document`                 | Yes    | Yes     | Yes       | Write to inbox                   |
| `log_care_hours`                  | No     | Yes     | No        | Write, needs approval            |
| `propose_bill_payment`            | Yes    | Yes     | No        | Proposal                         |
| `propose_purchase`                | Yes    | Yes     | No        | Proposal                         |
| `propose_caregiver_bill`          | No     | No      | Yes       | Proposal                         |
| `record_voice_decision`           | Yes    | No      | No        | Approval, after read-back        |
| `alert_circle`                    | Yes    | Yes     | Yes       | Notification                     |

**No tool pays anyone.** The strongest tools create a proposal. The approval engine and a person stand between every proposal and PayPal.

**How the PayPal Agent Toolkit is used.** The agent receives PayPal's read tools, such as listing transactions and reading an order, an invoice, a subscription or a shipment, filtered to an allowed list. PayPal's write tools are not given to the model. Writes go through Kin's proposals and are carried out by the executor through the PayPal adapter.

### 9.4 Reading documents

```mermaid
flowchart LR
    photo["Photo or forwarded email"]
    s3["S3"]
    q["documents queue"]
    ext["Extraction<br/>Claude vision, structured output"]
    chk["Checks<br/>duplicate, payee, amount range"]
    inbox["Bill inbox"]
    rev["Needs review"]

    photo --> s3
    s3 --> q
    q --> ext
    ext --> chk
    chk --> inbox
    chk --> rev
```

1. The photograph is uploaded directly to S3.
2. The worker sends it to Claude with a fixed schema: document type, sender, amount, currency, due date, account reference, and a confidence for each field.
3. Deterministic checks run on the result:
   - **Duplicate:** same payee, amount and period as an existing bill.
   - **Payee:** known and approved, known and new, or unknown.
   - **Range:** within the usual range for this payee, or not.
   - **Confidence:** every required field above its threshold.
4. A document that passes becomes a bill. One that does not goes to a person with the reason stated.

**The document is untrusted.** Its text is treated as data to extract, never as instructions to follow. This matters because a scam letter may be written to manipulate whoever reads it.

**Built: reading a caregiver's description of their visits (milestone 4).** On the Bills screen a caregiver may write their visits as they would say them; Claude reads them into service days and durations that fill the bill form, and the caregiver reviews the bill as always (`packages/agent` `readVisits`, prompt `visits-2026-10-26`). The request carries no tools and only the caregiver's words, wrapped as data, with today's date: never the rate, a name or an amount. The answer follows a JSON schema and is then checked in code: real days, none in the future or more than 62 days back, whole minutes within a day, same-day entries added, and each entry must quote the caregiver's words or it is left out. A refusal, a cut-off answer or an unreachable model leaves the form as it was. Each person may ask ten times an hour, and each server at most 200 times an hour for demo visitors and 200 for people who signed in, because anyone can become a new demo visitor and the demo must not use up what families rely on. Every limit is checked before any is used, so a refused request costs nothing; the limiter tracks at most 20 000 people, sweeps expired ones at most ten times a window, and refuses newcomers while full. The limits live in the server's memory, so they bound spend per instance, not across instances. A spend cap or budget alarm on Bedrock in AWS is not set up. The fixed evaluation set is `packages/agent/evals/visits.json` (`pnpm --filter @kin/agent run eval`); it has not yet been run against the real model, because Kin's AWS account is not yet entitled to Claude Opus 5.5 on Bedrock. On 29 October 2026 the account was refused ("not available for this account") for every Claude model Bedrock's Messages endpoint serves (Opus 4.7 and later, Sonnet 5 and later, Haiku 5.5, Fable); Opus 4.6, Sonnet 4.6 and Haiku 4.5 answer only through the older InvokeModel API, which refuses the SDK's current API version. The hosted app reaches Claude once `kin:claude` is `true` in `infra/cdk.json`, which grants App Runner `bedrock-mantle:CreateInference` in its own account and region, and Marketplace subscription only when Bedrock makes it; it stays off until AWS grants the account the model and the evaluation set passes (decision 60).

**Built: holding up a letter (demo moment 5).** On the Bills screen the parent, the organizer or a contributor may photograph a letter, bill or receipt, type or paste its words, or both. A photograph is shrunk to a JPEG in the browser and sent as base64 (about 3 MB at most, checked on the server against its own first bytes). `readDocument` in `packages/agent` asks Claude with no tools, the document as data in `<document>` tags or as the attached picture, and a fixed schema; `settleReading` in `packages/documents` then believes nothing: the amount must be a plain decimal and, for typed words, appear in them, the sender likewise, and a field that fails is dropped to `null`, never repaired. A photograph has no words to check against, so its reading is marked `model_photo` and the screen says to check the amount. With no model, typed words are read by plain rules (`readLetterText`, confidence 0.5); a photograph cannot be read. A bill from a sender Kin can name, without pressure, is recorded by `kin_private.add_letter` as `received → extracted → needs_review`, or as `duplicate` of an open bill with the same payee, amount and due date, under the payee the circle already has by that name or a new payee in category `other`. Nothing is paid and no proposal is raised: a person reviews it, and that review is not built. A letter that pushes for payment (gift cards, arrest, "within 24 hours") is not listed; Kin says not to pay and to check the demand. No bucket holds the photograph, so a real circle's document row carries the reading instead of an S3 key (migration 0013 relaxes `documents_stored_or_simulated` to `documents_stored_or_read`). What Kin says is fixed wording filled from the stored reading (`letterWords`), in the listener's language, never written by a model; "Hear it again" asks `/api/speech/say` for `{kind: "letter", documentId}`. `pnpm --filter @kin/agent run eval:documents` is the fixed evaluation set for the prompt; it has never run against the real model.

### 9.5 The claim check

When the parent asks whether a demand for money is real, the answer must not depend on the model's judgment.

1. **Extract.** The model turns what the parent said, or the photographed letter, into a structured claim: who is asking, how much, for what.
2. **Look up.** Plain code searches the circle's payees, bills and ledger.
3. **Decide.** Plain code picks one of four verdicts.

| Verdict                  | Condition                              | What the parent hears                                                           |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------------- |
| **Already paid**   | A matching bill was paid               | "That bill was paid on the 2nd. Nothing is owed."                               |
| **Known and due**  | A matching bill is open                | "That is a real bill. It is on the family's list and will be paid on the 30th." |
| **No record**      | The payee is known but nothing matches | "I find no bill like that. Please do not pay. I have told the family."          |
| **Unknown sender** | The payee is not known at all          | "I do not know this sender. Please do not pay. I have told the family."         |

4. **Phrase.** The model words the verdict in the parent's language. The facts are filled in from the lookup.
5. **Alert.** For the last two verdicts the circle is told at once.

Kin never says a caller is a criminal. It says what its records show and what to do.

**Built: checking a demand (demo moment 6).** On the Bills screen the same three roles enter who is asking, how much (optional) and what they said, which is stored as information and never read as instructions. `checkClaim` in `packages/domain` decides from the record alone. The stored verdict is `match`, `no_match` or `unclear`, so the table above maps onto it: a known payee with an open bill of exactly that amount is `match` (known and due); an amount the record shows as already paid, with nothing open, is `no_match` (already paid, and the payment is stored as `found_entry_id`); a name nobody in the circle goes by is `no_match` (unknown sender); a known payee with no bill or payment of that amount, or with no amount named, is `unclear` ("no record": Kin cannot confirm it and says to wait and ask the family, rather than telling the parent it is false). Names match when every word of the shorter is a word of the longer, ignoring case, accents and company suffixes, and one short word never matches. `kin_private.record_claim_check` stores the check and tells every active member who sees the circle's money (organizer, contributor, parent, observer) for every verdict, not only the last two, by writing the words Kin spoke to `narrations` for each of them; a caregiver is never told. The words are the fixed sentence for the reason, which `narrate` in `packages/agent` may hand to Claude to rephrase when a model and a use are available; the number guard (`passesNumberGuard`) refuses any wording with a number the record did not supply, a link or an address, and Kin then speaks the fixed sentence. Each member hears their stored words with `/api/speech/say` `{kind: "claim", claimCheckId}`, in the language of their screen, which is not necessarily the language the checker used.

### 9.6 Narration and the number guard

Every sentence about money that reaches a person is built the same way.

1. **Facts from the ledger.** A money event produces a small record: kind, payee, amount, date, source.
2. **Wording from the model.** The model turns the record into a natural sentence in the listener's language.
3. **The number guard.** Before delivery, code extracts every amount, date and name from the sentence and compares them with the record. If anything differs or is missing, the sentence is discarded and a fixed template is used.

This means the parent can never hear an amount that the ledger does not contain. The same guard checks statements and explanations.

### 9.7 Defense against manipulation

| Threat                                            | Defense                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A letter contains instructions aimed at the agent | Document text is passed as data. The extraction step has no tools at all.                                          |
| A caller tells the parent to instruct Kin to pay  | The agent can only propose. New payees always need a family member's approval.                                     |
| A user asks the agent to ignore its rules         | The rules are enforced in the gateway and the approval engine, not in the prompt.                                  |
| The model invents an amount                       | The number guard rejects it.                                                                                       |
| A caregiver asks about the family's finances      | The gateway refuses tools outside the caregiver's scope.                                                           |
| The model's reply drifts out of role              | Replies are checked against a short list of things Kin never says, such as requests for passwords or card numbers. |

### 9.8 Measuring the AI

Three fixed test sets run before every release.

- **Documents:** photographs of bills and letters with known contents. Measures extraction accuracy per field.
- **Claims:** true and false payment demands. Measures verdict accuracy. A false "already paid" is treated as the worst error.
- **Conversations:** scripted exchanges per role. Measures correct tool use and refusal of out-of-scope requests.

---

## 10. Voice architecture

### 10.1 Two voice paths, one agent

| Path                   | Used by                                  | Transport                                                           |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| **Phone call**   | The parent, on any phone                 | Telephony provider to the voice service over a streaming connection |
| **In-app voice** | The parent and caregiver, in the browser | Browser microphone to the voice service over a WebSocket            |

Both paths end in the same voice session, which runs the same agent with the same tools.

### 10.2 Inside a voice session

```mermaid
flowchart LR
    audio_in["Audio in"]
    stt["Speech to text<br/>streaming"]
    turn["Turn detection<br/>and interruption"]
    agent["Agent turn<br/>streaming"]
    guard["Number guard"]
    tts["Text to speech<br/>streaming"]
    audio_out["Audio out"]

    audio_in --> stt
    stt --> turn
    turn --> agent
    agent --> guard
    guard --> tts
    tts --> audio_out
    audio_in --> turn
```

- **Streaming end to end.** Speech is transcribed as it arrives, the model's reply is spoken as it is produced, and each sentence is checked and voiced before the next is complete.
- **Interruption.** If the parent starts speaking, playback stops at once and Kin listens.
- **Patience.** Pauses are allowed to be long. Kin repeats on request and slows down if asked.
- **Short context.** A voice turn carries a small snapshot, which keeps replies quick.
- **State.** The session is held in the voice service's memory and checkpointed to the database after each turn, so a dropped call can resume.

### 10.3 Calls Kin makes

1. A schedule or an event creates a narration for the parent.
2. The worker checks the parent's preferences: immediately, daily or weekly, and the hours when calls are welcome.
3. The worker asks the telephony provider to place a call to the registered number.
4. When the parent answers, the call is connected to a voice session.
5. Kin introduces itself in the same words every time.
6. If voicemail answers, Kin leaves no money details. It says only that Kin called and will call again.

### 10.4 Calls the parent makes

1. The telephony provider receives the call and asks Kin what to do.
2. Kin matches the caller's number to a parent.
3. The call is connected to a voice session.
4. Before any money is discussed, the parent confirms with their spoken phrase or PIN.
5. An unknown number hears a short neutral message and nothing else.

### 10.5 Voice approvals

A spoken yes is a real approval, so it is handled carefully.

1. Kin states the request in full: what, for whom and how much.
2. The parent answers.
3. Kin reads back the decision and asks for confirmation.
4. Only after the confirmation does Kin record the approval.
5. The record holds the call reference, the verification result, the sentence read back and the reply.

Three failed verifications end the call and alert the organizer. The parent's level drops to "informed" until a family member restores it.

### 10.6 Built: in-app voice for caregiver bills (milestone 5)

- **Speaking visits.** On the Bills screen a caregiver may press Speak and say their visits. The browser records at most a minute, turns it into 16 kHz PCM itself, and sends it to `/api/speech/transcribe`; Amazon Transcribe streaming writes it down (`packages/speech`), and the words go into the description box, where the caregiver can correct them before Claude reads them (section 9.4).
- **Hearing the bill.** On review, Hear the bill asks `/api/speech/say` to read the server's own calculation of that bill aloud through Amazon Polly. The sentence is fixed wording filled from the record, never written by a model and never text sent in, so it cannot say an amount the screen does not show.
- **A spoken yes.** Answer by voice records a reply, Transcribe writes it down, and `spokenAnswer` in `packages/domain` decides by plain rules whether it is a clear yes, a clear no or neither: a short reply that says yes and nothing that could mean no. A yes does exactly what the Submit button does; a no returns to the visits; anything else asks again.
- **Answering a proposal by voice, in the demo.** Following section 10.5: Kin reads the proposal, hears the answer, reads back what it heard, and records the answer (method `voice`, with a hash of the confirming words as evidence) only after a clear spoken yes. Both answers are transcribed on the server. Real circles keep the fresh multi-factor check, because a voice in a browser proves no second factor; caller verification belongs to the phone line, which is not built.
- **Limits.** Each person may use speech sixty times an hour, and each server 600 times an hour for demo visitors and 600 for people who signed in, checked before anything is used. App Runner may call Transcribe and Polly only when `kin:speech` is `true` in `infra/cdk.json`; it is on in the hosted app since 29 October 2026.
- **Verified:** the adapters against the real services (Polly's speech of a caregiver's sentence came back from Transcribe word for word in English and French in 1.3 to 2 seconds; spoken yes, no, oui and ja were each read correctly; Hebrew has no voice); the actions against fakes in PostgreSQL; the browser journeys with Chromium's fake microphone and the speech routes answered in the browser. Not verified: a real person's microphone through the deployed app.

### 10.7 Latency target

The target is that Kin begins speaking within about one and a half seconds of the parent finishing. That budget is shared between detecting the end of speech, the model's first words and the first audio. It is a target to measure against, not a measured result.

---

## 11. Key flows

### 11.1 A monthly contribution arrives

```mermaid
sequenceDiagram
    participant PP as PayPal
    participant WEB as web
    participant WK as worker
    participant DB as Aurora
    participant N as notify

    PP->>WEB: PAYMENT.SALE.COMPLETED
    WEB->>DB: store event
    WEB-->>PP: 200 OK
    WK->>PP: read the sale and its subscription
    WK->>DB: credit member, debit pool cash and fees
    WK->>N: contribution received
    N-->>WEB: update the family's view
    N-->>WK: queue narration for the parent
```

### 11.2 The caregiver bills by voice and is paid

```mermaid
sequenceDiagram
    participant C as Caregiver
    participant V as voice
    participant A as Agent
    participant DB as Aurora
    participant O as Organizer
    participant WK as worker
    participant PP as PayPal

    C->>V: Bill the family, three visits, four hours each
    V->>A: transcript
    A->>DB: propose_caregiver_bill
    A-->>C: reads the bill back
    C->>V: Yes
    DB-->>O: approval request
    O->>DB: approve, with a fresh multi-factor check
    DB->>WK: execution through the outbox
    WK->>PP: create payout with idempotency key
    PP-->>WK: batch accepted
    PP->>WK: PAYMENT.PAYOUTS-ITEM.SUCCEEDED
    WK->>DB: confirm, clear the payable
    WK-->>C: You have been paid
```

### 11.3 A refill, approved by the parent's voice

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant WK as worker
    participant A as Agent
    participant M as Merchant
    participant P as Parent
    participant V as voice
    participant DB as Aurora
    participant PP as PayPal

    S->>WK: refill is due
    WK->>A: prepare the refill
    A->>M: search catalog, build cart
    A->>DB: propose_purchase with items and total
    DB->>V: call the parent
    V->>P: Your refill costs 42 dollars. Shall I order it?
    P->>V: Yes
    V->>P: I will order it for 42 dollars. Is that right?
    P->>V: Yes
    V->>DB: record voice approval
    DB->>WK: execution through the outbox
    WK->>M: signed instruction with approved total
    M->>PP: create and capture order with saved payment token
    PP-->>M: captured
    M-->>WK: order confirmed
    WK->>DB: write the expense entry
    WK->>V: queue narration with the delivery date
```

### 11.4 The parent photographs a letter

```mermaid
sequenceDiagram
    participant P as Parent
    participant WEB as web
    participant S3 as S3
    participant WK as worker
    participant CL as Claude
    participant DB as Aurora
    participant O as Organizer

    P->>WEB: holds the letter to the camera
    WEB->>S3: upload
    WEB->>WK: document queued
    WK->>CL: extract with fixed schema
    CL-->>WK: sender, amount, due date, confidence
    WK->>DB: run duplicate, payee and range checks
    WK->>DB: create bill
    WK-->>P: This is from the water company. 61 dollars is due on the 30th.
    WK-->>O: new bill on the list
```

### 11.5 A false demand is caught

```mermaid
sequenceDiagram
    participant P as Parent
    participant V as voice
    participant A as Agent
    participant D as Domain lookup
    participant DB as Aurora
    participant F as Family

    P->>V: A man says I owe 300 dollars for gas today
    V->>A: transcript
    A->>D: check_payment_claim, gas, 300
    D->>DB: search payees, bills and ledger
    DB-->>D: gas bill of 57 dollars paid on the 2nd
    D-->>A: verdict. no record of this demand
    A-->>V: worded reply, checked by the number guard
    V->>P: I find no gas bill outstanding. Please do not pay. I have told the family.
    D->>F: alert with the details
```

### 11.6 Month-end settlement

```mermaid
sequenceDiagram
    participant S as Scheduler
    participant WK as worker
    participant DM as Domain
    participant DB as Aurora
    participant F as Family
    participant PP as PayPal

    S->>WK: period closes
    WK->>DB: snapshot inputs
    WK->>DM: calculate positions
    DM-->>WK: who owes, who is owed
    WK->>DB: create settlement and proposals
    DB-->>F: settlement ready for approval
    F->>DB: approve
    WK->>PP: send invoices to members who owe
    PP->>WK: INVOICING.INVOICE.PAID
    WK->>PP: payouts to members who are owed, within confirmed balance
    PP->>WK: PAYMENT.PAYOUTS-ITEM.SUCCEEDED
    WK->>DB: close the period
    WK-->>F: statement for every member, spoken summary for the parent
```

---

## 12. Identity and access

### 12.1 Signing in

Which first factors Cognito offers is set in `infra/src/identity.ts`: a password always, and a code by email once `KIN_SENDER_EMAIL` names the Gmail account that sends Kin's email (decision 34). Cognito then hands every code, encrypted with Kin's key, to the `kin-sign-in-email` function (`apps/worker/src/cognito-email-sender`), which may decrypt only codes bound to Kin's user pool and sends them through Gmail with an app password kept in Secrets Manager. How the web app does it today: `/auth/sign-in` draws a PKCE verifier, a state and a nonce, keeps them in a ten-minute cookie, and sends the browser to Cognito's `/oauth2/authorize`, or to its `/signup` page with the same parameters when the start screen asks for `screen=sign-up`. `/auth/callback` checks the state, trades the code with the verifier, verifies both tokens (issuer, signature, expiry, app client, `token_use`, the nonce, the same `sub`) and sets the session cookies. `/auth/refresh` renews expired tokens with the refresh token, and `/auth/sign-out` (POST only) clears the cookies and ends the Cognito session. The proxy refuses `/dashboard` without a verified session, and every page under it verifies again before reading anything. The code is in `packages/auth`, `packages/config` and `apps/web/src/server/auth`.

Cognito's pages carry Kin's look (decision 36). `infra/src/managed-login/branding.ts` sets the colours from the web app's design tokens, light and dark, following the person's preference. It also sets the knot logo in the form, a paper background with drifting share colours and a turning knot watermark, and the graphics for each sign-in factor. Cognito keeps its defaults for the rest. The images are SVG files drawn by `apps/web/src/components/brand/sign-in-brand.ts` and written to `infra/src/managed-login/assets/` by `pnpm --filter @kin/web run brand:export`. A test fails when the committed files and the generator disagree. Their animations stop under reduced motion.

- **Amazon Cognito** holds one user pool for every person.
- **Passwordless sign-in** by emailed code or passkey, through Cognito's managed pages.
- **Multi-factor authentication** is required for organizers and for anyone approving a payout. Approving a payout asks for a fresh check even inside an active session. Built for a yes to real money: **Approve** posts to `/auth/step-up`, which sends the person back through Cognito with `prompt=login`, `max_age=0` and `acr_values=urn:cognito:loa:4`. The callback records the yes only if the same person returns with an ID token whose `amr` lists `mfa` and whose `auth_time` is under five minutes old (`assessStepUp` in `packages/auth`); the token's ID, time and methods are stored as the approval's evidence, and the database refuses a real yes without it. A no needs no step-up. The demo's simulated money is answered without one. Enforcing MFA at sign-in for organizers is not built.
- **Tokens** are verified by every service on every request.

### 12.2 Linking a PayPal account

Signing in to Kin and connecting a PayPal account are separate steps.

- A member connects PayPal through Log in with PayPal. The web service handles the exchange directly and stores the member's payer ID and verified email.
- That identity is what payouts are sent to, which prevents a payout going to a mistyped address.
- **Signing in to Kin with PayPal through Cognito is optional.** PayPal's login uses its own endpoints, and whether it fits Cognito's federation needs a trial. Kin does not depend on it.

### 12.3 Authorization

Three layers, each independent of the others.

| Layer                        | Question                                     | Where enforced                                       |
| ---------------------------- | -------------------------------------------- | ---------------------------------------------------- |
| **Account type**       | May this person use this part of Kin at all? | Cognito group, checked at the edge                   |
| **Circle role**        | What may this person do in this circle?      | Service, on every request, from the`members` table |
| **Row-level security** | Can this query see this row?                 | Aurora, on every query                               |

**How row-level security works.** At the start of each request, the service opens a transaction and sets the user's ID as a session setting (`kin.user_id`, local to that transaction, so a pooled connection never carries one person into the next request). Every table has a policy that allows a row only if the user is an active member of that row's active circle, with further limits for caregivers and observers. A query that forgets its filter returns nothing instead of another family's data, and a transaction that names nobody sees nothing at all. Built in `packages/db/migrations/0001_security.sql`; `packages/db/src/security/*.test.ts` attempt every forbidden access and check every table has row-level security on and a policy.

**Three database roles connect, and none owns a table or bypasses row-level security.**

| Role | Acts as | May |
| ---- | ------- | --- |
| `kin_app` | A signed-in person or a demo visitor (`kin.user_id`) | Read what their role in each of their circles allows. Write their own `users` row; answer a pending proposal in their own seat and role (organizer, contributor or parent) — in a real circle a yes must carry the fresh multi-factor check's evidence, and a no needs none — and close it only as the stored plan allows (approved needs as many different members' yeses as the plan has places, no no, and someone other than the member being paid; rejected needs a no; expired needs the time to be up); pause the circle in their own name for at most 24 hours (not an observer), and lift it if they paused it or organize it; invite someone (organizers); and record what they did in the audit log. Through `kin_private` functions: propose a version of the agreement (organizers) and accept the newest one (organizers, contributors, the parent); start a real circle, join the circles that invited their verified address, take another seat or give up their own in a demo circle. Each grant is column by column where a table is shared. |
| `kin_service` | Kin's worker, for the one circle a job names (`kin.circle_id`) | Read, add and change rows of that circle. Never delete. Across circles, only lease outbox messages through `kin_private.claim_outbox`, which returns each message's circle so the work is then done in that circle's scope. |
| `kin_provisioner` | The demo provisioner | Add rows only to a demo circle created in the same transaction (the circle records the transaction's ID). It cannot read anything, so it cannot reach an existing family. |

A caregiver reads only the payees that are their own seat, the bills, proposals and ledger entries that pay them or that they raised, and their own care entries and documents. They read no agreement, settlement, claim check or narration. An observer reads everything a contributor reads and writes nothing. The audit log and invitations are for organizers.

**The money rules, again in the database.** Triggers refuse any update, delete or truncate of ledger entries and lines, approvals, agreement versions and the audit log, even by the tables' owner. A deferred check at commit refuses an entry that does not balance or has fewer than two lines. Lines can join an entry only in the transaction that wrote it. A reversal must cancel an original of the same kind and currency, once. An entry must be in its circle's currency. A proposal's, bill's or execution's state can move only along `kin_private.state_transitions`, which a test compares with `packages/domain`. After a proposal is raised, only its state and expiry can change.

**Adding money.** Only organizers and contributors may top up the pool (`money.contribute`). The parent's money is the pool's purpose, and a caregiver or an observer has no share to pay.

**Service access.** The worker acts for the system, not for a user. It uses a separate database role, and each job names the single circle it is working on. The web app holds only `kin_app` and, in the demo environment, `kin_provisioner`. It never holds the admin's or the service's password.

### 12.4 The parent on a call

Covered in section 10. A phone call has no browser session, so identity comes from the registered number and a spoken phrase or PIN. The voice service is limited to the circle of the verified parent.

---

## 13. Interfaces

### 13.1 HTTP API

Served by `web`. A person's routes require a verified Cognito session; the isolated demo uses its verified signed visitor session. Webhooks carry their own signatures. The table includes intended routes; entries explicitly marked built are implemented.

| Group                   | Purpose                                         |
| ----------------------- | ----------------------------------------------- |
| `/api/circles`        | Create and read circles, members and agreements |
| `/api/contributions`  | Subscriptions, top-ups, out-of-pocket receipts  |
| `/api/care`           | Log and approve care hours                      |
| `/api/documents`      | Upload links, document status                   |
| `/api/bills`          | List, review, approve payees                    |
| `/api/caregiver-billing` | Built: POST `configure` (rate, and optionally the caregiver's PayPal email), `review`, `submit`, and the family's `send` (raise the payout proposal) and `decline`, for caregiver rates and own bills. Uses the authenticated circle, independent account and role checks, same-origin enforcement and a capped JSON body. Review and submission do not approve or pay. |
| `/api/agreement`      | Built: POST `review` (check a draft and say what changes, storing nothing), `propose` (organizers) and `accept` (organizers, contributors, the parent), behind the same origin, session and body checks as `/api/caregiver-billing`. The screen is `/dashboard/circle/agreement`. |
| `/api/proposals`      | List, approve, reject, cancel. *Built instead as server actions on the Approvals screen; a yes to real money goes through `POST /auth/step-up` (section 12.1).* |
| `/api/ledger`         | Entries, balances, fairness positions           |
| `/api/settlements`    | Preview, approve, history                       |
| `/api/statements`     | Monthly statement, yearly review, audit export  |
| `/api/agent`          | Typed conversation with the agent, streamed     |
| `/api/paypal/connect` | Link a PayPal identity                          |
| `/api/admin/pause`    | Pause and resume a circle                       |

### 13.2 Inbound webhooks

| Route                                | From                   | Protection                  |
| ------------------------------------ | ---------------------- | --------------------------- |
| `/webhooks/paypal/{poolAccountId}` | PayPal                 | Signature verification      |
| `/webhooks/telephony/*`            | Telephony provider     | Signature verification      |
| `/webhooks/merchant/{merchantId}`  | Participating merchant | Signed with a shared secret |

### 13.3 Live connections

| Route             | Used for                               |
| ----------------- | -------------------------------------- |
| `/voice/stream` | Call audio from the telephony provider |
| `/voice/app`    | In-app voice from the browser          |

### 13.4 The Kin MCP server

Kin is itself usable by other AI agents. A sibling can connect their own assistant and ask about the circle.

- Protected by Cognito-issued OAuth tokens.
- Exposes the same tools as the sibling role, through the same tool gateway.
- Every write is a proposal. An outside agent can never approve or execute.

---

## 14. Infrastructure on AWS

### 14.1 Layout

```mermaid
flowchart TB
    internet["Internet"]
    r53["Route 53 and ACM"]
    waf["AWS WAF"]

    subgraph vpc["VPC, two availability zones"]
        subgraph pub["Public subnets"]
            alb["Application Load Balancer"]
            nat["NAT gateway"]
        end
        subgraph priv["Private subnets"]
            web["web tasks"]
            voice["voice tasks"]
            worker["worker tasks"]
            aurora[("Aurora Serverless v2")]
        end
    end

    subgraph managed["Managed services"]
        cognito["Cognito"]
        s3["S3"]
        sqs["SQS"]
        eb["EventBridge Scheduler"]
        sm["Secrets Manager"]
        kms["KMS"]
        ses["SES"]
        cw["CloudWatch"]
        ecr["ECR"]
    end

    internet --> r53
    r53 --> waf
    waf --> alb
    alb --> web
    alb --> voice
    web --> aurora
    voice --> aurora
    worker --> aurora
    web --> nat
    voice --> nat
    worker --> nat
    nat --> internet
    web --> managed
    voice --> managed
    worker --> managed
```

### 14.2 Network

- One VPC across two availability zones.
- The load balancer sits in public subnets. Services and the database sit in private subnets with no public address.
- Outbound calls to PayPal, Claude, speech and telephony leave through a NAT gateway.
- Security groups allow only the load balancer to reach the services, and only the services to reach the database.

### 14.3 Compute

| Service | Tasks     | Notes                                                             |
| ------- | --------- | ----------------------------------------------------------------- |
| web     | 1 to 2    | On App Runner today (decision 35), health-checked                 |
| voice   | 1 or more | Connections are drained before a task stops, so calls are not cut |
| worker  | 1         | Fargate, Arm, 0.25 vCPU and 0.5 GB, about seven dollars a month (decision 45). Long-polls the PayPal inbox; scales on queue depth when there is depth to scale on |

The load balancer routes `/voice/*` to the voice service, with a long idle timeout for live audio. Everything else goes to web.

### 14.4 Data

- **Aurora Serverless v2,** PostgreSQL-compatible, one writer, in private subnets. Minimum capacity is zero, so it pauses after five idle minutes and costs nothing then (decision 43). The first connection after a pause wakes it, which took 74 seconds on 15 October 2026: the web app waits up to 90 seconds for a connection, inside App Runner's 120-second limit on a request, and the migration retries for up to five minutes.
- **Backups** with point-in-time recovery.
- **Encryption** with a KMS key.
- **Migrations** run as a one-off Fargate task (`kin-database-migrate`, in the services subnets) before the web app rolls out. It alone reads the admin's password from the cluster's secret, applies `packages/db/migrations`, and sets each service role's password from its own secret (`kin/database/app`, `kin/database/service`, `kin/database/provisioner`). A task, not a Lambda function, because the shared account's Lambda quota is small and the task can take as long as Aurora needs to resume.
- **TLS** to the database is always verified. The images carry Amazon RDS's certificate bundle (`NODE_EXTRA_CA_CERTS`). Plain connections are refused except to a database on the same machine.

### 14.5 Queues and schedules

| Queue             | Carries                              | Ordering    |
| ----------------- | ------------------------------------ | ----------- |
| `paypal-events` | Webhook deliveries as received, and captured orders to read back. The worker takes one message at a time, and a message stays hidden for 300 seconds while it is handled, longer than its slowest case (Aurora resuming, then three PayPal calls with retries) | Per circle  |
| `executions`    | *Not created.* Approved payouts are leased from the outbox table instead (decision 53) | Per circle  |
| `documents`     | Photographs to read                  | None needed |
| `notifications` | Emails, pushes, alerts               | None needed |
| `narration`     | Items for the parent to hear         | Per parent  |

Every queue has a dead-letter queue and an alarm on it.

**Schedules:** period close per circle in its own timezone, refill reminders, the parent's calling times, invoice reminders, approval expiry and the nightly reconciliation.

### 14.6 Storage

- **Documents bucket:** private, encrypted, versioned. Objects are reached only through short-lived signed links.
- **Exports bucket:** statements and audit exports, with the same protections.

### 14.7 Configuration

- Non-secret configuration is typed and validated at startup. A service with invalid configuration does not start.
- Secrets come from Secrets Manager at startup and are never written to logs or images.

### 14.8 Sharing the AWS account

Kin runs in AWS account `707938860881`, us-east-1, beside four other projects: wick (Terraform), Hold (CDK, default bootstrap), carecircle (Terraform) and zeitzeuge. Kin shares only what an account cannot hold twice or should not: the GitHub OIDC provider and the region. Every Kin resource is its own, named `kin-*` or `Kin*` and tagged `project=kin`.

Separate names are not enough on their own. Some of the other projects' principals hold account-wide permissions, such as wick's deploy role with `s3:*`, `dynamodb:*` and `lambda:*` on every resource. So Kin keeps them out in its own resource policies:

| Boundary | How it holds |
| --- | --- |
| Encryption | One customer key, `alias/kin`, for Aurora, both buckets, every queue and the database secret. |
| Explicit deny | Every bucket, queue and secret, and the key itself, deny all actions to the other projects' roles and users, listed in `cdk.json` as `kin:neighbourPrincipalPatterns`. An explicit deny overrides any allow they hold. Add a pattern when a project joins the account. |
| Network | Kin's own VPC. The database admits only the `kin-services` security group, on port 5432, from isolated subnets with no internet route. |
| Sign-in | Kin's own Cognito pool, `kin-people`. Nobody signs in across projects. |
| Deployment | Kin's own CDK bootstrap, qualifier `kin`, stack `KinCDKToolkit`. The GitHub role `kin-github-deploy` trusts one repository and one branch, and may assume only the bootstrap's deploy and publishing roles, not its lookup role, which can read the whole account. |
| Deployment boundary | `kin-deploy-boundary` is the permissions boundary on CloudFormation's execution role and on every role Kin's stacks create. Under it nothing can touch what is tagged or named as another project (`kin:neighbourProjects`), change IAM outside `Kin*` and `kin-*` roles and `kin-*` policies, create or arm a role that lacks the boundary, remove a boundary, edit the boundary itself, assume any role but Kin's own and the bootstrap's three deployment roles, or make account-wide changes. AdministratorAccess on the execution role is capped by it. The boundary lives in `KinGuardrails`, which a person deploys with their own credentials and CI never deploys, so a deployment cannot loosen the limits it runs under. |
| Cost | The budget `kin-monthly` counts only resources tagged `project=kin`. |

**Order in a fresh account.** The bootstrap names the boundary, so it must exist first: deploy `KinGuardrails` with your own credentials (`cdk deploy KinGuardrails`), run the bootstrap script, then deploy the other stacks.

**What the deny cannot cover.** Kin's bootstrap roles trust the whole account, as every CDK bootstrap does, so a principal with rights to assume any role can still use them. The boundary limits what such a deployment can do. Cognito user pools, Lambda functions, log groups and ECR repositories have no resource policy that a deny can sit in, or none that covers management actions. Wick's deploy role can change any of them. Closing that needs wick's role narrowed to `wick*` resources, in wick's repository. The account's Lambda concurrency quota is 10 and is shared, so Kin adds two functions: the deploy-time custom resource that locks the VPC's default security group, and the sign-in email sender once it is switched on. Neither reserves concurrency.

The stacks are `KinGuardrails` (the boundary, deployed by a person), `KinOps` (alerts and budget), `KinNetwork`, `KinData` and `KinCi`, in `infra/`. Compute, the load balancer and the Fargate services, follows when the apps have images. Aurora's capacity is `kin:databaseCapacityAcu` in `cdk.json`: a minimum of 0 lets it pause while nobody is using it, and it is raised above zero for judging.

---

## 15. Security

### 15.1 Threats and controls

| Threat                                              | Control                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A family member drains the pool**           | Payments only to approved payees and members. Limits from the agreement. Second approval above a threshold. No self-approval. Every change announced to the whole circle. |
| **An account is taken over**                  | Passwordless sign-in, multi-factor authentication, a fresh check for payouts, alerts on new devices.                                                                      |
| **A stranger pressures the parent**           | New payees need a family member. The claim check. Alerts on unusual requests.                                                                                             |
| **Someone impersonates the parent on a call** | Registered number plus spoken phrase or PIN. Lockout after three failures. Voice approvals capped at the parent's threshold.                                              |
| **A caregiver over-bills**                    | Bills checked against the visit pattern and usual amounts. Organizer approval on every caregiver bill.                                                                    |
| **A forged webhook**                          | Signature verification and reading the resource back from PayPal.                                                                                                         |
| **A replayed request**                        | Idempotency keys at every layer.                                                                                                                                          |
| **A malicious document**                      | Extraction has no tools. Document text is data.                                                                                                                           |
| **One family reads another's data**           | Circle checks in the service and row-level security in the database.                                                                                                      |
| **A credential leaks**                        | Secrets only in Secrets Manager. Each service has its own minimal IAM role. Keys are rotated.                                                                             |
| **The merchant charges the wrong amount**     | The approved total is bound into the signed instruction and checked on confirmation.                                                                                      |

### 15.2 Data protection

- **In transit:** TLS everywhere.
- **At rest:** KMS encryption in Aurora and S3.
- **Minimal data:** financial records and documents only. No medical records.
- **Logs:** no tokens, no credentials, no document contents. Personal details are masked.
- **Model calls:** only the fields needed for the task are sent.
- **Retention:** documents and recordings are kept only as long as the circle's policy and the law require.
- **Call recordings are off by default.** Only the text of approvals is kept.

### 15.3 The pause switch

Any member can pause the circle. For 24 hours no proposal is approved and no execution is submitted. Movements already submitted to PayPal continue to be tracked. Every member is told who paused it and why.

---

## 16. Reliability and failure handling

| Failure                                           | What Kin does                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **PayPal call times out**                   | Marks the execution unknown, queries PayPal by idempotency key, waits for the webhook. Never assumes.                    |
| **PayPal declines a payment**               | Marks the execution failed with PayPal's reason. Tells the organizer in plain words.                                     |
| **A webhook is missed**                     | Nightly reconciliation finds and applies it.                                                                             |
| **A webhook arrives twice or out of order** | Duplicate IDs are ignored. State machines only move forward.                                                             |
| **A payout is unclaimed**                   | Money stays in clearing. The recipient is told how to claim.                                                             |
| **Claude is unavailable**                   | Reading and conversation pause. Scheduled payments, webhooks and the ledger continue. Narration falls back to templates. |
| **The speech provider is unavailable**      | The parent receives a text or email instead. In-app use continues on screen.                                             |
| **A call drops mid-approval**               | No approval is recorded unless the confirmation was heard. Kin calls back.                                               |
| **The merchant is unavailable**             | The purchase stays approved and is retried. The parent is told of the delay.                                             |
| **A worker crashes mid-job**                | The message returns to the queue. Idempotency makes the retry safe.                                                      |
| **A message keeps failing**                 | It moves to the dead-letter queue and raises an alarm.                                                                   |
| **The database is briefly unavailable**     | Web returns a clear error. Webhooks are not acknowledged, so PayPal retries them.                                        |
| **A deployment goes wrong**                 | Rolling deployment with health checks rolls back automatically.                                                          |

**The governing rule:** when Kin is unsure whether money moved, it stops, finds out from PayPal and tells a person. It never guesses and never retries blindly.

---

## 17. Observability and audit

### 17.1 Logs, metrics and alarms

- **Structured logs** from every service, each line tagged with the circle, the proposal, the execution and PayPal's debug ID.
- **A correlation ID** follows one piece of work from the first request through every queue and service.

| Metric                      | Why                              |
| --------------------------- | -------------------------------- |
| Webhook processing delay    | Shows how current the ledger is  |
| Executions by outcome       | Shows payments are succeeding    |
| Executions in unknown state | Should be near zero              |
| Dead-letter queue depth     | Should be zero                   |
| Reconciliation differences  | Should be zero                   |
| Time to first spoken word   | The voice experience             |
| Number guard rejections     | Shows how often the model strays |
| Extraction confidence       | Shows document reading quality   |
| Model cost per circle       | Keeps running costs known        |

**Alarms** on any dead-lettered message, any reconciliation difference, any execution unknown for more than a few minutes, and any failed deployment.

### 17.2 The audit trail

The audit trail is a product feature as well as an operational one. For any movement of money, Kin can show:

1. What caused it: the bill, receipt or settlement.
2. The document behind it, as photographed.
3. Who proposed it.
4. Who approved it, how and when, with the evidence.
5. The request sent to PayPal and its identifier.
6. The PayPal event that confirmed it.
7. The ledger entry it produced.

The audit export assembles these into one dated record per movement.

---

## 18. Performance and scale

**For the hackathon,** load is a handful of demo circles and occasional judge visits. The architecture is sized well above that.

**Where it would be stressed first, and the answer**

| Pressure                   | Answer                                                                    |
| -------------------------- | ------------------------------------------------------------------------- |
| Many simultaneous calls    | The voice service scales by adding tasks. Sessions are independent.       |
| Bursts of webhooks         | Intake only stores and queues. Workers scale on queue depth.              |
| Month-end for many circles | Settlements are spread by timezone and processed per circle from a queue. |
| Database load              | Aurora scales capacity automatically. Reads can move to a replica.        |
| Model cost and latency     | Cached prompts, small snapshots, low effort for speech.                   |

**The ledger grows forever by design.** Balances are computed from entries, with periodic checkpoints so that reading a current balance does not require scanning all history.

---

## 19. Testing

| Level                 | What is tested                                                        | How                                                           |
| --------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Domain**      | Ledger invariants, fairness, rounding, state machines, approval rules | Unit tests and property-based tests. No database, no network. |
| **Adapters**    | PayPal mapping, webhook verification, event handling                  | Tests against recorded PayPal responses                       |
| **Integration** | A full flow through the database and queues                           | A real PostgreSQL and a fake PayPal                           |
| **Sandbox**     | Real calls to the PayPal sandbox                                      | Run on demand and before release                              |
| **Negative**    | Declines, failures and reversals                                      | PayPal's negative testing and the webhook simulator           |
| **End to end**  | The main journeys in a browser                                        | Playwright                                                    |
| **AI**          | Extraction, claims and conversations                                  | The three fixed test sets in section 9.8                      |
| **Voice**       | Spoken flows                                                          | Recorded audio played into the voice service                  |
| **Security**    | Isolation between circles                                             | Tests that try to read another circle's data and must fail    |

**Properties the domain tests assert for any input**

- Every ledger entry balances.
- Fairness targets always total the contributions exactly.
- A settlement never proposes paying out more than the pool holds.
- Applying the same event twice changes nothing.
- No sequence of events can move a record backwards.

---

## 20. Environments, deployment and demo mode

### 20.1 Environments

| Environment     | Purpose                                                                    | PayPal                   |
| --------------- | -------------------------------------------------------------------------- | ------------------------ |
| **Local** | Development. PostgreSQL and an SQS stand-in (ElasticMQ, `pnpm queue:up`) in containers. No webhook reaches the machine; the worker confirms a top-up by reading the order back | Sandbox                  |
| **Test**  | Automated tests in continuous integration                                  | Fake, plus the simulator |
| **Demo**  | The hosted environment judges use                                          | Sandbox                  |

### 20.2 Deployment

1. A pull request runs CI in GitHub Actions: lint, type-check, unit tests, the end-to-end and responsive tests, the infrastructure synth, and a build and start of the web image.
2. A merge to main runs CI again on the merged code.
3. When CI passes, the Deploy workflow (`.github/workflows/deploy.yml`) checks out that same commit and deploys every stack except KinGuardrails with the CDK.
4. KinWeb's deploy builds the web image, pushes it to ECR, and App Runner rolls to it with its health check. KinWorker, which exists once `kin:paypal` switches top-ups on, is deployed in the same step: its image is built for Arm and its one task is replaced, the old one stopped before the new one starts.
5. A smoke test (`pnpm --filter @kin/infra run smoke`) checks the live app from outside: pages load, the circle's screens need a session, and sign-in reaches Cognito and returns to the right address.
6. Between deploying KinData and KinWeb, the workflow runs the migration task (`pnpm --filter @kin/infra run migrate`) and stops if it fails, so the web app never meets a schema older than its code. KinWeb reaches Aurora through an App Runner VPC connector in the services subnets.

GitHub signs in to AWS through OpenID Connect, and AWS trusts only this repository's main branch. No AWS keys are stored in GitHub. The Deploy workflow can also be started by hand from main.

### 20.3 Demo mode

The hackathon needs a month of family life to be shown in minutes.

- **Seeded data.** One complete circle, copied for each visitor: Rose, Elena, Marcus, Ana, Amara and Daniel, the family's lawyer, so every role is there to try.
- **A demo clock.** The current date is supplied by a clock that the demo environment can move forward. Settlement and schedules follow it. In every other environment it is the real time. A demo circle's clock is the moment its visitor pressed the Demo button (decision 49).
- **Simulated billing cycles.** PayPal's sandbox bills subscriptions in real time. To show several months, the demo replays subscription payment events through the normal webhook path.
- **Honest labelling.** Anything simulated is marked as simulated in the interface and in the ledger entry. Real sandbox transactions and simulated ones are never presented as the same thing.
- **Reset.** *Start again* in the demo banner, or `pnpm --filter @kin/db run demo:reset -- <visitor-id>`, gives a visitor a fresh circle. Without an ID the command adds a circle nobody can open, which is enough to look at the data locally.
- **Where it runs.** The demo is served by App Runner at https://mzdg4f3stk.us-east-1.awsapprunner.com (decision 35). The address is fixed for the life of the `kin-web` service, and it is listed in `kin:webOrigins` so Cognito returns to it.
- **The Demo button, and only the Demo button, opens demo data.** It is on the home page, the site header and the start page (`startDemo` in `apps/web/src/server/demo-actions.ts`). Pressing it creates an anonymous visitor: a `users` row of kind `demo_visitor` whose ID starts `demo:`, so every press can be counted with no account and no personal details. The visitor's session is a token signed with a key from Secrets Manager (`issueDemoSession` in `packages/auth`), in an httpOnly `__Host-` cookie that lasts 14 days. The visitor gets their own copy of Rose's circle (`provisionDemoCircle` in `packages/db`), isolated from every other by row-level security, so one judge's actions never show up in another's. The demo clock is the circle's own (`circles.clock_at`): the moment the visitor pressed the button. Rose's month is written once around the evening of 30 October 2026, and each copy is moved to end at the press (`demoTime` in `packages/db`): every moment moves by the same span, every date by the same number of days in the circle's timezone, and the month's entries count toward the period open on the new clock, so it settles as one month whatever the day. The clock then stays where it was set, so nothing in a visitor's copy expires while they explore it; *Start again* sets it to the new moment. Tests press at the template's own clock, so their dates never depend on the day they run.
- **Demo and real never mix.** A database trigger seats demo visitors only in demo circles and people who signed in only in real ones. A person who signs in sees their own circles, joins any real circle that invited their verified address, and otherwise is offered to start one (`kin_private.create_circle`): they become its organizer and the parent its first member. Every screen of a circle with no data yet says so in plain words.
- **Every role, from one seat.** The demo banner's role switcher moves the visitor into another persona's empty seat (`kin_private.take_demo_seat`), so the database then shows exactly what that role may see: a caregiver only their own pay, an observer everything and no buttons.
- **Real operations on simulated money.** In the demo a visitor approves and declines proposals (the vote is recorded in their seat and role, and the approval engine decides), pauses and lifts the pause, invites someone, downloads the record as CSV, starts again and leaves. Approving a caregiver payout moves it to approved, and the worker then pays it as a simulated payout, labelled so in the record. In a real circle, a yes goes through the fresh multi-factor check of section 12.1, and the payout goes through PayPal's sandbox.
- **Real sandbox top-ups.** "Add money" works in the demo with a PayPal sandbox buyer account. The circle's history stays simulated; the top-up is a real sandbox transaction, recorded with `simulated` false and tagged "PayPal sandbox" in the record and the activity list, never presented as the same thing as the simulated entries around it.
- **Start again** archives the visitor's circle and gives them a fresh one; *Leave the demo* clears the visitor's cookie. Nothing is deleted: the old circle's ledger stays.
- **What each person sees.** The circle-role check of section 12.3 (`authorize` in `packages/auth`) decides which screens a role may open, and a role refused a screen is sent to its first one.

---

## 21. Decision record

| #  | Decision                                                    | Alternatives considered                    | Reason                                                                                      |
| -- | ----------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1  | Double-entry, append-only ledger                            | A table of balances                        | Auditability is the product. Balances alone cannot explain themselves.                      |
| 2  | Webhooks plus read-back as the source of truth              | Trusting API responses                     | A response can be lost. The event and the resource cannot both lie.                         |
| 3  | The agent proposes and never executes                       | Giving the model PayPal's write tools      | A parent's money cannot depend on a model's judgment.                                       |
| 4  | Number guard on all money language                          | Trusting the model's wording               | One wrong spoken amount would destroy trust.                                                |
| 5  | Three services                                              | One service, or many                       | Voice and execution have different lifetimes from web. More would add cost without benefit. |
| 6  | One PayPal account per circle, owned by the family          | One Kin account with internal sub-balances | Kin must not hold customers' money.                                                         |
| 7  | Caregivers paid by payout                                   | PayPal invoice from the caregiver          | PayPal offers no API for paying a received invoice.                                         |
| 8  | Saved payment method at the merchant for purchases          | Parent approves in PayPal each time        | A parent with low vision cannot sign in to PayPal by voice.                                 |
| 9  | Per-circle roles in the database, not in Cognito            | Cognito groups for everything              | One person holds different roles in different circles.                                      |
| 10 | Row-level security as well as service checks                | Service checks only                        | A single coding mistake must not expose a family.                                           |
| 11 | SQS with per-circle ordering                                | Unordered processing with locks            | Simpler and removes a class of race conditions.                                             |
| 12 | Phone calls as the parent's main channel                    | App notifications only                     | Works on any phone and needs no skill.                                                      |
| 13 | Members credited gross, fees shared                         | Members credited net                       | A member should not be penalized for PayPal's fee.                                          |
| 14 | Care hours reduce cash owed and are not paid out by default | Always pay care hours in cash              | Avoids turning family care into wages unless the family chooses that.                       |
| 15 | Public pages live in the web app, prerendered, under a language segment | A separate marketing site | One design system and one deployment. Static pages cost nothing at request time. |
| 16 | Languages by dictionary files and a proxy rewrite, with English unprefixed | An internationalization library | Seven static dictionaries and one routing function need no dependency. A test keeps every translation in step with English. |
| 17 | Theme by an attribute on the root element, set by an inline script | A theme library | A few lines of our own code, no flash of the wrong theme, and pages stay static. |
| 18 | Example money on public pages comes from one data module and the shared formatter | Amounts written into the copy | The figures shown and the figures spoken cannot drift apart, and a test checks every language. |
| 19 | Care credit balanced against a `care_received` memo account | Care credit outside the ledger | Every entry balances, including memo entries, and care hours share the ledger's audit trail without ever touching cash. |
| 20 | A short pool is shared among payouts pro rata | First come, first paid | No member's payout depends on the order of a list. |
| 21 | The site's settlement figures are calculated from Rose's month in `packages/domain` | Figures written into the example data | The page can show only what the money core produces. |
| 22 | Property tests use a small seeded generator in `packages/domain` | A property-testing library | No new dependency for the first slice. Failures name the seed. A library with shrinking is worth proposing when inputs grow. |
| 23 | Kin's own resources in a shared AWS account, with an explicit deny for the other projects | Partitions inside wick's table, bucket and user pool | Wick's roles hold table-wide and account-wide permissions, so a key prefix would isolate nothing. Separate idle resources cost nothing extra. |
| 24 | A CDK bootstrap of Kin's own, qualifier `kin` | The account's default bootstrap, used by Hold | Kin's assets and deploy roles stay apart from Hold's, and Kin's CI role can reach only Kin's. |
| 25 | Settlement payouts are bounded by pool cash less unpaid bills | Bounded by pool cash alone | A settlement must not spend money already owed to Amara or a biller. |
| 26 | Payout fees are posted to `fees` and reserved before a settlement releases payouts | Ignoring payout fees | The sandbox charged the pool 0.25 to send a payout. Unposted, the ledger's pool runs ahead of PayPal's; unreserved, paying everyone in full could overdraw the pool. |
| 27 | One no from a member who could approve rejects a proposal | Majority or organizer-only rejection | Uncertain means stop. A sibling who objects to a payment from their parent's money should halt it, not be outvoted. |
| 28 | Proposals expire after 72 hours | No expiry, or a per-circle setting | A stale approval should not pay a bill whose facts may have changed. One fixed window needs no configuration until a family asks for another. |
| 29 | A pause holds a request above the ceiling as paused, not refused | Refusing it at once | The pause is rule 1. A held request is planned again when the pause lifts and refused then. |
| 30 | The web session is Cognito's own tokens in httpOnly, secure, same-site cookies, verified with `aws-jwt-verify` in the proxy and again in every page | A session of Kin's own, signed with a server secret | No session store and no signing secret to manage. Every check is the same check the API will make. Every cookie is `__Host-`, so no other subdomain can plant one; `/auth/sign-out` also refuses a request from another origin. |
| 31 | Sign-in through Cognito managed login, authorization code with PKCE, state and nonce | Kin's own sign-in form against the Cognito API | Kin hosts no credential form (tech-stack section 9.1). PKCE lets a public client with no secret trade the code safely. |
| 32 | End-to-end tests sign in against a local stand-in for Cognito | A test user in the real pool, or a test-only bypass | The tests run the real flow and the real token checks with no switch in the app. The stand-in signs with its own key and lives only in `apps/web/e2e`. |
| 33 | AG Grid Community for the ledger | AG Grid Enterprise on a trial key | The ledger needs sorting, selection and keyboard use, all in Community. An evaluation key would lapse on 13 November 2026, before judging, and may not be used in production. |
| 34 | Cognito's email goes through a custom sender that sends from a Gmail account, switched on by a deploy-time setting (`KIN_SENDER_EMAIL`) | Amazon SES; Cognito's own sender | Cognito sends sign-in codes only through SES or a custom sender. SES production access was refused on 15 October 2026, and the project has no domain. Gmail signs what it sends, so codes pass the recipient's sender checks. A password stays possible if Gmail fails. |
| 35 | The web app runs on AWS App Runner (`KinWeb`), from the image in `apps/web/Dockerfile` | ECS Fargate behind a load balancer and CloudFront, as section 14 draws it | Cognito returns only to https addresses, and Kin has no domain for a certificate. App Runner serves https at its own address with no load balancer, for a fraction of the cost. The image runs the same production build the end-to-end tests run. Voice and worker still plan for Fargate. |
| 36 | Cognito's managed pages are branded as code: settings and SVG files in `CfnManagedLoginBranding` | Kin's own sign-in and sign-up screens against the Cognito API; Cognito's default style | The project owner chose to keep Cognito's pages, so Kin still hosts no credential form (decision 31). Branding as code is reviewed and deployed like the rest, and every image comes from the same knot geometry as the app's logo. Cognito serves the SVG files unchanged, so their CSS animations run. |
| 37 | Drizzle ORM over node-postgres, with row-level security, roles, triggers and grants in a hand-written SQL migration | Prisma; raw SQL with no library | Row types are inferred from one schema (AGENTS.md section 4). Drizzle adds no engine binary to the images. Access rules stay in plain SQL where a reviewer can read them, and tests check them in a real PostgreSQL 17.9, the engine Aurora runs. |
| 38 | Each visitor of the demo gets their own copy of Rose's circle, made by a provisioner role that can only add rows to a circle created in its own transaction and can read nothing | One shared seeded circle for everyone; seeding with the service role from the web app | Judges act at the same time, so a shared circle would show one judge another's changes. The web app never holds the service role. A compromised web server can create demo circles but cannot read or write any existing family's. |
| 39 | A proposal shows the approval plan stored when it was raised | Recomputing the plan from the current agreement on every view | The plan made when a proposal is raised is what governs it, even if the agreement later changes. A caregiver, who may not read the agreement, can still see who must say yes to their own pay. The stored plan is parsed and checked on the way out. |
| 40 | Database migrations run as a one-off Fargate task between KinData and KinWeb in the deploy workflow | A Lambda function triggered by the deployment; migrating from the web app on start | Section 14.4's design. The account's Lambda quota is small. The web app must not hold the admin's password. |
| 41 | Demo data only behind the Demo button, for an anonymous visitor with a signed session of Kin's own | Giving every signed-in person a demo circle; a demo that needs an account | Judges reach the demo in one click with no account, and a real account never shows example data. The session names only a `demo:` visitor, whom the database seats only in demo circles, so even a stolen or forged session cannot open a family's circle. Each press is a row Kin can count. |
| 42 | A person's writes go through kin_app with row-level security, column grants and database guards; the decision is the approval engine's | Writing votes and states through the service role from the web app; deciding approvals in SQL | The web app never holds the service role (decision 38), and the rule stays in one place (`decideApprovals`). The database still refuses, from the plan stored with the proposal, an approval with fewer yeses than places, with a no, or with only the payee's yes; a move other than closing a pending proposal; an answer in another member's name or role; any person's answer or decision in a real circle; and a pause longer than 24 hours. |
| 43 | Aurora stays at zero minimum capacity, and the first request after a pause waits for it to resume | 0.5 ACU minimum so it never pauses, about $44 a month | The project owner chose no standing cost. The first visitor after a quiet spell waits over a minute; everyone after them does not. The migration retries for up to five minutes, because the first deploy's migration failed at 30 seconds while Aurora resumed. |
| 44 | PayPal's webhook is handed, raw, to a FIFO queue by the web app; the worker stores it, verifies it with PayPal and reads the resource back | The web app storing the event in Aurora before queueing it (section 8.7's first design); the web app applying it | The web app holds no service role (decision 38), and a new narrow database role for the web would weaken that line. SQS holds the delivery durably before PayPal hears 200. Long polling keeps the worker off the database while idle, so Aurora still pauses (decision 43). |
| 45 | The worker is one Fargate task (Arm, 0.25 vCPU, 0.5 GB) long-polling SQS | An SQS-triggered Lambda; a second App Runner service; a scheduled task | The account allows Kin one Lambda function (decision 40), which Cognito's sender uses. App Runner throttles a service's CPU between requests, so it cannot poll. A scheduled task would confirm a top-up minutes late. About seven dollars a month. The work is one function (`handleInboxMessage`), so moving it to another runtime changes only `apps/worker/src/main.ts`. |
| 46 | Every circle's pool is the one sandbox business account, with the circle and member in each order's `custom_id`, reached through `poolFor` | A `pool_accounts` table with credentials per circle | A demo circle is made for every visitor, and the sandbox cannot make a business account for each. PayPal's record still attributes every payment to one circle and member. Production's partner model (section 8.1) changes only `poolFor`. |
| 47 | A top-up is recorded from the order or capture read back from PayPal; the capture's ID is the ledger entry's source | Waiting for the webhook alone; trusting the capture's response | AGENTS.md section 5, rule 3. Either path alone records the money, and together they write one entry: the read after capture confirms in seconds and works where no webhook arrives (locally), and the webhook covers a lost read. |
| 48 | The PayPal client ID and webhook ID are in `infra/cdk.json`; the client secret is in Secrets Manager | All three in Secrets Manager | The two IDs are not secret (PayPal's client ID is meant for the browser). In `cdk.json` they are reviewed like any other change, and the deploy needs no extra CI secret. |
| 49 | A demo circle's clock is the moment its visitor pressed the Demo button, with Rose's month moved to end there | One fixed evening, 30 October 2026, for every visitor; the real time, moving on | A judge sees today's date, and a real sandbox top-up lands on the same day as the story around it. A clock that stood still at a fixed date read as stale. One that moved on would expire the waiting proposals after 72 hours of exploring. The month counts toward the period open on the clock, even where its first days fall in the month before, so the story settles as one month. |
| 50 | A caregiver rate belongs to their payee; each submitted bill keeps a versioned snapshot of service days, rate and currency, entered through narrow database operations | Reusing relatives' care-credit rate; free-text bill amounts; new timesheet tables | Paid caregiver work is distinct from family fairness credits. The domain values each service day with the existing integer care arithmetic, and the bill retains the rate it used. Member and payee locks serialize setup, rate changes and duplicate service dates. The web identity gains no direct writes to payees or bills and cannot use submission as payment approval. Approved in `docs/superpowers/specs/2026-10-22-caregiver-billing-design.md`. |
| 51 | A yes to real money is a fresh Cognito sign-in at level 4 (`acr_values`, `max_age=0`), accepted only if the token's `amr` has `mfa` and `auth_time` is under five minutes old; the yes is recorded by the callback itself | Trusting `auth_time` alone; a Kin-sent email code; a short-lived grant cookie | Cognito states which methods a sign-in used. An email code is the same factor that signs people in. Recording the answer in the callback leaves nothing to replay. Without the claims, the answer is refused. |
| 52 | A structured caregiver bill moves `received → ready → proposed` when an organizer or contributor sends it, or `received → rejected` when they decline it | Walking it through `extracted`, which records an extraction that never happened | Its details were entered and checked as structure. Declining frees its service days for a corrected bill. The database checks the plan it is given against the agreement in force, so a forged plan cannot ask for fewer yeses. |
| 53 | The worker leases payout messages from the outbox table (`claim_outbox`) | An SQS `executions` queue fed from the outbox | One table is the queue, written in the approval's own transaction; no new service. The lease and the execution's row lock keep two workers off one payout, and the idempotency key keeps PayPal from paying twice. |
| 54 | A payout writes no `pool_clearing` entry while PayPal holds it; the payable from the family's approval holds the money back until PayPal's item reads `SUCCESS` | Moving the money to `pool_clearing` on submission | The ledger records money as moved only on PayPal's record (rule 3), and the payable already keeps that money from any other payout (rule 8). |
| 55 | A lost reply is recovered by sending the payout again with the same batch ID and reading the batch PayPal links | Searching recent payouts | PayPal's sandbox refused a repeated `sender_batch_id` with 400 and linked the original batch, even with the same `PayPal-Request-Id` (seen on 26 October 2026). Kin follows the link only when the batch it reads back carries the execution's own key and amount. |
| 56 | Only the caregiver records where their own pay goes, and it is fixed from the moment a payment to them is raised until it is finished | The organizer recording it with the rate (built first in migration 0008, replaced by 0009) | An organizer who could set the address could send approved pay to themselves, and an address that could change after the family saw it would make their approval meaningless. A first address can still be added while a payment waits: it redirects nothing. The address is also fixed on the execution when the approval queues it (or, if the caregiver had none yet, by the worker before anything is sent), and the database refuses to repoint it, so not even a retry after a failure can follow a changed address (migration 0010). Verifying the address through Log in with PayPal (section 12.2) is not built. |
| 57 | A version of the agreement governs from its start date once every member it asks has accepted it: every organizer and contributor, and a parent who decides and can sign in, fixed on the version when it is proposed. The organizer proposes, accepting by proposing; only the newest version can be accepted | A status column set when the last acceptance arrives; asking only the members the new version gives a share (built first, and replaced by migration 0012 after a security review: an organizer could write themselves the only share and be the only one asked) | Versions are never changed, so their acceptances, not a flag, say whether they govern, and the list of who must accept is fixed with them, so later joiners and leavers cannot change it. A parent who cannot sign in may still accept by voice once that exists, but cannot block the family until then. The rule is `agreementStanding` in `packages/domain`, mirrored by `kin_private.agreement_in_force`, which `send_caregiver_bill` uses; a test runs both. Caregiver payouts are planned against the version in force, never a proposal. |
| 58 | Claude is reached through Amazon Bedrock's Messages endpoint (`@anthropic-ai/bedrock-sdk`, `AnthropicBedrockMantle`, model `anthropic.claude-opus-5-5`), configured by `KIN_BEDROCK_REGION` and `KIN_BEDROCK_MODEL` | Anthropic's API directly (`docs/tech-stack.md` section 6 recommended it) | The project owner runs Anthropic's models on Bedrock (26 October 2026). Kin's AWS credentials and IAM reach the model, so no Anthropic key is stored. Refusal fallbacks would use the SDK's client-side middleware on Bedrock; none is configured yet, because the account's entitlements decide which model it could fall back to. |
| 59 | In-app speech uses Amazon Transcribe streaming and Amazon Polly; the browser records a short clip, converts it to 16 kHz PCM and uploads it, and the server transcribes it | Deepgram and ElevenLabs (`tech-stack.md` section 7); the browser's own speech APIs; streaming the microphone over a WebSocket to `apps/voice` | The owner chose AWS (27 October 2026): one account and bill with Bedrock, no new vendor keys. A clip of at most a minute suits a bill and a yes, needs no long-lived connection (App Runner serves plain HTTP), and keeps every decision on the server. Live streaming belongs to the phone line, still to build. |
| 60 | Claude in the hosted app is switched on by `kin:claude` and stays on Opus 5.5 through Bedrock's Messages endpoint; while the account is refused that model, the switch stays off | An older model through Bedrock's InvokeModel API; Anthropic's API directly | Bedrock refuses every model its Messages endpoint serves to this account; the older models answer only through InvokeModel, which refuses the SDK's current API version, so using them would pin an old SDK beside a second adapter. Anthropic's API would undo decision 58. Waiting on AWS keeps one adapter and makes switching on a one-line change. |
| 61 | A member's monthly share is a PayPal subscription with its own plan, made by the web app and recorded in `monthly_shares`; a person changes it only through two database operations (`start_my_share`, `move_my_share`), PayPal is asked before the record moves, and the worker records charges from PayPal's transaction listing | One plan for every member with a quantity; a PayPal invoice each month; writing the share and its ledger entry from the web app | A plan per share is the only way to charge an exact amount and keep each member's commitment separate (section 8.4). Reading the listing, not the webhook body, keeps rule 3 (PayPal's record decides) the same for charges as for top-ups, and a sale event that names no circle is placed by asking PayPal. The web app holds no service role (decision 38), so it cannot write the ledger. |
| 62 | Refills are proposed from a family-set rule (`purchase_rules`: one approved seller, one item, a limit for each purchase, a budget for the month), checked by plain code (`checkPurchase`) and again by the database, and are bought in demo circles only, as simulated purchases through the outbox and worker | A model that composes carts; a real circle's purchase charged to a saved wallet before any screen can save one | Section 8.6's finding and cart are the design, but a real circle needs a saved PayPal wallet and a fresh multi-factor yes, and neither is built (decision 60). The rule bounds what Kin may propose, the approval engine still decides who says yes, and no model touches an amount. The demo shows the whole path; a real circle's refill is refused when proposed and, if one ever reached the worker, marked failed with nothing taken. |
| 63 | A letter Kin reads is kept as its reading, not as a file, and a claim check is recorded with the words spoken to each member, both through narrow database operations (`add_letter`, `record_claim_check`) | An S3 bucket and a documents queue (section 9.4's design); the web role writing documents and checks directly | The project owner had no bucket to provision for this milestone, and a photograph is not needed once its checked reading is stored. The web app holds no write grant on the document, bill or claim tables, as with caregiver billing (decision 50). The documents table now accepts a reading in place of a storage key |
| 64 | The parent's standing permission is a mandate (`mandates`, `mandate_uses`): one refill rule, a limit for each purchase and for each month, a cadence and two dates, granted through `grant_mandate`, sealed with a SHA-256 digest the database computes, and changed only by pausing, resuming or ending it. A refill that fits a live mandate (`checkMandate` in `packages/domain`, asserted again inside `propose_refill`) is approved in the same transaction with the mandate recorded as the approver (approval method `mandate`, plan outcome `mandate`) and then runs through the ordinary outbox and worker path; one that does not fit falls back to asking, with the reason | Approving under the parent's own name with method `voice`; a mandate that covers any purchase of a category; an agent tool that decides whether a cart fits | The approval moves from each purchase to the permission without weakening: the fit is plain code, every limit is hard (the agreement's ceiling bounds it, one purchase can never exceed the month), and the record names the mandate, the grantor and who recorded it. A distinct method keeps the audit honest, and a person cannot label their own answer as a mandate's (policy `app_answer`). Voice capture and the compile of speech into the mandate schema are not built: in the demo the organizer plays the parent's spoken yes and the row says simulated; in a real circle only the parent can grant. The simulated seller refuses a charge above the mandate's allowance, a second enforcement point beside the first. |
| 65 | The what-if simulator (`simulateScenario` in `packages/domain`) rehearses a hypothetical agreement and a dry-run month by calling `settlePeriod` and `planApprovals` on a copy of the circle's state, and the screen reads the what-if from the address (a GET form), saving and proposing nothing | A compiled policy schema with stored versions; a POST route with its own table; a second implementation of the rules for previews | A second copy of a rule would drift from the real one, so the simulator can only call it. Read-only needs no table or policy, and it is open to the roles that already see the circle's money (`money.view`). The policy compiler, the agent tool, forecasts and voice phrasing in `feature-proposals.md` section 4 are not built. |

---

## 22. Risks, assumptions and open questions

### 22.1 Assumptions the design depends on

- A sandbox business account can receive subscriptions, send payouts and act as a payer with a saved wallet at a merchant.
- Payouts and saved payment methods can be enabled on the sandbox accounts used.
- The telephony and speech providers support streaming in both directions.

Each should be confirmed on day one. Section 8.6 gives the fallback if the pool cannot act as a payer. The first two were confirmed in the PayPal sandbox on 14 October 2026 (section 23); the telephony and speech assumption is still open.

### 22.2 Open questions

| Question                                                      | Why it matters                                                                                                                                                                     | Affects the hackathon           |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| **How does Kin act on a family's real PayPal account?** | Holding a family's API credentials is not acceptable in production. PayPal's partner model is the likely answer and needs PayPal's approval.                                       | No                              |
| **What do PayPal's fees do to the pool?**               | A business account pays fees on money received. Contributions would lose a percentage on the way in. This affects the product's economics and possibly the choice of account type. | No, but judges may ask          |
| **Who legally owns the pool account?**                  | Tax, liability and PayPal's own account rules.                                                                                                                                     | No                              |
| **Which merchants will accept agent purchases?**        | Saving a wallet for merchant-initiated charges needs PayPal's approval of the merchant.                                                                                            | No, the demo merchant covers it |
| **Does Log in with PayPal fit Cognito federation?**     | Decides whether sign-in with PayPal is offered.                                                                                                                                    | No, it is optional              |
| **How are subscriptions shown over several months?**    | The sandbox bills in real time.                                                                                                                                                    | Yes, answered by demo mode      |
| **What is the shortest sandbox billing cycle?**         | Decides how much can be shown with real sandbox billing.                                                                                                                           | Yes, to confirm                 |

### 22.3 Risks

| Risk                                               | Likelihood | Effect                      | Mitigation                                                                                                                                    |
| -------------------------------------------------- | ---------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Voice latency feels slow                           | Medium     | Weakens the central demo    | Measure early. Streaming, low effort, short context, and a faster model for speech if needed.                                                 |
| Document reading is unreliable on poor photographs | Medium     | Wrong bills                 | Confidence thresholds, guided retakes and human review.                                                                                       |
| A sandbox feature is unavailable                   | Medium     | A flow cannot be shown live | Day-one trials and the fallbacks in section 8.                                                                                                |
| The demo environment fails during judging          | Low        | Judges cannot test          | Alarms, automatic rollback, a reset script and a recorded walkthrough.                                                                        |
| The scope is large                                 | High       | Unfinished parts            | The money core, one contribution path, caregiver payout, the claim check and settlement form the essential spine. Everything else can follow. |

---

## 23. How certain each part is

**Checked against PayPal's documentation during this work**

- Webhook event names.
- Webhook signature verification, its headers and PayPal's retry behavior.
- The payout endpoints.
- Saving a PayPal wallet for merchant-initiated payments, its steps and its eligibility conditions.
- The JavaScript SDK v6 setup and its one-time and Pay Later payment sessions.
- Log in with PayPal's endpoints and its configuration.
- The Agent Toolkit's tool list and the sandbox MCP server address.

**Written from general knowledge and to be confirmed**

- Details of the payout request, its statuses and its duplicate-detection window.
- The delay and date-range limits of Transaction Search.
- Whether JavaScript SDK v6 offers subscription and save-payment sessions. The design does not depend on either.
- That a PayPal account has no API for paying an invoice it has received. This is the basis of the first correction in section 8.3.
- AWS specifics: load balancer timeouts for live audio, Aurora's pause behavior and Cognito's sign-in options.
- The streaming capabilities of the speech and telephony providers.

**Checked against the PayPal sandbox on 14 October 2026** (`pnpm --filter @kin/paypal run sandbox:check`)

- The pool's sandbox business account sends payouts. A 1.00 payout to a personal sandbox account reached `SUCCESS` within a minute, read back from PayPal, and PayPal charged the sender a 0.25 fee.
- It takes subscriptions. A subscription stays `APPROVAL_PENDING` until a payer approves it in a browser, then turns `ACTIVE` and is billed at once: a 1.00 monthly plan approved by a personal sandbox account took 1.00 gross, a 0.52 fee and 0.48 net, which is why members are credited gross (decision 13).
- It creates vault setup tokens for a PayPal wallet with merchant usage. A token stays `PAYER_ACTION_REQUIRED` until the payer approves it.
- Its app holds the payouts, subscriptions, invoicing and vault scopes. Reporting was still missing shortly after Transaction Search was switched on, so the Balances and Transaction Search APIs answered 403.
- A separate merchant app, the demo pharmacy's, saves a PayPal wallet with merchant usage and charges it with nobody signing in: after one approval, an order carrying only the saved wallet's ID was created and captured `COMPLETED` in a single call (1.00 gross, 0.52 fee). The approval page showed an error after approving, but the setup token read back `APPROVED`.
- The pool's business account can be that payer. It approved once as a `BUSINESS` customer, and the pharmacy then charged its saved wallet 1.00 with nobody signing in, captured `COMPLETED`. Section 8.6's fallback is not needed.

**Built and tested**

- The ledger, the fairness calculation and settlement planning in sections 7.1 to 7.3, in `packages/domain`, with unit and property tests. Rose's month from the project description is a fixture there, and the public site's settlement figures are calculated from it.
- The proposal, bill and execution state machines in section 7.4 and the approval engine in section 7.5, in `packages/domain`, with unit and property tests. The tests pin the transitions drawn in this document.

- The database in sections 6.3 and 12.3, in `packages/db`: the schema, the migrations, the three roles and row-level security, the append-only and balancing triggers, the state-machine guard, the ledger store and the demo provisioner. Tested against a real PostgreSQL 17.9 in Docker: isolation between circles on every table, each role's limits (caregiver and observer first), the provisioner's and the service's bounds, the money rules, and a property test that any ledger the money core builds is read back exactly.
- The circle-role check (`authorize` in `packages/auth`), and the dashboard reading a visitor's own provisioned circle as that visitor, through every screen at the four viewports (unit and end-to-end tests against a migrated database).
- The Demo button and the anonymous visitor's signed session, the role switcher (every role's screens), answering, pausing, inviting, the CSV record, starting again and leaving; and, for a person who signs in, starting a real circle, joining by invitation and every screen's empty state. Tested in `packages/db` against PostgreSQL, in `packages/auth`, and end to end.

**Checked against the PayPal sandbox on 16 October 2026**

- A top-up order created by `packages/paypal` reads back `PAYER_ACTION_REQUIRED` with its amount and `custom_id` intact (`packages/paypal/src/fixtures`). Capturing it before approval is refused with `ORDER_NOT_APPROVED`, which Kin treats as PayPal's answer and never retries.
- PayPal answers a verification request with malformed headers with HTTP 400; Kin counts that as unverified.
- JavaScript SDK v6 loads from the sandbox in the browser, offers PayPal (not Pay Later, for this sandbox payer), opens PayPal's window with Kin's order, and closing the window comes back as a cancel.

**Checked in AWS by the deployments of 15 and 16 October 2026**

- The migration task reaches Aurora with verified TLS (the RDS certificate bundle) and migrates it in every deployment; the web app reads and writes Aurora through the App Runner VPC connector, as the hosted demo shows. CI builds the worker's Arm image on an x86 runner, and KinWorker's task runs on Fargate.

**Live on 16 October 2026: the first top-up through Kin**

- A sandbox buyer added $100.00 in the hosted demo. PayPal took a $3.98 fee, and the pool rose by $96.02. The worker recorded it from the order read back after capture; PayPal's webhook, verified nine seconds later, found the entry and wrote nothing (`inbox.applied` with `recorded`, then `already_recorded`, in `/kin/worker`). Its response is now the completed-order fixture.
- A forged webhook sent to the live app was carried to the worker, refused by PayPal's verification, logged and stored nowhere.

**Built and tested: top-ups**

- The money parsing and limits (`centsFromDecimal`, `checkTopUp`, `calendarDay`) with unit and property tests; the PayPal adapter (`packages/paypal`) against recorded responses: retries with the same request ID, no retry of a refusal, token renewal, webhook bytes passed through unchanged; recording a contribution and storing events against PostgreSQL, with isolation between circles; the worker's inbox (`apps/worker`) against PostgreSQL and the fake pool: the webhook and the read-back write one entry in either order, a forged or replayed event writes nothing, an outage is retried; the routes' rules; the "Add money" sheet end to end at the four viewports with a stand-in SDK; the infrastructure's grants and the worker's shape.

**Built and tested: structured caregiver billing (22 October 2026)**

- The organizer records a caregiver's rate separately from family care credits. A caregiver enters completed service days, reviews server-calculated amounts, and explicitly submits a received bill. Bill details preserve the original rate, currency and whole minutes, and remain immutable. The family reads the same details; submission neither approves nor pays.
- `packages/domain` owns the versioned details schema and uses the existing per-entry integer valuation. Database operations check active membership, serialize rate changes and submissions, return the original bill for retries, refuse duplicate service dates and expose only the caller-visible earlier bill's ID. A database integrity assertion also refuses totals that disagree with the evidence. No direct payee, bill or money-table write grant is added to the web role.
- Unit and property tests cover validation, exact valuation and visit order. Disposable PostgreSQL tests cover role and circle refusals, concurrent retries and rate changes, original rates, duplicate references, rollback and immutable evidence; the web tests cover forged input and independent account-group restrictions. `pnpm check` passed with 797 tests. All 247 browser tests passed against the production standalone build, including the billing journey at the four required viewports, 320-pixel reflow, keyboard submission, 200% text, French and Arabic long names, and duplicate feedback across tabs. Header controls wrap at enlarged text sizes. The production build passed with Next.js's webpack builder; Turbopack could not bind its internal port in the execution environment. These migrations have not been applied to shared data, and the milestone has not been deployed.

**Built and tested: caregiver bill review, fresh approval and payouts (26 October 2026)**

- Review: `planCaregiverPayout` (domain, unit and property tests: it plans exactly what `planApprovals` plans for the evidence's own total, and the caregiver's yes alone can never approve). `send_caregiver_bill` and `decline_caregiver_bill` against disposable PostgreSQL: the plan's places, payee, expiry and outcome are checked against the agreement; retries return one proposal; caregivers, observers and parents are refused; a paused circle raises nothing.
- Fresh approval: `assessStepUp` unit tests (methods, window, clock skew); the session carries `auth_time`, `amr` and the token ID; real-circle answers in PostgreSQL (a yes without evidence is refused, a no is not); in the browser, against the stand-in identity provider, a yes is recorded only after a step-up with a second factor, not after one without, and the step-up cannot be started from another site.
- Payouts: the adapter against PayPal's recorded sandbox replies (`fixtures/payout-sandbox-2026-10-26.json`); the worker against PostgreSQL and the fake pool: simulated in a demo, paid once in a real circle on PayPal's record with PayPal's fee, pending then paid, a lost reply and an outage each paid once, a refusal and a returned item failed with the payee still owed, held without an address, without the money or during a pause (and tracked through a pause once at PayPal), a foreign batch refused, the outbox leased only by the service. A scripted rehearsal on the local database then paid $264.00 through the real PayPal sandbox to a sandbox personal account: three reads of PENDING, then SUCCESS; one approval and one payout entry, with PayPal's $0.25 fee. That rehearsal turned a demo circle real and scripted the step-up evidence, because no screen yet makes a real circle's agreement.
- Not verified: Cognito's ACR and AMR claims on Kin's own user pool (AWS says the feature is "rolling out gradually"; without them every real yes is refused); the payout-item webhook; MFA enrolment in Kin; telling the recipient, the circle or the organizer of a payout's outcome. These migrations have not been applied to shared data, and nothing has been deployed.

**Built and tested: the family agreement screen (26 October 2026)**

- An organizer writes the first version or proposes a change, which governs once every organizer and contributor (and a deciding parent with an account) has accepted it: shares as percentages, care time, the three approval amounts and a start date. Kin checks every term (`checkAgreementTerms`) and shows exactly what changes, in words, before anything is proposed. The screen shows the version in force with its shares drawn and a month shared out to the cent, the approval rules worked out for bills of telling sizes by the approval engine itself, who accepted and how, any proposal waiting with its changes and its Accept button, and every version. The overview tells a member when a version waits for them.
- Unit and property tests for the terms, the percentages (exact round trip) and which version governs; PostgreSQL tests for proposing, accepting, superseding, start dates, refusals by role and by rule, the SQL rule agreeing with the domain, caregiver payouts planned against the version in force, and a real circle's first agreement; the web boundary against forged input; and the browser: the screen at the four viewports and at 320 pixels, a change proposed, reviewed and accepted by each member until it governs, a refused total, the observer and the caregiver, and a real circle's first agreement. Not built: the parent hearing a change by voice, and drafting an agreement from a conversation with Kin.

**Built and tested: the statement, the year in review and the audit export (moment 8)**

- `monthlyStatement` and `yearInReview` in `packages/domain` read every figure from the ledger (contributions by member, spending by category, caregiver pay, settlement moved, PayPal fees; a reversal counts against its original). The screen at `/dashboard/record/statement` shows them with the settlement the money core proposes and the bills expected next, prints cleanly through a print stylesheet (the browser's print dialog also saves a PDF), and `/dashboard/record/audit` exports every ledger line with its entry ID, source and source reference. Both need `money.view`. Unit tests in `packages/domain` and `apps/web`, and Playwright at the four viewports and 320 pixels, in print media, and for a refused caregiver. Not verified: a real browser's print preview or PDF output, and a real circle's statement (only the demo circle).

**Built and tested: monthly shares (this change; not applied to shared data, not deployed)**

- `packages/domain` (`monthly-share.ts`): the share's state machine and limits. `packages/paypal` (`subscription.ts`): the plan, product and subscription requests, the subscription and transaction readers (completed charges only, in integer cents), the approval link accepted only as a PayPal page over HTTPS, subscription IDs held to PayPal's alphabet, the new webhook events and the `subscription_checked` queue message; all against the in-memory fake pool, which now keeps subscriptions.
- `packages/db`: migrations 0013 (the table) and 0014 (policies, grants, the forward-only trigger, `start_my_share`, `move_my_share`), tested against PostgreSQL: roles (the observer, parent and caregiver refused, the caregiver reading none), limits, one live share, forward-only moves in both the operations and a service write, only the owner moving a share, the audit trail, isolation between circles, and the ledger writes (a simulated month once and never into a real share; a real charge once by its transaction ID with PayPal's fee).
- `apps/worker`: a demo share's month simulated once; a real share read back (state, charges, fee); the webhook and the read writing one entry in either order; pause, resume, cancel and failed charges followed; a forged delivery writing nothing; a subscription of another member refused; an outage retried. `apps/web`: the operations' boundary against fakes and PostgreSQL, in a demo circle and a real one. End to end: the circle screen's panel, form and a running share at the four viewports and 320 pixels, start, pause, resume and end in the demo, another member reading it without controls, the amount's limits, and the caregiver seeing none of it.
- Not verified: a real subscription in the PayPal sandbox through Kin (the requests follow the 14 October sandbox check and PayPal's documentation; the product and plan requests and the transaction listing's field names have not been run against the sandbox by this code); the five new webhook events, which are not subscribed on the live webhook until `webhook:register` is run again; a member's approval round trip in a browser; telling the circle about a failed charge; the demo's later months (only the first month is recorded; the demo clock does not advance on its own).

**Built and tested: refills the parent approves by voice (demo moment 4)**

- A family's refill rule (`purchase_rules`) and the purchases raised from it (`purchases`, with the delivery state machine of section 7.4). An organizer, a contributor or the parent asks Kin to reorder on the Approvals screen; `planPurchase` (domain) checks the refill against the rule (approved seller, limit for each purchase, the month's budget counting refills still waiting) and plans who must say yes with the approval engine, and `kin_private.propose_refill` refuses a plan that does not match the agreement. Kin raises the proposal (`raised_by` null); the amount is the rule's price, never typed. Rose's refill is above what she decides alone, so it waits for her yes, which the existing spoken flow records (method `voice`, read-back, a clear yes).
- Approving queues the purchase in the same transaction (`queue_purchase`), and the worker buys it: held while paused or while the pool lacks the money, otherwise placed with the seller by the execution's key and written to the ledger as one `purchase_captured` entry labelled simulated. The worker then follows the order to the door from the seller's own reports and the screen shows each step. The seller is `apps/demo-merchant` (catalog, order book keyed by the execution, delivery on a fixed schedule, and a charge of a saved PayPal wallet that creates and captures one order carrying only the vault ID and counts it made only if PayPal's record reads `COMPLETED` for exactly the amount), or, when `KIN_DEMO_MERCHANT_URL` is unset, the same behaviour in process.
- Tests: `purchase.test.ts` (domain, with property tests of the rule check and the schedule); the worker's `execute-purchase.test.ts` against PostgreSQL (proposing, refusals by role, budget, limit, seller and a real circle, queueing in the approval's transaction, buying once and labelled simulated, held while paused and without funds, a refusing and an unreachable seller, delivery in recorded steps, the outbox runners, RLS for a caregiver and for writes); the web `refills.test.ts` (the request boundary, and Rose's spoken yes through the real speech actions with fakes); `merchant.test.ts`; and `e2e/refills.spec.ts` at the four viewports and 320 pixels.
- Not verified: a real saved-wallet charge (the adapter is written against the 14 October sandbox finding and tested with recorded-shape replies only); the merchant service run beside the worker; a real microphone. A real circle cannot raise a refill (decision 62).

**Built and tested: letters and claim checks (7 November 2026)**

- Holding up a letter and checking a demand for money, sections 9.4 and 9.5: `checkClaim` and `sameName` (`packages/domain`), `readDocument`, `narrate` and the number guard (`packages/agent`), `settleReading`, `readLetterText` and `parseStoredReading` (`packages/documents`), `add_letter` and `record_claim_check` (migration 0013), `readLetter`, `checkDemand`, `sayLetter` and `sayClaim` (`apps/web`), and the Letters and calls section of the Bills screen in seven languages.
- Unit tests for each; PostgreSQL tests (`packages/db/src/letters.test.ts`) for the operations, their roles (a caregiver and an observer are refused), another circle's isolation, duplicates, payees and every refusal; web tests against PostgreSQL and the fakes (`letters.test.ts`, `letter-speech.test.ts`) for the boundary (forged keys, a mislabelled or oversized picture, an amount that is not an amount), the model failing or inventing a number, a letter that hides an instruction, limits, and speaking only from the record; and a browser spec (`e2e/letters.spec.ts`) at the four viewports and at 320 pixels with the model and the voice answered by stand-ins.
- Not verified: Claude reading a real photograph or wording a real verdict (Bedrock refuses the account every Claude model, and neither evaluation set has run); Polly speaking either in the deployed app; migration 0013 on the shared Aurora database; reviewing a listed bill into a payment (not built); a member hearing a stored verdict in a language other than the one it was written in.

**Built and tested: receipts and the paid settlement (demo moment 7)**

- Receipts: a member who shares the cost files a receipt (amount, category, day, words; manual entry, no photo upload yet) in a new `receipts` table with its own row-level security. Another member approves or declines it; nobody decides their own. An approval queues a `receipt.credit` outbox message in the same transaction, and the worker credits it with the money core's `outOfPocketApproved` entry (source `approval`, id `receipt-<id>`, simulated in a demo circle), so a repeat writes nothing. The ledger tables are unchanged.
- Settlement: an organizer puts the open month to the family (`propose_settlement`): `settlePeriod` and `planSettlementPayouts` (domain) give one `member_payout` proposal for each member the pool can pay now, planned by the approval engine. The database refuses a plan that differs from the agreement, a payee who does not share the cost, a second settlement for a period, and payouts that together exceed the cash in `pool_cash`. An approved member payout is queued and executed by the same worker path as a caregiver's: simulated in a demo circle, through the PayPal sandbox in a real one to the address the member gave (a payee row of category `settlement`, fixed on the execution at approval). Readied payouts count against the pool until PayPal confirms them (`canPayOut`'s `reservedCents`), the entry is `settlement_payout`, and the settlement closes when its last payout is paid.
- Not built: photographing a receipt, collections (members who owe still pay in through top-ups, which land in the open period), and carrying an unpaid remainder into the next month. Migrations 0013 and 0014 are not applied to shared data.

**Not yet tested**

- Everything else in this document. Executions other than caregiver payouts and the demo's simulated refills are not built. The latency figure is a target. The diagrams describe the intended design.
