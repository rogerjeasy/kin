"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { localeNames, locales, type Locale } from "@/i18n/locales";
import { switchLocale } from "@/i18n/routing";

type LanguageListProps = { locale: Locale; label: string };

/** Every language as a plain link. Used in the phone menu, where a nested menu would be awkward. */
export function LanguageList({ locale, label }: LanguageListProps) {
  const pathname = usePathname();

  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-5 gap-y-1">
        {locales.map((target) => (
          <li key={target}>
            <Link
              href={switchLocale(pathname, target)}
              lang={target}
              hrefLang={target}
              aria-current={target === locale ? "true" : undefined}
              className="inline-flex min-h-11 items-center text-muted-foreground aria-[current=true]:font-semibold aria-[current=true]:text-foreground"
            >
              {localeNames[target]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
