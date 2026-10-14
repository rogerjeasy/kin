import { PAYOUT_EVENT } from "@/content/example-family";

type RecordLineProps = {
  /** The amount as the record holds it, formatted. */
  amount: string;
  biller: string;
};

/** One line of PayPal's record: the event, the amount and who was paid. */
export function RecordLine({ amount, biller }: RecordLineProps) {
  return (
    <>
      {/* PayPal's own event name. It is the same in every language. */}
      <code dir="ltr" className="block font-mono text-sm break-all">{PAYOUT_EVENT}</code>
      <span className="block font-mono text-sm">
        {amount} · {biller}
      </span>
    </>
  );
}
