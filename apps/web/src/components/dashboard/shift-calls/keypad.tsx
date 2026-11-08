import { Button } from "@/components/ui/button";

type Props = { label: string; yes: string; no: string; disabled: boolean; onYes: () => void; onNo: () => void };

/** The two keys a person presses on the real call: 1 for yes, 2 for no. Large, since the parent may see little. */
export function Keypad({ label, yes, no, disabled, onYes, onNo }: Props) {
  return (
    <div role="group" aria-label={label} className="grid min-w-0 grid-cols-1 gap-3 min-[400px]:grid-cols-2">
      <Button type="button" disabled={disabled} onClick={onYes} className="h-auto min-h-16 whitespace-normal px-4 py-3 text-lg">
        {yes}
      </Button>
      <Button type="button" variant="outline" disabled={disabled} onClick={onNo} className="h-auto min-h-16 whitespace-normal px-4 py-3 text-lg">
        {no}
      </Button>
    </div>
  );
}
