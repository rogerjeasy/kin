import Link from "next/link";

import { KnotMark } from "./knot-mark";

type LogoProps = { href: string; label: string };

export function Logo({ href, label }: LogoProps) {
  return (
    <Link href={href} aria-label={label} className="inline-flex min-h-11 items-center gap-2.5 font-serif text-2xl">
      <KnotMark />
      Kin
    </Link>
  );
}
