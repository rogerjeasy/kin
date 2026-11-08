import { InboxIcon } from "lucide-react";

type GridEmptyOverlayProps = { title: string; text?: string };

/** The grid's no-rows overlay: it says there is nothing yet, and what puts something here. */
export function GridEmptyOverlay({ title, text }: GridEmptyOverlayProps) {
  return (
    <div className="flex max-w-prose flex-col items-center gap-2 px-6 text-center">
      <InboxIcon aria-hidden="true" className="size-6 text-muted-foreground" />
      <p className="font-semibold">{title}</p>
      {text ? <p className="text-sm text-pretty text-muted-foreground">{text}</p> : null}
    </div>
  );
}
