import type { Dictionary } from "@/i18n/dictionary";

type CapabilityTableProps = { copy: Dictionary["howItWorks"]["paypal"] };

/** What the family needs, beside the PayPal capability that does it. */
export function CapabilityTable({ copy }: CapabilityTableProps) {
  return (
    <table className="w-full table-fixed border-collapse text-start">
      <thead>
        <tr className="border-b text-sm text-muted-foreground">
          <th scope="col" className="py-3 pe-4 text-start font-medium">{copy.needHeader}</th>
          <th scope="col" className="py-3 text-start font-medium">{copy.capabilityHeader}</th>
        </tr>
      </thead>
      <tbody>
        {copy.rows.map((row) => (
          <tr key={row.need} className="border-b align-top">
            <th scope="row" className="py-4 pe-4 text-start font-normal wrap-break-word">{row.need}</th>
            <td className="py-4 font-semibold wrap-break-word">{row.capability}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
