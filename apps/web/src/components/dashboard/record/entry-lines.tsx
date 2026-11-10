export type EntryLineRow = { account: string; debit: string; credit: string };

type EntryLinesProps = { caption: string; headers: { account: string; debit: string; credit: string }; lines: readonly EntryLineRow[] };

/** The double-entry lines behind one entry. Debits and credits always total the same. */
export function EntryLines({ caption, headers, lines }: EntryLinesProps) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-xs tracking-wide text-muted-foreground uppercase">
          <th scope="col" className="py-1.5 pe-3 text-start font-medium">{headers.account}</th>
          <th scope="col" className="py-1.5 px-3 text-end font-medium">{headers.debit}</th>
          <th scope="col" className="py-1.5 ps-3 text-end font-medium">{headers.credit}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/70">
        {lines.map((line, index) => (
          <tr key={index}>
            <td className="py-1.5 pe-3 break-words">{line.account}</td>
            <td className="py-1.5 px-3 text-end whitespace-nowrap tabular-nums">{line.debit}</td>
            <td className="py-1.5 ps-3 text-end whitespace-nowrap tabular-nums">{line.credit}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
