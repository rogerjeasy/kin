import type { GridCopy } from "@/components/data-grid/data-grid";

import { CopyIdButton } from "./copy-id-button";
import type { LedgerRow } from "./ledger-row.ts";

type EntryFactsProps = { item: LedgerRow; copy: GridCopy["detail"] };

/**
 * What proves an entry: its ID, what caused it (a PayPal event, an approval
 * or a settlement) and that cause's own ID, and the entry it cancels, if it
 * is a reversal. The label beside the source says whether real sandbox money
 * stands behind it or it is simulated.
 */
export function EntryFacts({ item, copy }: EntryFactsProps) {
  return (
    <div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
        <Fact term={copy.source} detail={`${item.source} · ${item.tags.join(", ")}`} />
        <Fact term={copy.reference} detail={item.sourceId} code />
        <Fact term={copy.id} detail={item.id} code />
        {item.reverses ? <Fact term={copy.reverses} detail={item.reverses} code /> : null}
      </dl>
      <div className="mt-3">
        <CopyIdButton id={item.id} copy={copy} />
      </div>
    </div>
  );
}

function Fact({ term, detail, code = false }: { term: string; detail: string; code?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className={code ? "min-w-0 font-mono text-xs break-all" : "min-w-0 break-words"}>{detail}</dd>
    </>
  );
}
