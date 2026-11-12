import { dashboardRoutes, oauthConsentRoute } from "@/content/dashboard-routes";
import { defaultLocale, isLocale, type Locale } from "@/i18n/locales";
import { localizedPath, pagePath } from "@/i18n/routing";

const PLACEHOLDER_ORIGIN = "https://kin.invalid";

/**
 * Where to go after signing in. Only a path inside the circle's own screens
 * is accepted, so a crafted link can never send someone to another site or
 * to an unexpected page of this one.
 */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) {
    return dashboardRoutes.overview;
  }
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_ORIGIN);
  } catch {
    return dashboardRoutes.overview;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN || !isDashboardPage(url.pathname)) {
    return dashboardRoutes.overview;
  }
  // The OAuth consent screen's query is the client's authorization request, which the screen checks again; every other query is dropped.
  return pagePath(url.pathname) === oauthConsentRoute ? `${url.pathname}${url.search}` : url.pathname;
}

/** True for /dashboard and every screen under it, in any language. */
export function isDashboardPage(pathname: string): boolean {
  const page = pagePath(pathname);
  return page === dashboardRoutes.overview || page.startsWith(`${dashboardRoutes.overview}/`);
}

/** The language a path is in: its prefix, or English at the short address. */
export function localeOfPath(pathname: string): Locale {
  const [, first = ""] = pathname.split("/");
  return isLocale(first) ? first : defaultLocale;
}

/** The sign-in page in the path's language, with where to come back to and why. */
export function signInPath(next: string, problem?: "failed" | "unavailable"): string {
  const params = new URLSearchParams({ next });
  if (problem) params.set("problem", problem);
  return `${localizedPath(localeOfPath(next), "/sign-in")}?${params.toString()}`;
}
