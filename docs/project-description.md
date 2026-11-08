# Kin

**Nothing about Mom's money without Mom.**

Product description. PayPal AI Hackathon 2026. Draft 1, 13 October 2026.

This document describes the product: the problem, the audience, the features, the business value and the impact. It does not describe the implementation. It describes the product Kin aims at, which is larger than what is built: `README.md` has the table of what is live and what is simulated, and `architecture.md` section 23 records what is verified.

---

## 1. Summary

Kin is a shared money layer for families who look after an aging parent.

Siblings pay into one family pool. An AI agent uses that pool to pay the bills, the caregivers and the recurring purchases the parent needs. It keeps a ledger of who contributed what, and it settles imbalances between siblings so that no one quietly carries the cost alone.

The parent is at the center, not on the sidelines. Kin speaks every money event aloud, asks for the parent's spoken approval on the decisions that are theirs to make, reads paper bills through the phone camera, and checks suspicious payment demands against the real PayPal record.

**In one sentence:** Kin lets a family share the cost of caring for a parent fairly and transparently, while giving the parent a voice in every decision about their own money.

**The two ideas that make Kin new:**

1. **Fairness as a payout.** The family agrees how costs are shared. Kin measures the gap between the agreement and reality, and closes it with real money movements, each backed by a receipt and an approval.
2. **Payment events as speech.** Every confirmed PayPal event becomes a plain spoken sentence for the parent, and every decision the parent makes is a confirmed spoken command. A parent who cannot read a screen can still run their own affairs.

---

## 2. The problem

Caring for an aging parent is a financial project that families run with no tools. It is managed through group chats, memory, guilt and one sibling's credit card.

### 2.1 The cost lands on one person, and nobody can see it

In most families one sibling lives closest. That person pays at the pharmacy, covers the plumber, buys the groceries and fronts the caregiver's wages. They mean to ask the others for their share later. Often they never do, or they do and it becomes an argument.

- About 63 million Americans are family caregivers, nearly one adult in four (AARP and National Alliance for Caregiving, 2025).
- Family caregivers spend on average $7,242 a year out of pocket, about a quarter of their income (AARP, 2021).
- The unpaid care they provide was valued at $600 billion a year in the United States alone (AARP, 2023).

The money is only half of it. The sibling who drives to appointments and sits in waiting rooms gives time that no spreadsheet records. The sibling who lives far away often wants to contribute and has no clear way to do it. Resentment grows on both sides, and it is the leading cause of lasting rifts between adult siblings.

### 2.2 The parent is left out of their own finances

When children take over the bills, the parent stops being told what is happening. Decisions are made about them, not with them. For a person who has managed a household for sixty years, this is a real loss of dignity.

The barrier is often physical, not mental. Vision loss rises steeply with age, and most of the 2.2 billion people worldwide with a vision impairment are over 50 (WHO). Payment apps, bank statements and paper bills are all visual. A parent who is fully capable of deciding cannot take part, because every tool assumes they can read a small screen.

### 2.3 Caregivers are paid late and informally

Home aides, cleaners, drivers and visiting nurses are often paid in cash or by whichever sibling remembers. Payments arrive late. There is no record of hours, no receipt for the family, and no proof of income for the caregiver. A good caregiver who is paid unreliably leaves, and the family's whole arrangement collapses.

### 2.4 Older adults are the main target of payment fraud

Americans aged 60 and over reported nearly $4.9 billion in fraud losses in 2024, a sharp rise on the year before (FBI Internet Crime Complaint Center). The typical scam is a phone call or a letter claiming a bill is overdue. A parent who is no longer sure which bills the children have paid cannot tell a real demand from a false one.

### 2.5 Today's tools each solve one slice

| What families use today | What it does well | What it leaves unsolved |
|---|---|---|
| Expense-splitting apps | Tracks who owes whom | No shared pool, no bill payment, no caregiver, no parent, no audit trail |
| A joint bank account or shared card | One place for the money | Legal and tax complications, no fairness tracking, anyone can drain it, the parent still cannot see it |
| Care-coordination apps | Schedules, updates, task lists | No money at all |
| Fraud-monitoring services for seniors | Alerts on unusual activity | Watches the parent's accounts but pays nothing and shares nothing |
| A spreadsheet and a group chat | Free and flexible | Depends on one tired person keeping it up |

