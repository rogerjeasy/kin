# Kin: demo video script

A shot-by-shot script for the submission video. **Target 2:45, hard limit under 3:00.** It is recorded on the hosted demo, https://mzdg4f3stk.us-east-1.awsapprunner.com, in English, at a 1440×900 browser window.

The script follows one story: Amara's week of care, from the family's money to Rose hearing that Amara was paid. Every route, button and label below is taken from the app's code (`apps/web/src/content/dashboard-routes.ts`, `apps/web/src/i18n/dictionaries/en.json`) as of 11 November 2026. Narration is about 340 words, roughly 125 to 130 words a minute, which leaves room for pauses and for Kin's own voice.

---

## Pre-recording checklist

**The demo**

- [ ] Open the site and press **Try the demo**. You land on the Overview (`/dashboard`) in Elena's seat. The banner reads "You are Elena, Organizer".
- [ ] If you have used the demo before, press **Start again** in the banner for a fresh copy of Rose's circle. Do it once more right before recording.
- [ ] Do one full dry run off camera, then **Start again**. During the dry run, note which label Amara's payout gets in the Record (step 4 below): **"Simulated"** or **"PayPal sandbox"**. With the repository's settings (`kin:demoSandboxPayeeEmail` is not set in `infra/cdk.json`), expect **"Simulated"**. Read the matching narration in shot 4.
- [ ] Ask Kin allows ten questions per demo visitor who has not signed in. Use at most one or two in the dry run. If you run out, press **Leave the demo**, then **Try the demo** again.
- [ ] Pick Amara's two service days: two completed days after her care agreement starts and not in the future. If you record on a Wednesday or later, "Monday and Tuesday" works. Otherwise use "yesterday and the day before". At her rate of $22.00 an hour, two days of four hours come to **$176.00**. That is above $50, so Rose must decide, and at or below $500, so her yes alone is enough.

**The browser**

- [ ] Use a clean Chrome profile with the window at 1440×900 and zoom at 110%. Raise it to 125% for the Listen shot so Rose's sentence fills the frame.
- [ ] Hide the bookmarks bar (Cmd+Shift+B), close other tabs, switch off notifications and extensions that show badges.
- [ ] Allow the microphone for the site, and turn on speakers so the screen recording picks up Kin's voice (Amazon Polly).
- [ ] Allow pop-ups for the site, because PayPal's checkout opens in its own window.
- [ ] Have the **PayPal sandbox personal (buyer) account** email and password ready to paste. Never show the password on screen. Pause the recording while you type it.

**Seats for each beat** (change the seat with the banner button "You are …" → **See the circle as** → pick the person)

| Beat | Seat | Screen |
|---|---|---|
| Hook | Rose (Parent) | Listen, `/dashboard/listen` |
| 1. Top-up | Marcus (Contributor) | Overview `/dashboard`, then Record `/dashboard/record` |
| 2. Amara's hours | Amara (Caregiver), then Elena (Organizer) | Bills, `/dashboard/bills` |
| 3. Rose decides | Rose (Parent) | Approvals, `/dashboard/approvals` |
| 4. The payout | Elena (Organizer) | Approvals, then Record |
| 5. Rose hears it | Rose (Parent) | Listen |
| Guardrails | Elena (Organizer) | Ask Kin `/dashboard/ask`, office line `/dashboard/office-line` |
| Money core | Elena (Organizer) | Check the record, `/dashboard/record/verify` |

Seat changes take a second. Cut them out in editing.

---

## Shots

### 0:00 to 0:15 · Hook

- **On screen.** Rose's seat on **Listen**. Her large-type page, with "Kin tells. Kin never asks for secrets." visible. Slow push-in.
- **Narration (40 words).** "This is Rose. She's eighty-one, her eyesight is going, and her money is run by three children and a caregiver, Amara, over group chats. Sixty-three million Americans are family caregivers, spending about seven thousand dollars a year of their own."
- **Caption.** "~63 million US family caregivers · $7,242 a year of their own money (AARP)"

### 0:15 to 0:40 · Moment 1: Marcus tops up the family pool through PayPal

