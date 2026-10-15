import type { StaticImageData } from "next/image";

import { Avatar } from "@/components/shared/avatar";
import { cn } from "@/lib/utils";

type PersonProps = { portrait: StaticImageData; name: string; detail?: string; className?: string };

/** A portrait with the person's name, and a line about them. */
export function Person({ portrait, name, detail, className }: PersonProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <Avatar src={portrait} size="sm" />
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        {detail ? <p className="truncate text-sm text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}