No product combines the shared pool, the fair split, the caregiver's pay and the parent's own voice. That combination is Kin.

---

## 3. Who Kin is for

Kin serves a **family circle**: the group of people who share responsibility for one older person's wellbeing and money.

### 3.1 The people in a circle

| Person | Who they are | What they need |
|---|---|---|
| **The parent** | Rose, 81. Lives in her own home. Sharp, but macular degeneration means she can no longer read her statements. | To know what is being paid on her behalf, to decide what is hers to decide, and to feel safe when the phone rings. |
| **The organizer** | Elena, 54. Lives twenty minutes away. Handles almost everything and has been paying for most of it. | To stop being the family bank and the family bookkeeper. To be seen, and reimbursed, without having to ask. |
| **The distant sibling** | Marcus, 51. Lives in another country. Earns well and feels guilty. | A simple, fair way to do his part, and proof that the money goes where it should. |
| **The stretched sibling** | Ana, 47. Lives nearby, has less money and gives a lot of time. | Her hours to count for something. A share she can actually afford. |
| **The caregiver** | Amara, a home aide who visits Rose three mornings a week. | To be paid on time, every time, with a record of her hours and her income. |

### 3.2 The first audience

Kin's first users are adult siblings aged roughly 40 to 65, in families with two to four siblings, where at least one lives in a different city, the parent still lives at home, and the family pays at least one caregiver or regular service. This is the group with the sharpest pain: enough money moving to cause conflict, enough distance to cause mistrust, and a parent who is still capable of taking part.

### 3.3 The wider audience

- **Only children and spouses** who carry everything alone and need the record more than the split.
- **Families spread across countries**, where one branch sends money home for a parent's care.
- **Professionals** who manage an older person's affairs: geriatric care managers, daily money managers, elder-law attorneys and court-appointed guardians, all of whom must account for every dollar.
- **Home-care agencies** that want a reliable way for families to pay and for aides to be paid.

---

## 4. Product principles

These five rules shape every feature.

1. **The parent is a participant, not a subject.** Anything Kin tells the siblings, it can tell the parent. Decisions that belong to the parent are asked of the parent.
2. **Fairness is agreed once, then measured always.** Kin does not decide what is fair. The family does. Kin makes the agreement visible and keeps everyone to it.
3. **Every dollar has a receipt and an approval.** Nothing leaves the pool without a record of what it was for and who said yes.
4. **Voice first, screen second.** The parent's and the caregiver's main interface is conversation. Screens exist for those who want them.
5. **The AI proposes, people approve, the record decides.** The agent drafts, reads, explains and suggests. A person confirms every movement of money. What actually happened is taken from PayPal's own records, never from the AI's belief.

---

## 5. A month with Kin

**Day 1.** Elena creates a circle for her mother Rose and invites Marcus and Ana. The three agree on shares: Marcus 50 percent, Elena 30 percent, Ana 20 percent. They also agree that hands-on care hours count toward a share at a rate they choose together. Each sibling sets up a monthly contribution to the family pool. Rose is added with the role "decides": purchases above $50 need her spoken yes.

**Day 3.** Rose's phone rings with a calm voice from Kin: "Good morning Rose. Your electricity bill of 84 dollars was paid from the family pool this morning. Nothing else is due this week." She did not have to open anything.

**Day 6.** Amara finishes her third visit of the week. She says to Kin: "Bill the family for this week, three visits, four hours each." Kin prepares the bill and reads it back. Elena approves it with one tap. Amara's phone confirms the payment before she reaches her car.

**Day 9.** Rose's blood pressure medication is due for refill. Kin tells Rose: "Your refill is ready to order. It costs 64 dollars. Shall I go ahead?" Rose says yes. Kin places the order and tells her when it will arrive.

**Day 12.** A letter arrives. Rose holds it in front of her phone. Kin reads it aloud: "This is from the water company. It says 61 dollars is due on the 30th. I have added it to the family's list. Elena will see it today."

**Day 15.** A man telephones Rose and says her gas account is overdue and she must pay 300 dollars today. Rose asks Kin. Kin answers: "I find no gas bill outstanding. Your gas bill of 57 dollars was paid on the 2nd. Please do not pay this caller. I have told Elena and Marcus." The family is alerted within seconds.

