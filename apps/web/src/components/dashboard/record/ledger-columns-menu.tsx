import { Columns3Icon } from "lucide-react";

import type { GridCopy } from "@/components/data-grid/data-grid";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { CHOOSABLE_COLUMNS } from "./ledger-columns";
import type { LedgerColumnId } from "./ledger-columns-ids.ts";

type LedgerColumnsMenuProps = {
  copy: GridCopy["toolbar"];
  /** The ids of the columns now hidden. */
  hidden: readonly string[];
  /** The names the columns carry in the grid's headings. */
  names: ReadonlyMap<string, string>;
  onChange: (columnId: LedgerColumnId, visible: boolean) => void;
};

/** Chooses which columns the grid shows. The menu stays open while a person ticks several. */
export function LedgerColumnsMenu({ copy, hidden, names, onChange }: LedgerColumnsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full sm:w-auto">
          <Columns3Icon aria-hidden="true" />
          {copy.columns}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{copy.columnsLabel}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {CHOOSABLE_COLUMNS.map((columnId) => (
          <DropdownMenuCheckboxItem
            key={columnId}
            checked={!hidden.includes(columnId)}
            onCheckedChange={(visible) => onChange(columnId, visible === true)}
            onSelect={(event) => event.preventDefault()}
            className="min-h-11"
          >
            {names.get(columnId) ?? columnId}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
