import { createHash } from "node:crypto";

import type { CircleSnapshot, ShiftRecord } from "@kin/db";
import { AGREEMENT_FOOTER, HOUSEHOLD_TAX_SOURCE, OUTFLOW_CLASSES, careAgreementClauses, decimalAmount, judgeRate, shiftDay, type OutflowRow } from "@kin/domain";
import { renderPdf, zipStore, type PdfBlock } from "@kin/documents";
import { renderVerdict, type AuditBundle, type VerificationReport } from "@kin/verify";

import { agreementNames } from "@/server/care-agreement";
import { csvRow } from "@/lib/csv-cell";
import type { LookbackView } from "@/content/circle/lookback";
import type { CircleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";

import { englishDay, englishMoney } from "./english";
import type { PacketNote } from "./note";
import type { PaymentProof } from "./proofs";

type PacketInput = {
  readonly circle: CircleSnapshot;
  readonly dictionary: Dictionary;
  readonly names: CircleNames;
  readonly view: LookbackView;
  readonly bundle: AuditBundle;
  readonly report: VerificationReport;
  readonly note: PacketNote;
  readonly proofs: readonly PaymentProof[];
};

const CLASS_TEXT = {
  caregiver_pay: "Caregiver pay",
  third_party_bill: "Bill to a company",
  purchase_for_parent: "Bought for the parent",
  family_transfer: "Money to a family member",
} as const;

const REASON_TEXT = {
  no_agreement: "No care agreement on file for this caregiver",
  agreement_unsigned: "Care agreement not fully signed",
  before_agreement: "Work done before the agreement was signed",
  after_agreement: "Work done after the agreement ended",
  rate_not_agreed: "Paid at a rate the care agreement does not state",
  no_document: "No invoice or order stored with it",
  family_transfer: "Money paid to a relative; the basis is for the attorney to ask about",
} as const;

const MARK_TEXT = {
  unverified_hours: "Hours not proved by a visit",
  simulated: "Simulated money",
  // Kin talks only to PayPal's sandbox (packages/config), so money that went through PayPal is test money.
  paypal: "Went through the PayPal sandbox: test money, no real money moved",
  rate_below_market: "Rate far below the market median",
  rate_above_market: "Rate far above the market median",
} as const;

const STATUS_TEXT = { documented: "Documented", needs_documentation: "Needs documentation", reversed: "Reversed" } as const;

/** One line per payment: what it was, why it lacks paper, and what else to know. */
function notesOf(row: OutflowRow): string {
  return [...row.reasons.map((reason) => REASON_TEXT[reason]), ...row.marks.map((mark) => MARK_TEXT[mark])].join("; ");
}

const stamp = (instant: Date | null, timeZone: string): string =>
  instant === null ? "" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(instant);

/** The aide shifts in the window, with the two keys that prove each one. */
function visitRows(circle: CircleSnapshot, names: CircleNames, from: string): string[][] {
  const { timezone, currency } = circle.circle;
  return circle.shifts
    // Only visits that were carried out: a planned or open shift has no proof to show yet.
    .filter((shift): shift is ShiftRecord & { payeeId: string } => shift.kind === "aide" && shift.payeeId !== null && shift.checkedOutAt !== null && shiftDay(shift.checkedInAt ?? shift.startsAt, timezone) >= from)
    .map((shift) => {
      const keys = shift.checkedInAt !== null && shift.checkedOutAt !== null && shift.familyConfirmedAt !== null;
      return [
        shiftDay(shift.checkedInAt ?? shift.startsAt, timezone),
        names.payee(shift.payeeId),
        stamp(shift.checkedInAt, timezone),
        stamp(shift.checkedOutAt, timezone),
        shift.familyConfirmedBy === null ? "" : `${names.member(shift.familyConfirmedBy)} (${shift.familyConfirmation ?? ""})`,
        shift.workedMinutes === null ? "" : String(shift.workedMinutes),
        shift.cents === null ? "" : decimalAmount({ cents: shift.cents, currency }),
        VISIT_STATE_TEXT[shift.state],
        keys ? "Both keys turned" : "Not both keys",
      ];
    });
}

const VISIT_HEADER = ["Day", "Caregiver", "Checked in", "Checked out", "Confirmed by", "Minutes worked", "Pay", "State", "Proof"];

/** Where each visit's pay stands, in words, so a priced visit is never read as a paid one. */
const VISIT_STATE_TEXT: Readonly<Record<ShiftRecord["state"], string>> = {
  scheduled: "Planned",
  checked_in: "Under way",
  checked_out: "Waiting for the family's word",
  confirmed: "Confirmed, not yet priced",
  priced: "Priced, payment not yet made",
  paid: "Paid",
  credited: "Credited as care time",
  cancelled: "Called off",
};

/** The care agreements, as text a reader can keep beside the PDF. */
function agreementsText(circle: CircleSnapshot, names: CircleNames): string {
  const named = (id: string) => names.member(id);
  const parts = circle.careAgreements.map((agreement) => {
    const terms = { payeeId: agreement.payeeId, caregiverMemberId: agreement.caregiverMemberId, caregiverRelation: agreement.caregiverRelation, duties: agreement.duties, weeklyMinutes: agreement.weeklyMinutes, rateCentsPerHour: agreement.rateCentsPerHour, startsOn: agreement.startsOn, endTerm: agreement.endTerm, endsOn: agreement.endsOn, payer: agreement.payer, state: agreement.usState };
    const lines = careAgreementClauses(terms, agreementNames(circle, terms)).flatMap((clause) => [clause.heading, ...clause.body.map((line) => `  ${line}`), ""]);
    const signed = agreement.signatures.length === 0 ? ["  Not signed yet."] : agreement.signatures.map((signature) => `  ${named(signature.memberId)} signed on ${englishDay(signature.signedOn)} as ${signature.capacity.replace("_", " ")}.`);
    return [`CARE AGREEMENT ${agreement.id}`, `Status: ${agreement.status}${agreement.simulated ? " (demonstration circle: simulated)" : ""}`, "", ...lines, "Signatures", ...signed, "", AGREEMENT_FOOTER].join("\n");
  });
  return parts.length === 0 ? "No care agreement has been written in this circle.\n" : `${parts.join("\n\n----------------------------------------\n\n")}\n`;
}

function lookbackCsv(input: PacketInput): string {
  const { circle, names, view } = input;
  const header = ["Entry", "Paid on", "To", "What it was", "Amount", "Status", "Why", "Simulated"];
  const rows = view.summary.rows.map((row) => [row.entryId, row.occurredOn, names.subject(row.subject), CLASS_TEXT[row.class], decimalAmount({ cents: row.cents, currency: circle.circle.currency }), STATUS_TEXT[row.status], notesOf(row), row.simulated ? "yes" : "no"]);
  return [header, ...rows].map(csvRow).join("\r\n") + "\r\n";
}

function paymentsCsv(input: PacketInput): string {
  const { names, view, proofs } = input;
  const byEntry = new Map(proofs.map((proof) => [proof.entryId, proof]));
  const header = ["Entry", "Paid on", "To", "PayPal payout item", "PayPal transaction", "Transaction Search", "PayPal status", "Amount in PayPal's record", "Left the care account", "Went to"];
  const rows = view.summary.rows.map((row) => {
    const proof = byEntry.get(row.entryId);
    return [
      row.entryId,
      row.occurredOn,
      names.subject(row.subject),
      proof?.itemId ?? "",
      proof?.transactionId ?? "",
      proof?.source ?? "unread",
      proof?.status ?? "",
      proof?.amountCents == null || proof.currency === null ? "" : decimalAmount({ cents: proof.amountCents, currency: proof.currency }),
      proof?.leftThePool == null ? "" : proof.leftThePool ? "yes" : "no",
      proof?.counterparty ?? "",
    ];
  });
  return [header, ...rows].map(csvRow).join("\r\n") + "\r\n";
}

function pdfBlocks(input: PacketInput): PdfBlock[] {
  const { circle, names, view, report, note, proofs } = input;
  const { currency } = circle.circle;
  const { summary } = view;
  const money = (cents: number) => englishMoney(cents, currency);
  const col = (title: string, width: number, align: "left" | "right" = "left") => ({ title, width, align });
  const counted = summary.rows.filter((row) => row.status !== "reversed");
  const provenance = note.provenance.source === "claude" ? `Worded by Claude${note.provenance.model === null ? "" : ` (${note.provenance.model})`}; every number was checked against the record.` : "Fixed wording by Kin; no AI model worded this note.";
  const blocks: PdfBlock[] = [
    { type: "heading", level: 1, text: "Care payments packet" },
    {
      type: "keyValues",
      rows: [
        ["Family circle", circle.circle.name],
        ["Care recipient", names.parent],
        ["Period", `${englishDay(summary.from)} to ${englishDay(summary.to)} (60 months)`],
        ["Record check", report.ok ? `Passed: ${report.entryCount} entries` : "FAILED: see the verification notes below"],
        ["Record head", report.head],
        ...(circle.circle.demo ? ([["Demonstration", "This is a demonstration circle. The money in this packet is simulated unless a line says it went through the PayPal sandbox."]] as const) : []),
      ],
    },
    { type: "paragraph", text: "Prepared for your attorney. Kin sorts and checks the record. It does not say whether anything is allowed, safe or compliant, and the rules differ by state." },
    { type: "heading", level: 2, text: "Cover note" },
    { type: "paragraph", text: note.text },
    { type: "paragraph", text: provenance },
    { type: "heading", level: 2, text: "Summary" },
    {
      type: "table",
      columns: [col("What it was", 3), col("Payments", 1, "right"), col("Paid", 1.4, "right"), col("Needs documentation", 1.6, "right")],
      rows: [
        ...OUTFLOW_CLASSES.map((each) => [CLASS_TEXT[each], String(summary.byClass[each].count), money(summary.byClass[each].cents), money(summary.byClass[each].lackingCents)]),
        ["All", String(counted.length), money(summary.outflowCents), money(summary.lackingCents)],
      ],
    },
    { type: "heading", level: 2, text: "Every payment out of the care account" },
    summary.rows.length === 0
      ? { type: "paragraph", text: "Nothing has left the care account in the last 60 months." }
      : { type: "table", columns: [col("Paid on", 1.2), col("To", 1.6), col("What it was", 1.7), col("Amount", 1.2, "right"), col("Status", 1.5), col("Notes", 3)], rows: summary.rows.map((row) => [englishDay(row.occurredOn), names.subject(row.subject), CLASS_TEXT[row.class], money(row.cents), STATUS_TEXT[row.status], notesOf(row)]) },
    { type: "heading", level: 2, text: "Care agreements" },
  ];
  if (circle.careAgreements.length === 0) blocks.push({ type: "paragraph", text: "No care agreement has been written in this circle." });
  for (const agreement of circle.careAgreements) {
    const terms = { payeeId: agreement.payeeId, caregiverMemberId: agreement.caregiverMemberId, caregiverRelation: agreement.caregiverRelation, duties: agreement.duties, weeklyMinutes: agreement.weeklyMinutes, rateCentsPerHour: agreement.rateCentsPerHour, startsOn: agreement.startsOn, endTerm: agreement.endTerm, endsOn: agreement.endsOn, payer: agreement.payer, state: agreement.usState };
    const { judgement, benchmark } = judgeRate(agreement.rateCentsPerHour, currency);
    blocks.push(
      { type: "keyValues", rows: [["Caregiver", names.member(agreement.caregiverMemberId)], ["Status", agreement.status], ["Rate", `${money(agreement.rateCentsPerHour)} an hour (${judgement === "unknown" || benchmark === null ? "no market figure held" : `${judgement === "near" ? "near" : judgement} the market median of ${englishMoney(benchmark.medianCentsPerHour, benchmark.currency)}`})`], ...agreement.signatures.map((signature) => [`Signed by ${names.member(signature.memberId)}`, `${englishDay(signature.signedOn)}, as ${signature.capacity.replace("_", " ")}`] as const)] },
      ...careAgreementClauses(terms, agreementNames(circle, terms)).flatMap((clause): PdfBlock[] => [{ type: "paragraph", text: clause.heading }, ...clause.body.map((line): PdfBlock => ({ type: "paragraph", text: line }))]),
      { type: "spacer", height: 12 },
    );
  }
  blocks.push({ type: "paragraph", text: AGREEMENT_FOOTER }, { type: "heading", level: 2, text: "Visit proofs" });
  const visits = visitRows(circle, names, summary.from);
  blocks.push(
    visits.length === 0
      ? { type: "paragraph", text: "No paid visit has been recorded in this circle." }
      : { type: "table", columns: [col("Day", 1.1), col("Caregiver", 1.1), col("In", 1.4), col("Out", 1.4), col("Confirmed by", 1.4), col("Min.", 0.6, "right"), col("Pay", 0.9, "right"), col("State", 1.3), col("Proof", 1.1)], rows: visits.map((row) => [row[0] ?? "", row[1] ?? "", row[2] ?? "", row[3] ?? "", row[4] ?? "", row[5] ?? "", row[6] ?? "", row[7] ?? "", row[8] ?? ""]) },
    { type: "heading", level: 2, text: "PayPal's own records" },
    { type: "paragraph", text: "Where the payment went through PayPal, Kin read the transaction back from PayPal's Transaction Search. A negative amount in the care account's own search means the money left that account and not a relative's." },
  );
  const read = proofs.filter((proof) => proof.source === "paypal");
  blocks.push(
    proofs.length === 0
      ? { type: "paragraph", text: "There is no payment to read back." }
      : { type: "table", columns: [col("Paid on", 1.1), col("Transaction", 2), col("Search", 1.1), col("Status", 0.8), col("Amount", 1.2, "right"), col("Left the account", 1.2), col("Went to", 2)], rows: summary.rows.map((row) => { const proof = proofs.find((each) => each.entryId === row.entryId); return [englishDay(row.occurredOn), proof?.transactionId ?? proof?.itemId ?? "", proof?.source ?? "unread", proof?.status ?? "", proof?.amountCents == null || proof.currency === null ? "" : englishMoney(proof.amountCents, proof.currency), proof?.leftThePool == null ? "" : proof.leftThePool ? "yes" : "no", proof?.counterparty ?? ""]; }) },
    { type: "paragraph", text: `${read.length} of ${proofs.length} payments were read back from PayPal. "simulated" means no PayPal transaction stands behind the payment; "unread" means PayPal could not be read when this packet was made; "not_yet_listed" means a payment from today or yesterday that PayPal's search did not list yet, which PayPal says can take up to three hours, so download the packet again later; "not_found" means an older payment PayPal's search did not list.` },
    { type: "heading", level: 2, text: "What a household employer may owe" },
    { type: "paragraph", text: "An estimate for the family's accountant, from the cash paid to each caregiver. Kin does not file anything and does not say the family complies." },
  );
  blocks.push(
    view.estimates.length === 0
      ? { type: "paragraph", text: "No caregiver was paid in these years." }
      : { type: "table", columns: [col("Caregiver", 1.8), col("Year", 0.7), col("Paid", 1.2, "right"), col("Threshold", 1.3), col("Soc. Sec.", 1.1, "right"), col("Medicare", 1.1, "right"), col("Unemp.", 1, "right"), col("Estimate", 1.1, "right")], rows: view.estimates.map((estimate) => [estimate.employee, String(estimate.year), money(estimate.wagesCents), !estimate.known ? "No table" : estimate.aboveThreshold ? "Reached" : "Under", estimate.known ? money(estimate.socialSecurityCents) : "-", estimate.known ? money(estimate.medicareCents) : "-", estimate.known ? money(estimate.futaCents) : "-", estimate.known ? money(estimate.totalCents) : "-"]) },
    { type: "paragraph", text: `Figures: ${HOUSEHOLD_TAX_SOURCE}. Check them against the publication before relying on them. Wages to the employer's spouse, or to the employer's child under 21, may be exempt from Social Security and Medicare tax; the estimate does not know the relation.` },
    { type: "heading", level: 2, text: "Checking the record" },
    { type: "monoLines", lines: renderVerdict(report).split("\n") },
  );
  return blocks;
}

function readme(input: PacketInput, today: string): string {
  const { report } = input;
  return [
    "KIN CARE PAYMENTS PACKET",
    `Made on ${englishDay(today)} for the family circle "${input.circle.circle.name}".`,
    "",
    "Prepared for your attorney. Kin sorts and checks the record. It does not say whether anything is allowed, safe or compliant. Rules differ by state.",
    "",
    "FILES",
    "  packet.pdf               Cover note, every payment of the last 60 months, care agreements, visit proofs, PayPal's records, estimate.",
    "  care-agreements.txt      The text of each agreement, who signed it and when.",
    "  look-back.csv            The same payment list, for a spreadsheet.",
    "  visit-proofs.csv         Each paid visit with the caregiver's check-in and out and the family's confirmation.",
    "  paypal-payments.csv      What PayPal's Transaction Search says about each payment.",
    "  record/kin-record.json   The circle's record with its hash chain, checkable offline.",
    "  manifest.json            A SHA-256 fingerprint of every file here.",
    "",
    "CHECKING THE RECORD YOURSELF",
    `  Entries: ${report.entryCount}`,
    `  Head:    ${report.head}`,
    "  The verifier is open source (packages/verify in the Kin repository). With the repository checked out:",
    "    pnpm --filter @kin/verify run kin-verify record/kin-record.json",
    "  It needs no account and no network, and does not ask you to trust Kin. Write the head down: any later export must still contain it.",
    "",
  ].join("\n");
}

const encoder = new TextEncoder();
const sha256 = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

/**
 * The packet as one ZIP: a PDF for the attorney, spreadsheets, the verifiable
 * record, and a manifest with the SHA-256 of every file so nothing can be
 * swapped quietly. The PDF, the CSVs and the text are all made from the same
 * `PacketData`, so they can never disagree with the screen or with each other.
 */
export function buildPacket(input: PacketInput, today: string, now: Date): { readonly zip: Uint8Array; readonly fileName: string } {
  const folder = `kin-care-packet-${today}`;
  const files: { name: string; data: Uint8Array }[] = [
    { name: "packet.pdf", data: renderPdf({ title: "Care payments packet", author: "Kin", created: now, footer: `Kin care payments packet, ${input.circle.circle.name}`, blocks: pdfBlocks(input) }) },
    { name: "care-agreements.txt", data: encoder.encode(agreementsText(input.circle, input.names)) },
    { name: "look-back.csv", data: encoder.encode(lookbackCsv(input)) },
    { name: "visit-proofs.csv", data: encoder.encode([VISIT_HEADER.map((cell) => cell), ...visitRows(input.circle, input.names, input.view.summary.from)].map(csvRow).join("\r\n") + "\r\n") },
    { name: "paypal-payments.csv", data: encoder.encode(paymentsCsv(input)) },
    { name: "record/kin-record.json", data: encoder.encode(JSON.stringify(input.bundle, null, 2)) },
    { name: "README.txt", data: encoder.encode(readme(input, today)) },
  ];
  const manifest = { generatedOn: today, files: files.map((file) => ({ name: file.name, sha256: sha256(file.data), bytes: file.data.length })) };
  files.push({ name: "manifest.json", data: encoder.encode(JSON.stringify(manifest, null, 2)) });
  return { zip: zipStore(files.map((file) => ({ name: `${folder}/${file.name}`, data: file.data })), now), fileName: `${folder}.zip` };
}