**Day 20.** The stairlift needs a repair costing 900 dollars, more than the pool holds. Kin proposes two options to the family: a one-off top-up split by the agreed shares, or spreading the cost over several months. The siblings choose, Rose agrees, and the repair is booked.

**Day 30.** Kin closes the month. Elena paid 180 dollars at the pharmacy from her own pocket and logged the receipts by photographing them. Ana drove Rose to four appointments. Kin calculates that Elena is owed 126 dollars and Ana 40 dollars, proposes the settlement, and on approval sends the money. Every sibling receives the same one-page statement. Rose hears a two-minute spoken summary: what came in, what was paid, what is coming next month, and that everything is in order.

---

## 6. Features

### 6.1 The family circle

- **One circle per person cared for.** A family with two parents in different homes can run two circles.
- **Roles.** Organizer, contributor, parent, caregiver and observer. An observer, such as a family lawyer, can see everything and change nothing.
- **The parent's role is chosen with the parent.** Three levels:
  - *Decides.* The parent's spoken approval is required above a threshold the family sets.
  - *Informed.* The parent hears everything and can ask anything, but approvals rest with the family.
  - *Represented.* A named person holding legal authority acts for the parent, and Kin records that authority.
- **A written family agreement.** Shares, thresholds, who approves what, and how care hours are valued. Kin drafts it in plain language from a short conversation and every member accepts it.

### 6.2 The pool and contributions

- **One family pool.** In production, a PayPal account held for the family under PayPal's licences, reached through PayPal's partner platform (or a licensed partner), with Kin acting on it only with the family's consent. In the hackathon sandbox, every circle's top-ups land in one PayPal business account that Kin's app holds, and Kin's ledger attributes each amount to its circle. Kin has no bank account of its own and takes no custody beyond that sandbox arrangement (`architecture.md` decision 70).
- **Monthly shares.** Each sibling sets a recurring contribution matching their agreed share. They can pause or change it, and the change is visible to all.
- **One-off top-ups.** For an unexpected cost, Kin requests a top-up from each sibling in proportion to their share.
- **Out-of-pocket spending counts.** A sibling who pays for something directly photographs the receipt. Kin reads it, categorizes it and credits it to that sibling.
- **Time counts too.** If the family has agreed, hands-on care hours are logged and valued at the family's chosen rate, so the sibling who gives time is credited alongside the sibling who gives money.
- **Large costs can be spread.** For a major one-off purchase the family can choose to pay over time.

### 6.3 The fairness ledger

- **Always current.** At any moment each sibling can see what they have contributed in money and in time, against what the agreement says.
- **Explained in words.** Kin does not show only a balance. It says why: "You are 126 dollars ahead this month because you paid three pharmacy bills directly."
- **Monthly settlement.** Kin proposes the smallest set of payments that brings everyone back to their agreed share, and on approval sends them.
- **No surprises.** Any sibling can question any line. The receipt, the approval and the payment record are attached to it.

### 6.4 Bills and caregiver pay

- **A single list of what is due.** Bills arrive by photograph, by forwarded email or from a caregiver. Kin reads them, extracts the amount and due date, and lists them.
- **Approval rules.** Small recurring bills are paid automatically once the family has approved the biller. Anything new or large waits for a person.
- **Caregiver bills.** The caregiver's hours become a bill to the family, approved by the organizer and paid the same day.
- **Checks on every bill.** Kin flags duplicates, amounts that jump without explanation, unfamiliar billers and hours that conflict with the visit schedule.

### 6.5 The purchasing agent

- **Recurring needs are handled.** Medication refills, incontinence supplies, groceries and similar regular purchases are ordered on schedule within a monthly budget.
- **Bounded by the family's rules.** The agent can only buy approved categories from approved sellers within approved limits.
- **Always confirmed.** Each purchase is confirmed by the parent or the family, according to the circle's rules, before any money moves.
- **Tracked to the door.** Kin follows the delivery and tells the parent when to expect it.

### 6.6 The parent's voice

This is the part of Kin that belongs to the parent.

