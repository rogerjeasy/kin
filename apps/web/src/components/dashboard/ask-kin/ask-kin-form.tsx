import { SendIcon } from "lucide-react";
import { useId, type FormEvent } from "react";

import { inputClass } from "@/components/dashboard/create-circle/field";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

type Props = {
  value: string;
  busy: boolean;
  maxLength: number;
  copy: Dictionary["askKin"]["form"];
  onChange: (value: string) => void;
  onAsk: () => void;
};

/** The question box. Enter alone asks; Shift and Enter starts a new line. */
export function AskKinForm({ value, busy, maxLength, copy, onChange, onAsk }: Props) {
  const id = useId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && value.trim() !== "") onAsk();
  };
  return (
    <form onSubmit={submit} className="min-w-0 space-y-2">
      <label htmlFor={id} className="block font-semibold">
        {copy.label}
      </label>
      <textarea
        id={id}
        aria-describedby={`${id}-hint`}
        rows={2}
        maxLength={maxLength}
        value={value}
        placeholder={copy.placeholder}
        disabled={busy}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) submit(event);
        }}
        className={`${inputClass} min-h-20 py-2`}
      />
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {copy.hint}
      </p>
      <Button type="submit" disabled={busy || value.trim() === ""} className="h-auto min-h-11 max-w-full whitespace-normal">
        <SendIcon aria-hidden="true" className="rtl:-scale-x-100" />
        {busy ? copy.asking : copy.ask}
      </Button>
    </form>
  );
}
