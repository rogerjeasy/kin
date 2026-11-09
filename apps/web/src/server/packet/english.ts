import { formatMoney } from "@kin/domain";

/**
 * The packet and the agreement are written in English, the language an
 * attorney reads, whatever language the family's screens are in. Money goes
 * through the one shared formatter; a day is a calendar day, never shifted.
 */
export function englishMoney(cents: number, currency: string): string {
  return formatMoney({ cents, currency }, "en-US");
}

const DAY = new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function englishDay(iso: string): string {
  return DAY.format(new Date(`${iso}T00:00:00Z`));
}