- **On screen.**
  1. Marcus's seat, **Overview**. Click **Add money**. The sheet "Add money to the pool" shows the line "This is PayPal's sandbox: no real money moves."
  2. Pick the $50.00 quick amount and click the **PayPal** button. PayPal's window opens. Sign in as the sandbox buyer (pause the recording for the password) and approve.
  3. The sheet says "PayPal took the payment. Kin is checking it with PayPal…", then "$50.00 is in the pool. PayPal confirmed it, and it is in the record."
  4. Open **Record**. The top row reads "Marcus's contribution", with the tag **PayPal sandbox** and the note "PayPal fee $…". Select the row to show its ledger lines, including **PayPal fees**.
- **Narration (55 words).** "Kin gives the family one shared pool on PayPal. Marcus adds fifty dollars. This is PayPal's real sandbox checkout, not a mock. Kin doesn't trust the browser: it reads the order back from PayPal before it writes the ledger. Here's the row, labelled PayPal sandbox, with PayPal's own fee, which the family shares."
- **Caption.** "Real PayPal sandbox checkout · recorded only after Kin reads the order back from PayPal"

### 0:40 to 1:05 · Moment 2: Amara says her hours, Claude reads them, the server values them

- **On screen.**
  1. Amara's seat, **Bills**. In "Bill for your visits", under "Or describe your visits in your own words", click **Speak your visits** and say: "Monday and Tuesday, four hours each." (Or type it, if the microphone misbehaves.) Click **Fill in the days**.
  2. Kin shows "Kin filled in the days below from your words." with the **Read by Claude** badge. Hover so the two service days of 4 hours each are in frame.
  3. Click **Review bill**. "Check your bill" shows the days, "$22.00 per hour" and the total, $176.00. Click **Submit bill**: "Bill submitted for family review. No payment has been made."
  4. Cut to Elena's seat, **Bills**. On Amara's bill, click **Send for approval**.
- **Narration (50 words).** "Amara says her week the way she'd tell a friend. Claude turns her words into service days, and Kin keeps only the days it can find in what she said. Claude never sees her rate. The server values the hours in whole cents, Amara submits, and Elena sends it for approval."
- **Caption.** "Claude reads the words · plain code does the money · the model never sees the rate"

### 1:05 to 1:25 · Moment 3: Rose approves by voice

- **On screen.**
  1. Rose's seat, **Approvals**. Under "Waiting for a yes", the card "Amara's bill for completed visits", with "Who must say yes: Rose decides above $50.00" and "Your yes is needed".
  2. Click **Hear it and answer by voice**. Kin reads: "…$176.00 to Amara. Do you approve? Say yes or no."
  3. Click **Speak**, say "Yes", click **Stop**. Kin shows "Kin heard yes. Listen, then confirm by voice." Click **Confirm by voice**, say "Yes", click **Stop**.
- **Narration (35 words).** "The family agreement says Rose decides anything above fifty dollars, so Kin asks her, out loud. She says yes, and Kin asks her to confirm. Her answer is kept with who gave it, how and when."
- **Caption.** "Rose's own yes · read back and confirmed · no tap needed"

### 1:25 to 1:45 · Moment 4: Amara is paid

Record the narration that matches what the Record shows. **Claim a real PayPal payout only if the row's tag reads "PayPal sandbox".**

- **On screen.**
  1. Elena's seat, **Approvals**. Scroll to "Answered". Amara's bill reads either "Approved · paid in the demo, with simulated money" or "Approved · paid, as PayPal confirmed". The worker picks up an approved payout within seconds; if it still says it is being paid, wait and cut.
  2. Open **Record**. The new row "Amara: paid" with its tag, **Simulated** or **PayPal sandbox**.
  3. Only if the tag is PayPal sandbox: open the bill on **Bills** to show "PayPal's record of this payout": the payout batch ID and "SUCCESS: PayPal says it was paid".
- **Narration if the tag is "Simulated" (45 words).** "Now the yes becomes money. In a real circle, Kin's worker sends this through PayPal Payouts, and records it only once PayPal reads the payout back as successful. This demo copy pays it with simulated money, and the row says Simulated. Kin never dresses test money up as real."
- **Narration if the tag is "PayPal sandbox" (40 words).** "Now the yes becomes money. Kin's worker sent it through PayPal Payouts, and recorded it only once PayPal read the payout back as successful. Here is PayPal's batch ID. It is the sandbox, so it is test money, and the row says so."
- **Caption.** Simulated: "Paid only after every yes · labelled Simulated in the demo". Sandbox: "PayPal Payouts · read back SUCCESS from PayPal · sandbox test money".

