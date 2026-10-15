import { cn } from "@/lib/utils";

import { MemberAvatar } from "./member-avatar";

type PersonProps = { portrait: string | null; name: string; detail?: string; className?: string };

/** A portrait with the person's name, and a line about them. */
export function Person({ portrait, name, detail, className }: PersonProps) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <MemberAvatar portrait={portrait} name={name} size="sm" />
      <div className="min-w-0">
        <p className="truncate font-medium">{name}</p>
        {detail ? <p className="truncate text-sm text-muted-foreground">{detail}</p> : null}
      </div>
    </div>
  );
}
