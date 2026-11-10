import type { ToolOutput } from "@kin/agent";

import { fill } from "@/i18n/template";

import { askPurse } from "../purse-actions";
import type { AskKinWorld } from "./world";

/**
 * Ask Kin's way to the parent's Purse: it raises a payment through the same
 * path as her Purse screen, so the same plain code finds the payee in her
 * book, reads the amount and decides whether it goes, waits or is refused.
 * Nothing is paid: Kin reads it back and it waits for her own yes on her Purse
 * screen. Only the parent is ever offered the tool; the boundary and the
 * database refuse anyone else again.
 */
export async function proposeGift(world: AskKinWorld, args: { readonly payee: string; readonly amount: string; readonly memo?: string }, question: string): Promise<ToolOutput> {
  const { copy, format } = world;
  const result = await askPurse(
    { db: world.db, userId: world.userId, circle: world.circle },
    // Her own question, from the request, is what the Purse reads for pressure and is kept with the payment; the model's arguments only name who and how much.
    { words: question.trim() === "" ? [args.payee, args.amount, args.memo].filter((each) => each !== undefined).join(" ") : question, locale: world.locale, payee: args.payee, amount: args.amount, memo: args.memo ?? null },
  );
  if (!result.ok || result.payment === undefined) {
    const reason = result.ok ? "unavailable" : result.reason;
    return { data: { proposed: false, reason }, fact: reason === "no_purse" ? copy.facts.giftNoPurse : copy.facts.giftRefused };
  }
  const { payment } = result;
  const held = payment.holdReasons.length > 0;
  const values = { payee: payment.payeeName, amount: format.money(payment.cents) };
  return {
    data: { proposed: true, payee: payment.payeeName, amount: values.amount, readBack: payment.readBack, waitsFor: "her own yes on her Purse screen", held, reasons: [...payment.holdReasons], simulated: payment.simulated },
    fact: fill(held ? copy.facts.giftHeld : copy.facts.giftProposed, values),
    proposal: { id: payment.id, kind: "purse_payment" },
  };
}
