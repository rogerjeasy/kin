import { PAYOUT_RECORD } from "@/content/example-family";

type RecordLineProps = {
  /** The amount as the record holds it, formatted. */
  amount: string;
  biller: string;
};

/** One line of PayPal's record: the status, the amount and who was paid. */
export function RecordLine({ amount, biller }: RecordLineProps) {
  return (
    <>
      {/* PayPal's own status word, read back from the payout batch. It is the same in every language. */}
      <code dir="ltr" className="block font-mono text-sm break-all">{PAYOUT_RECORD}</code>
      <span className="block font-mono text-sm">
        {amount} · {biller}
      </span>
    </>
  );
}
