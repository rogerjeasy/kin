import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

type GridErrorProps = { title: string; text: string; retry: string; onRetry?: () => void };

/** What a grid says when its rows could not be read: what happened and what to do, with no internals. */
export function GridError({ title, text, retry, onRetry }: GridErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 p-5 text-sm">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl bg-danger/10 text-danger ring-1 ring-danger/20 ring-inset">
          <TriangleAlertIcon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="text-pretty text-muted-foreground">{text}</p>
        </div>
      </div>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={onRetry}>
          {retry}
        </Button>
      ) : null}
    </div>
  );
}
