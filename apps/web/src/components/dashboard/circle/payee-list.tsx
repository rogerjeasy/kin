import { StatusPill } from "@/components/dashboard/ui/status-pill";

export type PayeeItem = { id: string; name: string; category: string; status: { text: string; isNew: boolean }; rule: string };

/** Who money may leave the pool to, and on what terms. */
export function PayeeList({ payees }: { payees: readonly PayeeItem[] }) {
  return (
    <ul className="divide-y border-t">
      {payees.map((payee) => (
        <li key={payee.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
          <div className="min-w-0">
            <p className="font-medium">{payee.name}</p>
            <p className="text-sm text-muted-foreground">
              {payee.category} · {payee.rule}
            </p>
          </div>
          <StatusPill tone={payee.status.isNew ? "waiting" : "positive"}>{payee.status.text}</StatusPill>
        </li>
      ))}
    </ul>
  );
}
