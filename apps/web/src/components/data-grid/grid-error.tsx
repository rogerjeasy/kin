import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

type GridErrorProps = { title: string; text: string; retry: string; onRetry?: () => void };

/** What a grid says when its rows could not be read: what happened and what to do, with no internals. */
export function GridError({ title, text, retry, onRetry }: GridErrorProps) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 p-5 text-sm">
      <div className="flex items-start gap-3">
        <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-danger" />
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
