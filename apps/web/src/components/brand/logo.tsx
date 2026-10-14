import Link from "next/link";

import { RingMark } from "./ring-mark";

type LogoProps = { href: string; label: string };

export function Logo({ href, label }: LogoProps) {
  return (
    <Link href={href} aria-label={label} className="inline-flex min-h-11 items-center gap-2.5 font-serif text-2xl">
      <RingMark />
      Kin
    </Link>
  );
}
