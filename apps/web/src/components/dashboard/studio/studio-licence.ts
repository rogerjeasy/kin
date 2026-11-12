/**
 * Whether the family money studio may run AG Studio, decided from AG Studio's
 * own reading of the licence key. The key is public by nature (it is built into
 * the page) but is never committed: it comes from NEXT_PUBLIC_AG_STUDIO_LICENSE
 * at build time.
 *
 * - No key at all (a fork, CI, a developer's machine): AG Studio runs
 *   unlicensed, with its watermark, so the page and its tests never depend on
 *   the key.
 * - A key AG Studio accepts: AG Studio runs, with its agents only when the key
 *   covers AI.
 * - A key it refuses, or one that has expired (the trial ends on 13 December
 *   2026): Kin shows its own read-only summary of the same record instead,
 *   with a short note, rather than a broken or watermarked page.
 */

/** What AG Studio's licence manager reports about a key, in the parts this decision reads. */
export type LicenceDetails = {
  readonly missing?: boolean;
  readonly valid: boolean;
  readonly expired?: boolean;
  readonly trialExpired?: boolean;
};

export type StudioLicence =
  | { readonly kind: "unlicensed"; readonly ai: true }
  | { readonly kind: "licensed"; readonly ai: boolean }
  | { readonly kind: "lapsed" };

const usable = (details: LicenceDetails) => details.valid && details.expired !== true && details.trialExpired !== true;

/**
 * `withAi` is the key read as needing AG Studio's AI licence, `withoutAi` as
 * needing only the studio. Anything the decision cannot read as good is
 * treated as lapsed: the summary is always safe to show.
 */
export function studioLicence(withAi: LicenceDetails, withoutAi: LicenceDetails): StudioLicence {
  if (withAi.missing === true) return { kind: "unlicensed", ai: true };
  if (usable(withAi)) return { kind: "licensed", ai: true };
  if (usable(withoutAi)) return { kind: "licensed", ai: false };
  return { kind: "lapsed" };
}
