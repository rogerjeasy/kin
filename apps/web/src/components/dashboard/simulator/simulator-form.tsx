import Link from "next/link";

import { Field, inputClass } from "@/components/dashboard/create-circle/field";
import { Panel } from "@/components/dashboard/ui/panel";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Props = {
  copy: Dictionary["dashboard"]["simulator"];
  currency: string;
  /** Where the form is answered: this page again, with the what-if in its address. */
  resetHref: string;
  /** The members who hold a share, each with the text the field starts from. */
  members: readonly { id: string; name: string; share: string }[];
  leaving: string;
  bill: string;
};

/**
 * The what-if inputs. A plain GET form: the rehearsal is read from the address,
 * so a result can be shared or reopened and nothing is stored.
 */
export function SimulatorForm({ copy, currency, resetHref, members, leaving, bill }: Props) {
  return (
    <Panel title={copy.formTitle} description={copy.formText}>
      <form method="get" className="min-w-0 space-y-6">
        <fieldset className="min-w-0 space-y-4">
          <legend className="font-semibold">{copy.shareLegend}</legend>
          <p className="text-sm text-muted-foreground">{copy.shareHint}</p>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <Field key={member.id} id={`sim-share-${member.id}`} label={fill(copy.shareLabel, { name: member.name })}>
                <input id={`sim-share-${member.id}`} name={`share.${member.id}`} type="text" inputMode="decimal" maxLength={6} defaultValue={member.share} className={inputClass} />
              </Field>
            ))}
          </div>
        </fieldset>
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field id="sim-leaving" label={copy.leavingLabel}>
            <select id="sim-leaving" name="leaving" defaultValue={leaving} className={inputClass}>
              <option value="">{copy.leavingNone}</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </Field>
          <Field id="sim-bill" label={copy.billLabel} hint={fill(copy.billHint, { currency })}>
            <input id="sim-bill" name="bill" type="text" inputMode="decimal" maxLength={16} defaultValue={bill} aria-describedby="sim-bill-hint" className={inputClass} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" name="run" value="1" className="min-h-11">
            {copy.run}
          </Button>
          <Button asChild variant="outline" className="min-h-11">
            <Link href={resetHref}>{copy.reset}</Link>
          </Button>
        </div>
      </form>
    </Panel>
  );
}
