import { defaultLocale, isLocale, type Locale } from "@/i18n/locales";

/** A form's language field, or English when it is missing or unknown. */
export function formLocale(form: FormData): Locale {
  const raw = form.get("locale");
  return typeof raw === "string" && isLocale(raw) ? raw : defaultLocale;
}

/** A form's text field, trimmed, or `null` when it is missing or empty. */
export function formText(form: FormData, name: string, maxLength = 200): string | null {
  const raw = form.get(name);
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" || value.length > maxLength ? null : value;
}
