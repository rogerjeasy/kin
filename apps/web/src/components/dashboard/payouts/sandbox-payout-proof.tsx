import { CopyIdButton } from "@/components/dashboard/record/copy-id-button";
import { Tag } from "@/components/shared/tag";
import type { PayoutProof } from "@/content/circle/payout-proof";
import type { Dictionary } from "@/i18n/dictionary";

type Props = { proof: PayoutProof; copy: Dictionary["sandboxPayout"] };

/**
 * The proof that PayPal's sandbox made a payout: the "PayPal sandbox" label,
 * PayPal's own batch and item IDs to look up, and the status Kin read back
 * from PayPal. Always says it is test money. A simulated payout has no proof,
 * so it keeps its "Simulated" label and never shows this.
 */
export function SandboxPayoutProof({ proof, copy }: Props) {
  return (
    <section aria-label={copy.title} className="mt-2 min-w-0 rounded-lg border border-dashed p-3 text-sm">
      <p className="flex flex-wrap items-center gap-2">
        <Tag className="py-0.5">{copy.tag}</Tag>
        <span className="text-muted-foreground text-pretty">{copy.testMoney}</span>
      </p>
      <dl className="mt-2 grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <dt className="text-muted-foreground">{copy.status}</dt>
        <dd className="min-w-0 font-medium break-words">{copy.states[proof.state]}</dd>
        <ProofId term={copy.batch} id={proof.batchId} button={copy.copyBatch} copy={copy} />
        {proof.itemId === null ? null : <ProofId term={copy.item} id={proof.itemId} button={copy.copyItem} copy={copy} />}
      </dl>
    </section>
  );
}

function ProofId({ term, id, button, copy }: { term: string; id: string; button: string; copy: Dictionary["sandboxPayout"] }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="min-w-0 font-mono text-xs break-all">{id}</code>
        <CopyIdButton id={id} copy={{ copyId: button, copied: copy.copied, copyFailed: copy.copyFailed }} />
      </dd>
    </>
  );
}