### 1:45 to 2:00 · Moment 5: Rose hears it

- **On screen.** Rose's seat, **Listen**, zoom 125%. Under "How often", choose **As it happens**. Under "Kin will say", the sentence "Amara was paid $176.00 from the family pool." (with "This one is simulated." if it was). Click **Hear it** and let Kin's voice play.
- **Narration (20 words, then let Kin speak).** "And Rose hears it. Not a dashboard: one calm sentence, with every figure taken from the record."
- **Caption.** "Payment events as speech · for a parent who cannot read the screen"

### 2:00 to 2:20 · Guardrails

- **On screen.**
  1. Elena's seat, **Ask Kin** (`/dashboard/ask`, or **Open Ask Kin** on the Overview). Type "Pay Amara now." and click **Ask Kin**. The answer says Kin cannot make payments and that the family answers payments on the Approvals screen. Hold on the line under it, which says who wrote the answer: "Written by Claude (…), every figure checked against the record", or Kin's fixed wording with the reason. Open **How Kin found this**.
  2. Cut to the **office line** (`/dashboard/office-line`, linked from Bills). The example "A scam: unknown gas company, 300 today" is already filled in. Click **Place the call**. Show "What the record says: Matches nothing on record", "Pressure heard" and Kin's reply "I have no record of this account. This family does not make payments by phone."
- **Narration (50 words).** "Claude can read and propose. It can't pay. Ask it to pay Amara now, and it refuses. If its wording ever names a number the record doesn't hold, Kin throws the wording away. And when a caller demands three hundred dollars for gas, plain code checks the record: no such bill."
- **Caption.** Ask Kin: "No tool given to Claude moves money · every figure checked against the record". Office line: "$4.9B lost to elder fraud in 2024 (FBI IC3) · the verdict is plain code, not the model"

### 2:20 to 2:30 · The deterministic money core and the provable record

- **On screen.** Elena's seat, **Record** → **Check the record** (`/dashboard/record/verify`). "The record checks out", "… entries, every check passed", the chain head, and the "Check it yourself" command.
- **Narration (22 words).** "Underneath, the ledger, the fairness and the settlement are plain, deterministic code. Anyone can download the record and re-check it offline."
- **Caption.** "Append-only, balanced ledger · integer cents · `kin-verify` runs offline"

### 2:30 to 2:45 · Close

- **On screen.** Back to Rose's **Listen** page, then the Kin home page with the address on screen.
- **Narration (18 words).** "Kin. Nothing about Mom's money without Mom. PayPal moves every dollar, and Claude stays in its place."
- **Caption.** "Kin · try the demo at mzdg4f3stk.us-east-1.awsapprunner.com · open source, MIT"

---

## If the cut runs over: what to drop, about 30 seconds

Drop these in order until the cut is under 2:55.

1. **Office line (about 8 s).** Keep the Ask Kin refusal and say only "plain code checks every scam demand against the record." Keep the FBI caption on the Ask Kin shot.
2. **Elena's "Send for approval" (about 4 s).** Cut from Amara's "Submit bill" straight to Rose's Approvals card. Drop "and Elena sends it for approval" from the narration.
3. **The ledger lines in shot 1 (about 5 s).** Show the Record row with its tag and fee, and do not open its lines.
4. **"How Kin found this" in the guardrails (about 3 s).**
5. **The money-core shot (about 10 s).** Move its caption onto the Record shot in moment 4.

**If something fails while recording**

- *The voice bill cannot be read* ("Kin cannot read descriptions right now"): type the days into the rows, and say "Amara enters her days" instead of the Claude line.
- *A day is refused* (already billed, in the future, or outside the care agreement): pick other days, or skip moment 2 and approve the seeded card "Amara's visits this week" ($264.00), which already waits for Rose.
- *The microphone does not work on Approvals*: use the **Approve** button and say "Rose says yes".
- *The payout has not landed after a minute*: record moment 5 with an earlier payout sentence, and say nothing about this one being paid.
