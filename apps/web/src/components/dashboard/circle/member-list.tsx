import type { StaticImageData } from "next/image";

import { Person } from "@/components/dashboard/ui/person";

export type MemberItem = {
  id: string;
  portrait: StaticImageData;
  name: string;
  role: string;
  /** "30% share", for members who hold one. */
  share: string | null;
  text: string;
};

/** Everyone in the circle, with their role and what it lets them do. */
export function MemberList({ members }: { members: readonly MemberItem[] }) {
  return (
    <ul className="divide-y border-t">
      {members.map((member) => (
        <li key={member.id} className="grid gap-x-4 gap-y-2 px-5 py-4 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-center sm:px-6">
          <Person portrait={member.portrait} name={member.name} detail={member.share ? `${member.role} · ${member.share}` : member.role} />
          <p className="text-sm text-pretty text-muted-foreground sm:ps-0 ps-12">{member.text}</p>
        </li>
      ))}
    </ul>
  );
}