- **Spoken money events.** Each confirmed payment, purchase, contribution and delivery is announced in a short, calm sentence. The parent chooses how often: as it happens, once a day, or once a week.
- **Voice approval.** For decisions that are theirs, the parent hears the request and answers yes, no or "ask me later". Kin repeats the decision back before acting on it.
- **Ask anything.** "What did we spend on medicine this month?" "Has Amara been paid?" "Who paid for the plumber?" Kin answers from the record.
- **AI eyes.** The parent holds any letter, bill or receipt up to the phone camera. Kin reads it aloud, explains what it is, and adds it to the family's list if it needs action.
- **Scam check.** When someone demands money by phone, letter or message, the parent asks Kin. Kin checks the demand against what has actually been billed and paid, tells the parent plainly whether it matches anything real, and alerts the family.
- **A trusted routine.** Kin always introduces itself the same way and never asks the parent for a password, a card number or a code. The family teaches the parent one rule: Kin tells, Kin never asks for secrets.
- **A monthly spoken statement.** Two minutes covering what came in, what went out and what is coming.

### 6.7 The caregiver's side

- **Bill by voice.** The caregiver says the visits and hours. Kin prepares the bill and reads it back.
- **Paid the same day.** Once the family approves, payment is sent and confirmed to the caregiver immediately.
- **A record of income.** The caregiver has a history of every visit billed and every payment received, which they can use as proof of income.
- **Expenses.** If the caregiver buys something for the parent, they photograph the receipt and are reimbursed with their pay.
- **No access to family finances.** The caregiver sees only their own bills and payments.

### 6.8 Statements and audit

- **The monthly family statement.** One page, identical for every sibling: contributions, spending by category, caregiver pay, settlement, and what is expected next month.
- **The year in review.** Totals by category and by person, useful at tax time and for family conversations about what comes next.
- **The audit export.** A complete, dated record of every movement with its receipt and approval. It is built to the standard a court expects from someone managing another person's money.
- **Nothing is ever deleted.** Corrections are added as new entries, so the history stays intact.

### 6.9 Safeguards

- **No one can drain the pool.** Money leaves only to approved billers, approved caregivers and members of the circle, and never above the limits in the family agreement without a second approval.
- **Two approvals for large amounts.** Above a threshold the family sets, two members must agree.
- **Every change is announced.** A new biller, a changed share or a new member is reported to everyone in the circle.
- **A pause button.** Any member can freeze outgoing payments for 24 hours if something looks wrong.
- **Protection against pressure.** Unusual patterns, such as a sudden new payee or repeated requests to the parent, are flagged to the whole circle, not to one person.

### 6.10 Accessibility and language

- **Built for low vision and blindness first.** Everything the parent needs works by voice alone. The screen version uses very large type, high contrast and full screen-reader support.
- **Built for unsteady hands and slow hearing.** Large touch targets, adjustable speaking speed, repeat on request.
- **Multilingual families.** Each member uses Kin in their own language. A caregiver can bill in Spanish, the parent can listen in Portuguese, and the siblings can read in English.
- **Works on an ordinary phone.** No new device is needed.

---

## 7. What PayPal does in Kin

PayPal is not a payment button at the end of Kin. It is the system that moves every dollar and the record that Kin treats as the truth.

| Family need | PayPal capability |
|---|---|
| Each sibling pays a monthly share | Subscriptions |
| A sibling makes a one-off top-up | Checkout |
| A big repair is spread over time | Pay Later |
| A sibling is asked for a top-up or a settlement amount | Invoicing |
| The agent buys what the parent needs, after a person confirms | Saved payment method at a linked merchant |
| The caregiver is paid the same day | Payouts |
| A sibling who overpaid is made whole | Payouts |
| Kin knows what truly happened | Transaction records and live payment notifications |
| A delivery is followed to the door | Shipment tracking |
| A wrong or disputed charge is contested | Disputes |
| Each member is who they say they are | Log in with PayPal |
| The agent acts on the family's instructions | PayPal's agent toolkit and MCP server |

Two things follow from this. First, the family does not need a new bank account or a new card. Second, the spoken sentences the parent hears are generated from confirmed PayPal events, which is why the parent can trust them and why the scam check works.

For the hackathon, all of this runs in the PayPal sandbox with test money.

---

## 8. What AI does in Kin, and what it does not

**AI does the work that needs understanding:**

- Reads paper bills, letters and receipts from a photograph.
- Turns a spoken sentence into a bill, an approval or a question.
- Turns a payment event into a clear spoken sentence in the right language.
- Answers questions about the family's money from the record.
- Explains the fairness ledger in words.
- Spots what looks wrong: duplicate bills, unusual amounts, unfamiliar payees, demands that match nothing on record.
- Drafts the family agreement, the monthly statement and the audit summary.
- Plans recurring purchases inside the family's rules.

