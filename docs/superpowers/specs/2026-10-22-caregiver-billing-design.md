# Caregiver billing: structured submission and family review

Date: 22 October 2026.
Status: approved by the owner on 22 October 2026; implemented and verified locally. Not deployed.

## 1. Purpose and success

The owner has approved building the recommended caregiver payment journey in order: structured billing, confirmation, valid family approvals, execution, PayPal confirmation, and an accessible payment record. This specification covers its first independently testable milestone: a caregiver can prepare, check and submit a bill for completed visits, and the family can inspect the same bill.

The intended audience is Amara, a caregiver who needs reliable pay, and Rose's family, who need to understand exactly what they are approving. The eventual demonstration is a request for three four-hour visits, a checked bill for $264.00 at an agreed $22.00 hourly rate, the required family approvals, a confirmed sandbox payout and an understandable payment record.

The first milestone succeeds when a newly entered bill survives a reload, is visible only to the appropriate circle members, retains its original rate and visit evidence, and has no duplicate after resubmission. It ends at **submitted for family review**, without implying approval or payment.

## 2. Delivery sequence

1. Structured caregiver rate setup, bill preparation, confirmation and submission: this specification.
2. Family review, proposal creation and fresh multifactor approval. Apply the existing approval engine, including the parent's thresholds and independent approval requirements.
3. Transactional outbox, payout execution and confirmation from PayPal. Reserve actual fees and confirmed funds; stop and reconcile uncertain outcomes.
4. Natural-language billing through the model, with structured extraction, scoped tools, confirmation and fixed evaluations.
5. Microphone input and guarded spoken read-back and payment confirmation.
6. Interactive scam checking, executable family settlement and then purchasing mandates, in that order after the caregiver journey works.

Each later subsystem needs a focused specification before its production code. The owner explicitly requested direct implementation of this approved milestone without an implementation plan. This document does not authorize deployment, new external providers or future infrastructure changes.

## 3. Existing code and constraints

- `packages/domain/src/care.ts` already provides integer arithmetic and half-up rounding in `careValueCents`. Reuse it; do not introduce a second rounding rule.
- The family agreement's care rate values relatives' care credits. It is not a caregiver wage and must not be reused as one.
- `payees` already links a caregiver member to their payment recipient. `bills` already stores received bills and supports a nullable document reference. A manually entered bill needs no document or upload.
- `care_entries` is for a member's fairness credits. A caregiver bill must not generate those credits or reuse that table.
- Caregivers can read their own payees, bills and proposals through existing row-level security. They cannot read family agreements or other caregivers' bills.
- The web app uses `kin_app`, never the worker's service database identity. Existing table grants do not allow people to create bills or proposals.
- Real payment approvals remain locked until the fresh multifactor implementation is complete. Submission is neither approval nor execution.
- Demo seats are anonymous and switchable. A demo bill is simulated and can never supply authority for a real payout, even if that circle has a real sandbox top-up.

## 4. Approach and alternatives

Use the existing payee and bill records, adding narrowly scoped fields for caregiver rates and immutable bill details. This keeps the bill in the existing journey while preserving the evidence needed for subsequent approval.

Alternatives considered:

- Accept an arbitrary amount and put hours in a note. Rejected: the amount cannot be reproduced reliably, and the agreed rate is not a record.
- Introduce separate contracts, timesheets and visit tables now. Deferred: the first journey needs one rate per caregiver and a fixed bill snapshot, not scheduling or contract management.

Because the caregiver cannot read the family agreement, this milestone does not calculate an approval plan in their session. A family member reviews the submitted bill before the next milestone creates its proposal using the authorized agreement context. No agreement access is granted to caregivers.

## 5. Product behavior

### Organizer setup

From the circle's caregiver section, the organizer selects an active caregiver member, gives their payee a name and sets an hourly rate in the circle's currency. The server parses the decimal rate into positive integer cents. A caregiver cannot set or edit their own agreed rate.

If that caregiver has no linked payee, setup creates one with status `new`; this does not approve the payee, record a payment destination or permit payment. An existing payee retains its status and payment destination. The first milestone does not edit PayPal recipients or auto-pay rules.

