import Link from "next/link";

type FooterLinksProps = {
  title: string;
  links: readonly { href: string; label: string }[];
};

export function FooterLinks({ title, links }: FooterLinksProps) {
  return (
    <div>
      <h2 className="text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">{title}</h2>
      <ul className="mt-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="inline-flex min-h-11 items-center hover:underline">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