**AI does not do the work that needs certainty:**

- It does not do the arithmetic of the ledger or the settlement. That is calculated exactly, the same way every time.
- It does not decide that a payment happened. PayPal's record decides.
- It does not move money on its own. A person confirms every movement.
- It does not give legal, tax, medical or investment advice.

This division is deliberate. It is what lets a family trust an AI with something as sensitive as a parent's money.

---

## 9. The value for each person

| Person | Before Kin | With Kin |
|---|---|---|
| **The parent** | Told little, decides nothing, anxious when the phone rings | Hears everything, decides what is theirs, has a trusted way to check any demand |
| **The organizer** | Pays first, chases later, keeps the spreadsheet, feels unseen | Pays from the pool, is reimbursed automatically, keeps nothing by hand |
| **The distant sibling** | Sends money now and then, unsure if it is enough or where it goes | Pays an agreed share and sees exactly what it paid for |
| **The stretched sibling** | Gives time that nobody counts | Has care hours credited beside everyone else's money |
| **The caregiver** | Paid late, in cash, with no record | Paid the same day with a full income history |
| **The family** | Money is the thing nobody mentions until it explodes | Money is settled every month and stops being a subject |

---

## 10. Why Kin is different

- **It starts from the parent.** Other tools for older people's money are built for the children or for a monitoring service. Kin is the only one where the older person is the primary user of a voice interface designed for them.
- **It moves the money, not just the numbers.** Splitting apps tell you who owes whom. Kin holds the shared pool, pays the bills, pays the caregiver and settles the difference.
- **It counts time as well as money.** The sibling who gives hours is credited alongside the sibling who gives dollars. This is the real source of most family conflict, and other tools ignore it.
- **Its record stands up to scrutiny.** Every line has a receipt and an approval, in a form that a lawyer, an accountant or a court can accept.
- **Its fraud protection is grounded in fact.** Kin does not guess whether a caller sounds suspicious. It checks whether the bill exists and whether it has been paid.

---

## 11. Market and business model

### 11.1 The market

- **United States.** About 63 million family caregivers, spending over $7,000 each a year out of pocket. Even a small share of that spending passing through Kin is a large payment volume.
- **Worldwide.** By 2030 one person in six will be aged 60 or over, and the number will reach 2.1 billion by 2050 (WHO). Families are smaller and more scattered than in any earlier generation, so fewer children share the care of each parent, often across borders.
- **Adjacent markets.** Professional fiduciaries and guardians, home-care agencies, and employers who offer caregiving support as a staff benefit.

### 11.2 How Kin earns money

These are proposals to be tested with real families.

| Plan | Who pays | What they get | Proposed price |
|---|---|---|---|
| **Family** | The circle, split like any other cost | Everything in this document for one circle | A flat monthly fee per circle, in the range of a streaming subscription |
| **Parent and caregiver** | Nobody | Full use of their side of Kin | Free, always |
| **Professional** | Care managers, attorneys, guardians | Many circles, client reporting, court-ready exports | Per client, per month |
| **Agency** | Home-care agencies | Billing and same-day pay for their aides across many families | Per active aide |
| **Employer benefit** | Employers | Kin offered to staff who are caregivers | Per enrolled employee |

The family plan is itself paid through a PayPal subscription from the pool, so Kin's own price is shared by the same fair split as everything else.

### 11.3 Why this is good business for PayPal

Kin brings whole families into PayPal at once, including an older generation and a caregiver workforce that payment apps reach poorly. It creates recurring, predictable volume from subscriptions, invoices and payouts. And it shows AI agents doing something more valuable than shopping: carrying a real family responsibility safely.

---

## 12. Trust, safety and privacy

Kin handles a vulnerable person's money. Trust is the product.

- **Consent comes first.** A circle is not active until the parent, or the person with legal authority to act for them, has agreed to it and to their role in it.
- **Respect for capacity.** The parent's role can change over time. Changing it requires the agreement of the circle and is recorded.
- **Legal authority is recorded, not assumed.** Where someone holds a power of attorney or guardianship, Kin notes it. Kin does not grant authority to anyone.
- **Protection from the family as well as from strangers.** Financial abuse of older people is most often committed by someone close to them. Kin's limits, double approvals, full visibility and pause button exist for that reason.
- **Minimal data.** Kin keeps financial records and receipts. It does not keep medical records, diagnoses or clinical notes.
- **The parent's information belongs to the parent.** The parent, or their representative, can see everything held about them and can close the circle.
- **Honest about what it is.** Kin is not a bank, a law firm or a care provider, and it does not give legal, tax or medical advice. It takes no bank account of its own; the sandbox build and the production plan for holding money are described under "One family pool" above.
- **An AI that admits doubt.** When Kin is not sure what a document says or whether a demand is real, it says so and asks a person.