There is at most one rate-configured billing payee for a caregiver in a circle, enforced by a partial unique index on circle and member where the rate is present. Setup locks the caregiver member row to serialize first-time configuration. If legacy data contains multiple unconfigured payees for that member, the organizer selects one of those same-circle payees explicitly; the server never guesses which one should be paid.

Changing a rate affects future drafts only and records an audit event. Existing bills preserve the rate used when they were submitted. Setting a rate is not the family's approval of any bill.

### Caregiver preparation and confirmation

On their bills screen, a caregiver with a configured rate can start a bill for their own linked payee. The server derives their circle, member and payee from the verified session; these are not selected by the browser.

The caregiver enters service dates and whole hours and minutes. There is one row per service date; multiple visits on a date are combined into that day's duration. Dates must be valid and must not be later than the circle's current calendar day. A day's duration is between one minute and 24 hours. A bill contains at least one service date, without repeated dates.

The review step displays the caregiver, the service dates and durations, the recorded hourly rate, each line amount and the total. Each day's charge uses `careValueCents`; the bill is the checked sum of those line amounts. This preserves the existing per-entry rounding convention. The browser only formats the server's calculation.

The caregiver explicitly submits the reviewed bill. If the current agreed rate differs from the reviewed rate, submission returns a rate-changed result and requires a fresh review. An unconfigured rate produces a useful empty state asking the caregiver to contact the organizer.

### Submission and family visibility

Submission stores the bill, its immutable details, its submission key and an audit event in one database transaction. The bill starts at the existing `received` state. No proposal, approval, execution, payable or ledger entry is created in this milestone.

The caregiver sees a submitted bill with its visit breakdown and status. Family members who already have bill access see the identical breakdown. Show the same breakdown for the current bill after a rate change. Existing bills with no caregiver details continue to render normally.

The existing paid-bills view remains based on confirmed ledger evidence. A received bill never appears as a paid bill, and a submitted bill does not promise same-day arrival.

## 6. Storage and access changes

These approved additions are included in the milestone's migrations:

| Record | Addition | Purpose |
| --- | --- | --- |
| `payees` | Nullable positive `caregiver_rate_cents_per_hour` | The rate the organizer has recorded for a linked caregiver |
| `bills` | Nullable `caregiver_details` JSON snapshot | Versioned, validated service dates, integer durations, original rate and circle currency |
| `bills` | Nullable `submission_key`, unique within a circle when present | Idempotent submission of a reviewed caregiver bill |

The snapshot's shape is defined and parsed once in `packages/domain`, reused at input, persistence and read boundaries. Amounts are recalculated from the snapshot before display or later proposal creation; inconsistent stored data fails closed. Its version starts at 1. Generic payees keep the rate null; generic bills keep their two caregiver additions null.

Add narrow database functions for organizer caregiver setup and caregiver submission, following the existing `kin_private` operation pattern. Functions must resolve the current active membership from the database, refuse archived circles, enforce same-circle links, and accept only the operation's fields. Fix the search path and revoke public execution. Do not grant direct table-wide INSERT or UPDATE access to the web role.

The setup function may only change the caregiver rate and display name or create the linked `new` payee. It cannot alter recipient credentials, auto-pay configuration or payee approval. The submission function may only create a received bill for the caller's own linked caregiver payee and add the matching audit record. It cannot create proposals or touch money records.

Caregiver details, the bill amount, the payee and the submission key become immutable after submission; later stages may advance the bill's existing state machine. A correction is a separate bill, with an audit reference to the earlier one; editing submitted evidence is outside this milestone.

Existing SELECT policies remain unchanged. Add matching actions to `packages/auth` for organizer setup and own-caregiver submission. Do not add roles or change who may approve payments.

## 7. Idempotency, duplicates and races

- A reviewed draft receives a server-issued random submission key. Submission revalidates identity, dates, durations and the current rate. The key provides retry identity, never authorization or proof that browser fields are valid. Its normalized contents are stored with the bill so later reuse can be compared exactly.
- Repeating the same key and contents returns the existing bill. Reusing the key for different contents is refused.
- Concurrent submissions with the same key result in one bill and one submission audit event.
- Serialize submission for the same caregiver payee. A service date already present in another non-rejected caregiver bill causes a duplicate-date error identifying the earlier bill the caller may read. This first version requires all visits for a day to be billed together; it does not infer that matching amounts alone mean a duplicate.
- Organizer rate changes and bill submission lock the same payee row, so a bill uses one definite rate. A changed rate invalidates an older review.
- Server errors preserve the entered values and return safe messages without SQL, provider text or stack traces.

