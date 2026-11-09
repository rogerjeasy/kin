import type { AgreementClause } from "@kin/domain";

/** The agreement's clauses as a reader sees them: English, fixed wording, one heading to a clause. */
export function AgreementText({ clauses, footer }: { clauses: readonly AgreementClause[]; footer: string }) {
  return (
    <div lang="en" dir="ltr" className="space-y-4 text-sm">
      {clauses.map((clause) => (
        <section key={clause.heading} className="space-y-1.5">
          <h4 className="font-semibold">{clause.heading}</h4>
          {clause.body.map((line) => (
            <p key={line} className="text-pretty">
              {line}
            </p>
          ))}
        </section>
      ))}
      <p className="border-t pt-3 text-xs text-muted-foreground">{footer}</p>
    </div>
  );
}
