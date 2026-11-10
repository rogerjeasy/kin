import { wishChainHolds, type CircleSnapshot } from "@kin/db";

import { wishReadBack } from "@/components/dashboard/words/wish-words";
import { wishNameBook } from "@/content/circle/wishes";
import type { Dictionary } from "@/i18n/dictionary";
import { csvRow } from "@/lib/csv-cell";

import { englishDay, englishMoney } from "./english";

const AND = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** The parent's wishes for the attorney, in English: each version, what it does, who confirmed and witnessed it, and whether every seal checks. */
export function wishesText(circle: CircleSnapshot, english: Dictionary): string {
  const copy = english.dashboard.wishes;
  const book = wishNameBook(circle);
  const format = { money: (cents: number) => englishMoney(cents, circle.circle.currency), allOf: (items: readonly string[]) => AND.format(items) };
  const wishes = circle.wishes.wishes;
  if (wishes.length === 0) return `${book.parent} has not recorded any wishes in Kin.\n`;
  const parts = wishes.map((wish) => {
    const { when, does } = wishReadBack(copy, book, format, wish, "she");
    const signatures = wish.signatures.map((signature) => `  ${book.members[signature.memberId] ?? signature.memberId} ${signature.capacity === "parent" ? "confirmed it" : "witnessed it"} on ${englishDay(signature.at.toISOString().slice(0, 10))} (${signature.method}).`);
    return [
      `WISH ${wish.wishKey}, VERSION ${wish.version}`,
      `Status: ${wish.state}${wish.simulated ? " (demonstration circle: simulated)" : ""}`,
      `${book.parent} said on ${englishDay(wish.saidOn)}: "${wish.quote}"`,
      `Recording: ${wish.recordingId === null ? "none; her words are read aloud by Kin's voice" : "her own voice, kept by Kin"}`,
      `${when}: ${does}`,
      "Signatures",
      ...(signatures.length === 0 ? ["  None yet."] : signatures),
      `Seal (SHA-256): ${wish.digest}`,
      `Seal of the version before: ${wish.previousDigest ?? "none, this is the first version"}`,
    ].join("\n");
  });
  const chain = wishChainHolds(wishes) ? copy.packet.chain : copy.packet.chainBroken;
  return `${[`${book.parent.toUpperCase()}'S WISHES`, copy.legal, chain, ""].join("\n")}\n${parts.join("\n\n----------------------------------------\n\n")}\n`;
}

/** Every version of every wish, one row each, for a spreadsheet. */
export function wishesCsv(circle: CircleSnapshot): string {
  const book = wishNameBook(circle);
  const header = ["Wish", "Version", "Said on", "Her words", "Applies", "Rule", "Status", "Witnesses", "Seal", "Seal before", "Simulated"];
  const rows = circle.wishes.wishes.map((wish) => [
    wish.wishKey,
    String(wish.version),
    wish.saidOn,
    wish.quote,
    wish.trigger,
    wish.rule.kind,
    wish.state,
    wish.signatures.filter((signature) => signature.capacity === "witness").map((signature) => book.members[signature.memberId] ?? signature.memberId).join("; "),
    wish.digest,
    wish.previousDigest ?? "",
    wish.simulated ? "yes" : "no",
  ]);
  return [header, ...rows].map(csvRow).join("\r\n") + "\r\n";
}