## 8. Components and ownership

- `packages/domain`: the shared caregiver bill schema, service-date validation, canonical details, reproducible calculation and typed validation outcomes. Time and rate are arguments.
- `packages/auth`: the two operation permissions and role-refusal tests.
- `packages/db`: schema additions, migrations, narrow operations, snapshot parsing, own-bill reads, idempotency, audit records and security tests.
- `apps/web/src/server`: authenticated setup, review and submit actions using existing request and form helpers. Existing Cognito account-type restrictions apply before circle authorization.
- `apps/web/src/components/dashboard`: small caregiver setup, visit-entry, review and submitted-bill components, composed into the existing circle and bills pages.
- Existing seven dictionaries: labels, state messages and errors. Existing shared money and date formatters, design tokens and UI primitives remain authoritative.

No new package, provider, service, queue or table is required for this milestone. No model call, microphone permission or speech service is introduced yet.

## 9. Verification and acceptance

Every production behavior starts with an observed failing test.

Domain tests cover the three four-hour visits at 2,200 cents per hour producing 26,400 cents, fractional-hour rounding, invalid dates and durations, repeated dates, future visits, empty bills, invalid rates, zero-value bills and safe-integer overflow. Property tests prove that valid totals equal the sum of the existing per-entry valuation and are invariant under visit order.

Database tests use disposable PostgreSQL and cover persistence and read-back, original rate preservation, atomic rollback, retry and concurrent idempotency, duplicate service dates, rate-change races and immutable evidence. Test caregivers and observers first. Direct database attempts at foreign payees, another caregiver's bill, unauthorized rate changes and forged operation identity must fail. Confirm that the web role still cannot write ledger entries, execute payouts or approve real money.

Web tests cover server rejection of forged totals, rates, payees, dates and unauthorized actions; the server must calculate rather than trust submitted totals. Playwright covers setup, review, correction before submission, submission, reload, family visibility, duplicate feedback, missing-rate states and role restrictions. Exercise keyboard operation and the shared overflow assertion at 360×740, 768×1024, 1024×768 and 1440×900, plus reflow at 320 pixels and long content.

Acceptance requires `pnpm check`, `pnpm test:e2e`, and `pnpm build` to pass. Update architecture sections 6.3, 13, 21 and 23 with the actual storage, operations, decision rationale and verification status in the implementation change. Do not claim the payout journey works when only this milestone is complete.

Verification on 22 October 2026: `pnpm check` passed with 797 tests. The production webpack build and all 247 Playwright tests against its standalone server passed. The default Turbopack build could not bind its internal port in this execution environment, so the build and browser stages were run separately with the supported webpack builder. No shared migration or deployment was run.

## 10. Approval boundaries

The owner approved this written specification, its additive schema changes and its narrow database operations on 22 October 2026. These extend the architecture's bill model and define new write permissions under repository AGENTS.md sections 10 and 12.

The owner subsequently instructed implementation to begin without writing an implementation plan. Execute inline with test-driven development; no delegation is assumed. Keep changes on a feature branch, do not commit or push without being asked, and do not deploy or migrate shared data.

## 11. Milestones 2 and 3: status on 26 October 2026

The owner chose, on 26 October 2026, to build the delivery sequence's next milestones directly, without separate specifications, and decided four open points: a yes to real money uses Cognito's step-up (ACR level 4, `amr` with `mfa`); a structured bill moves `received → ready → proposed` or `received → rejected`; organizers and contributors review; payouts are real PayPal sandbox payouts through the outbox and worker, simulated in demo circles. `docs/architecture.md` decisions 51 to 55 and section 23 record what was built, how it was verified, and what is not verified.

Still open for these milestones: a screen that makes a real circle's agreement (without one, a real circle cannot raise a payout proposal), TOTP enrolment in Kin, the payout-item webhook, and telling the caregiver, the circle and the organizer of a payout's outcome.

