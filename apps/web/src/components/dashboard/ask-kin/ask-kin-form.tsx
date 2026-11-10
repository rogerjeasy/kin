import { SendIcon } from "lucide-react";
import { useId, type FormEvent } from "react";

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
    <form onSubmit={submit} className="min-w-0 space-y-3">
      <label htmlFor={id} className="block text-lg font-semibold tracking-tight">
        {copy.label}
      </label>
      <div className="min-w-0 rounded-3xl border border-input bg-background p-2 shadow-[inset_0_1px_2px_var(--shadow-tint-1)] transition-[border-color,box-shadow] duration-300 ease-(--ease-out-expo) focus-within:border-ring focus-within:shadow-[0_0_0_4px_rgb(var(--glow-gold)/0.18)]">
        <textarea
          id={id}
          aria-describedby={`${id}-hint`}
          rows={3}
          maxLength={maxLength}
          value={value}
          placeholder={copy.placeholder}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) submit(event);
          }}
          className="block min-h-24 w-full min-w-0 resize-y rounded-2xl bg-transparent px-3 py-2 text-lg placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait"
        />
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 px-1 pt-1">
          <span aria-hidden="true" className="me-auto ps-2 text-xs text-muted-foreground tabular-nums">
            {value.length}/{maxLength}
          </span>
          <Button type="submit" disabled={busy || value.trim() === ""} className="h-auto min-h-11 max-w-full whitespace-normal">
            <SendIcon aria-hidden="true" className="rtl:-scale-x-100" />
            {busy ? copy.asking : copy.ask}
          </Button>
        </div>
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {copy.hint}
      </p>
    </form>
  );
}
