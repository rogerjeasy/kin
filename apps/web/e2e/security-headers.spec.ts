import { expect, test } from "@playwright/test";

import { SECURITY_HEADERS } from "../security-headers";

// The public site, a sign-in screen and a check-in link page: every kind of response carries the baseline.
for (const path of ["/", "/fr/pricing", "/sign-in", "/c/not-a-real-token"]) {
  test(`${path} is served with the security headers, so no other site can frame a yes to money`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();
    for (const { key, value } of SECURITY_HEADERS) expect(headers[key.toLowerCase()], key).toBe(value);
  });
}