---

## 13. Impact, and how it will be measured

**The change Kin aims to make:** families stop fighting about money while caring for a parent, the parent keeps a say over their own affairs, and the people paid to help are paid properly.

| What we measure | Why it matters |
|---|---|
| Share of circles where every sibling contributes each month | Shows the burden is actually being shared |
| Average gap between agreed and actual shares before each settlement | Shows fairness is improving, not just being reported |
| Hours per month the organizer spends on money tasks | Shows the bookkeeping burden has lifted |
| Share of parent-level decisions answered by the parent | Shows the parent is truly taking part |
| Days from caregiver's visit to caregiver's payment | Shows caregivers are being paid on time |
| Suspicious demands checked, and money not lost | Shows the fraud protection works |
| Families who say money caused less conflict after three months | The outcome that matters most |

---

## 14. What the hackathon version shows

The submission demonstrates one complete month for one family, end to end, in the PayPal sandbox:

1. A circle is created, shares are agreed and monthly contributions begin.
2. The parent hears a bill being paid.
3. The caregiver bills by voice and is paid the same day.
4. The parent approves a refill by voice, and the agent buys it.
5. The parent holds up a letter and hears it read.
6. A false payment demand is checked and caught.
7. A sibling's out-of-pocket receipts are credited and the month is settled with a real payout.
8. The family statement and the audit export are produced.

**The story in the video** follows Rose, Elena, Marcus, Ana and Amara through those eight moments in under three minutes. It opens on Rose's voice, not on a dashboard.

**How it answers the judging criteria:**

- **Technological implementation.** Nine PayPal capabilities and the agent toolkit, each doing a job the product cannot work without.
- **Design.** A complete product for five kinds of user, with a voice experience built for the person hardest to serve.
- **Potential impact.** A named, enormous, well-documented problem, and a demonstration that addresses each part of it.
- **Innovation.** Fairness settled by payout and payment events delivered as speech, neither of which exists in current products.
- **Presentation.** One family, one month, one clear before and after.

---

## 15. Roadmap

- **Next.** Pilot with a small number of real families. Add the professional plan for care managers and guardians.
- **Then.** Cross-border circles with currency handling for families who send money home. Partnerships with home-care agencies and pharmacies.
- **Later.** A circle that plans ahead: forecasting care costs, preparing the family for the move from home care to residential care, and handing the complete record to an executor when the time comes.

---

## 16. Open questions

These need answers before Kin goes to real families. None of them blocks the hackathon version.

- **Who legally owns the pool account?** The parent, the organizer or a purpose-made family account. This affects tax, liability and PayPal's own account rules.
- **How should care hours be valued?** A family-set rate is simple. Some families will find any rate uncomfortable.
- **What are the tax consequences** of siblings reimbursing each other and of paying a caregiver directly, in each country?
- **How is the parent's consent best established and re-confirmed** when capacity is changing?
- **What will families pay?** The pricing in section 11 is a proposal.

---

## 17. Sources

The figures in this document were taken from the published reports below. Check each against the original before the submission is filed.

- AARP and National Alliance for Caregiving, *Caregiving in the US 2025*: about 63 million family caregivers in the United States.
- AARP, *Caregiving Out-of-Pocket Costs Study*, 2021: average annual out-of-pocket spending of $7,242, about 26 percent of income.
- AARP Public Policy Institute, *Valuing the Invaluable*, 2023: unpaid family care valued at $600 billion a year.
- FBI Internet Crime Complaint Center, *2024 Elder Fraud Report*: nearly $4.9 billion in losses reported by people aged 60 and over.
- World Health Organization, *Ageing and health* fact sheet: one in six people aged 60 or over by 2030, and 2.1 billion by 2050.
- World Health Organization, *Blindness and vision impairment* fact sheet: at least 2.2 billion people with a vision impairment, most of them over 50.
