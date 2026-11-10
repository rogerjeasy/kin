import { InboxIcon } from "lucide-react";

type GridEmptyOverlayProps = { title: string; text?: string };

/** The grid's no-rows overlay: it says there is nothing yet, and what puts something here. */
export function GridEmptyOverlay({ title, text }: GridEmptyOverlayProps) {
  return (
    <div className="flex max-w-prose flex-col items-center gap-2 px-6 text-center">
      <span aria-hidden="true" className="mb-1 inline-flex size-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground shadow-[inset_0_0_0_1px_var(--border),0_0_24px_-6px_rgb(var(--glow-gold)/0.45)]">
        <InboxIcon className="size-5" />
      </span>
      <p className="font-semibold">{title}</p>
      {text ? <p className="text-sm text-pretty text-muted-foreground">{text}</p> : null}
    </div>
  );
}
