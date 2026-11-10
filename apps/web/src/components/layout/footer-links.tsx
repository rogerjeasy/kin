import Link from "next/link";

type FooterLinksProps = {
  title: string;
  links: readonly { href: string; label: string }[];
};

export function FooterLinks({ title, links }: FooterLinksProps) {
  return (
    <div>
      <h2 className="inline-flex items-center gap-2.5 text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">
        <span aria-hidden="true" className="h-px w-4 bg-gold" />
        {title}
      </h2>
      <ul className="mt-3">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} className="group inline-flex min-h-11 items-center gap-2 text-foreground/85 transition-colors duration-300 hover:text-foreground">
              {link.label}
              <span aria-hidden="true" className="h-px w-0 bg-gold transition-[width] duration-500 ease-(--ease-out-expo) group-hover:w-4" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
