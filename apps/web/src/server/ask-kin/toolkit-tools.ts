import type { JsonValue, ToolOutput } from "@kin/agent";
import type { InvoiceRequestRecord } from "@kin/db";
import { sumCents, type Money } from "@kin/domain";
import { ToolkitError, type AgentToolkitReads, type Dispute } from "@kin/paypal";

import { recordEntries, type EntryView } from "@/content/circle/record";
import { fill } from "@/i18n/template";

import { named, type AskKinWorld, type PayPalReader } from "./world";

/**
 * Ask Kin's tools that read PayPal through PayPal's own Agent Toolkit.
 *
 * Scoping to the circle: the model never gives a PayPal ID. It names a member
 * at most, and the ID comes from the circle's record as row-level security
 * let this person read it: a top-up's capture from its ledger entry (its order
 * from that capture, read back from PayPal), an invoice from Kin's request.
 * PayPal's answer is then shown only if it names this circle again: the
 * order's `custom_id` and capture, the invoice's memo and request, a
 * dispute's disputed transaction. The pool is one PayPal account for every
 * circle, so a toolkit tool that lists across it (transactions) is not exposed.
 * Only PayPal's fixed status words, amounts Kin formats and times reach the
 * model; never a name, an email, a note or a buyer's message.
 */

const VIA = "PayPal Agent Toolkit";
/** Top-ups checked for disputes, and PayPal reads per call, so one question cannot fan out. */
const NEWEST = 3;
const READS = 6;
const SIMULATED = "simulated: no PayPal record stands behind it, so PayPal was not asked";
const NOT_READ = { read: false, why: "PayPal could not be read just now" } as const;
const NOT_THIS_CIRCLE = { read: false, why: "PayPal's answer does not name this circle's record, so Kin shows none of it" } as const;
const NO_PAYPAL = { read: false, why: "this deployment has no PayPal app, so PayPal was not read" } as const;

type Toolkit = { readonly paypal: PayPalReader; readonly toolkit: AgentToolkitReads };

function toolkitOf(world: AskKinWorld): Toolkit | null {
  const paypal = world.paypal;
  return paypal === null || paypal.toolkit === null ? null : { paypal, toolkit: paypal.toolkit };
}

/** A failed read, for operators: the method and reason only, never PayPal's text. */
function logged(error: unknown): typeof NOT_READ {
  const detail = error instanceof ToolkitError ? { reason: error.reason, status: error.status } : { reason: "error" };
  console.error(JSON.stringify({ message: "ask_kin.paypal_toolkit", ...detail }));
  return NOT_READ;
}

/**
 * Whether the person asked about this member: by name, "me" for themselves, or
 * anyone. A member's whole name matches however short it is ("Ana"), which the
 * claim check's looser `sameName` refuses for names under four letters.
 */
function whose(world: AskKinWorld, asked: string | undefined, memberId: string): boolean {
  if (asked === undefined) return true;
  if (/^\s*me\s*$/iu.test(asked)) return memberId === world.circle.viewer.memberId;
  const name = world.names.subject(memberId);
  return name.toLocaleLowerCase() === asked.trim().toLocaleLowerCase() || named(asked, name);
}

const isReal = (view: EntryView) => !view.entry.simulated && view.entry.source.type === "paypal_event";

function topUpsOf(world: AskKinWorld, asked: string | undefined): EntryView[] {
  return recordEntries(world.circle).filter((view) => view.entry.kind === "contribution" && view.entry.reverses === null && whose(world, asked, view.subject));
}

function moneyIn(world: AskKinWorld, money: Money | null): string | null {
  return money === null || money.currency !== world.circle.circle.currency ? null : world.format.money(money.cents);
}

function topUpRow(world: AskKinWorld, view: EntryView) {
  return { member: world.names.subject(view.subject), amount: world.format.money(view.cents), day: world.format.day(view.entry.occurredOn), simulated: view.entry.simulated };
}

/** The words of a row a fixed sentence names. */
const wordsOf = (row: { readonly member: string; readonly amount: string; readonly day?: string }) => ({ member: row.member, amount: row.amount, day: row.day ?? "" });

async function orderRecord(world: AskKinWorld, reads: Toolkit, view: EntryView): Promise<JsonValue> {
  const circleId = world.circle.circle.id;
  const captureId = view.entry.source.id;
  try {
    const capture = await reads.paypal.getCapture(captureId);
    if (capture.reference !== null && capture.reference.circleId !== circleId) return NOT_THIS_CIRCLE;
    if (capture.orderId === null) return { read: true, capture: capture.status, order: capture.invoiceId === null ? "PayPal names no order for it" : "paid through a PayPal invoice, not an order" };
    const order = await reads.toolkit.getOrder(capture.orderId);
    if (order.reference?.circleId !== circleId || !order.captures.some((each) => each.id === captureId)) return NOT_THIS_CIRCLE;
    return {
      read: true,
      orderId: order.id,
      status: order.status,
      amount: moneyIn(world, order.amount),
      created: order.createdAt === null ? null : world.format.dateTime(order.createdAt),
      updated: order.updatedAt === null ? null : world.format.dateTime(order.updatedAt),
      captures: order.captures.map((each) => ({ status: each.status, amount: moneyIn(world, each.gross) })),
      matchesTheRecord: order.amount?.cents === view.cents && order.amount.currency === world.circle.circle.currency,
    };
  } catch (error) {
    return logged(error);
  }
}

/** PayPal's record of the newest real top-up, through the toolkit's get_order. */
export async function paypalOrder(world: AskKinWorld, member: string | undefined): Promise<ToolOutput> {
  const { copy } = world;
  const topUps = topUpsOf(world, member);
  const view = topUps.find(isReal) ?? topUps[0];
  if (view === undefined) return { data: { readThrough: VIA, topUp: null }, fact: copy.facts.topUpNone };
  const row = topUpRow(world, view);
  if (!isReal(view)) return { data: { readThrough: VIA, topUp: row, paypal: null, note: SIMULATED }, fact: fill(copy.facts.paypalOrderSimulated, wordsOf(row)) };
  const reads = toolkitOf(world);
  const paypal = reads === null ? NO_PAYPAL : await orderRecord(world, reads, view);
  const status = typeof paypal === "object" && paypal !== null && "status" in paypal && typeof paypal.status === "string" ? paypal.status : null;
  return { data: { readThrough: VIA, topUp: row, paypal }, fact: status === null ? copy.facts.paypalUnread : fill(copy.facts.paypalOrder, { ...wordsOf(row), status }) };
}

/** PayPal's record of the newest invoice Kin sent, through the toolkit's get_invoice. */
export async function paypalInvoice(world: AskKinWorld, member: string | undefined): Promise<ToolOutput> {
  const { copy, format, names } = world;
  const requests = world.circle.invoiceRequests.filter((request) => whose(world, member, request.memberId));
  const request: InvoiceRequestRecord | undefined = requests.find((each) => !each.simulated && each.paypalInvoiceId !== null) ?? requests[0];
  if (request === undefined) return { data: { readThrough: VIA, request: null }, fact: copy.facts.paypalInvoiceNone };
  const row = { member: names.member(request.memberId), amount: format.money(request.cents), asked: format.dateTime(request.createdAt), state: request.state, simulated: request.simulated };
  const invoiceId = request.paypalInvoiceId;
  if (request.simulated || invoiceId === null) return { data: { readThrough: VIA, request: row, paypal: null, note: SIMULATED }, fact: fill(copy.facts.paypalInvoiceSimulated, wordsOf(row)) };
  const reads = toolkitOf(world);
  if (reads === null) return { data: { readThrough: VIA, request: row, paypal: NO_PAYPAL }, fact: copy.facts.paypalUnread };
  try {
    const invoice = await reads.toolkit.getInvoice(invoiceId);
    if (invoice.id !== invoiceId || invoice.reference?.circleId !== world.circle.circle.id || invoice.reference.requestId !== request.id) {
      return { data: { readThrough: VIA, request: row, paypal: NOT_THIS_CIRCLE }, fact: copy.facts.paypalUnread };
    }
    const paid = invoice.payments.filter((payment) => payment.amount.currency === invoice.amount.currency);
    const paypal = {
      read: true,
      number: invoice.number,
      status: invoice.status,
      amount: moneyIn(world, invoice.amount),
      paid: moneyIn(world, { cents: sumCents(paid.map((payment) => payment.amount.cents)), currency: invoice.amount.currency }),
      matchesTheRecord: invoice.amount.cents === request.cents,
    };
    return { data: { readThrough: VIA, request: row, paypal }, fact: fill(copy.facts.paypalInvoice, { ...wordsOf(row), status: invoice.status }) };
  } catch (error) {
    return { data: { readThrough: VIA, request: row, paypal: logged(error) }, fact: copy.facts.paypalUnread };
  }
}

function disputeRow(world: AskKinWorld, dispute: Dispute) {
  return { status: dispute.status, reason: dispute.reason, amount: moneyIn(world, dispute.amount), opened: dispute.createdAt === null ? null : world.format.dateTime(dispute.createdAt) };
}

/**
 * The disputes on the newest real top-ups, through the toolkit's list_disputes
 * and get_dispute. A list's summary names no transaction, so each dispute is
 * read by its ID and kept only if it names that top-up's capture.
 */
export async function paypalDisputes(world: AskKinWorld): Promise<ToolOutput> {
  const { copy } = world;
  const topUps = topUpsOf(world, undefined);
  const real = topUps.filter(isReal).slice(0, NEWEST);
  if (real.length === 0) return { data: { readThrough: VIA, checked: [], note: topUps.length === 0 ? "no top-ups" : SIMULATED }, fact: topUps.length === 0 ? copy.facts.topUpNone : copy.facts.paypalDisputesSimulated };
  const reads = toolkitOf(world);
  if (reads === null) return { data: { readThrough: VIA, checked: [], paypal: NO_PAYPAL }, fact: copy.facts.paypalUnread };
  let budget = READS;
  let unread = false;
  let first: { readonly member: string; readonly amount: string; readonly status: string } | null = null;
  const checked = [];
  for (const view of real) {
    const row = topUpRow(world, view);
    const captureId = view.entry.source.id;
    if (budget <= 0) {
      checked.push({ ...row, paypal: "not read: the limit of PayPal reads for this question" });
      continue;
    }
    try {
      budget -= 1;
      const listed = await reads.toolkit.listDisputes(captureId);
      const disputes = [];
      let notShown = 0;
      for (const summary of listed) {
        if (budget <= 0) {
          notShown += 1;
          continue;
        }
        budget -= 1;
        const dispute = await reads.toolkit.getDispute(summary.id);
        if (dispute.sellerTransactionIds.includes(captureId)) disputes.push(disputeRow(world, dispute));
        else notShown += 1;
      }
      const [found] = disputes;
      if (first === null && found !== undefined) first = { member: row.member, amount: row.amount, status: found.status };
      checked.push({ ...row, disputes, ...(notShown > 0 ? { notShown, why: "PayPal listed disputes Kin could not tie to this top-up, so Kin shows none of them" } : {}) });
    } catch (error) {
      unread = true;
      checked.push({ ...row, paypal: logged(error).why });
    }
  }
  const fact = first !== null ? fill(copy.facts.paypalDispute, first) : unread ? copy.facts.paypalUnread : copy.facts.paypalDisputesNone;
  return { data: { readThrough: VIA, checked }, fact };
}
