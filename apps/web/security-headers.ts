/**
 * Headers on every response of the web app. A baseline that cannot break the
 * PayPal checkout, the 3D hero or the care calendar: nothing here restricts
 * which scripts load (that needs nonces on every Next.js inline script, and is
 * a later step). It stops Kin being framed by another site (clickjacking a
 * yes to money), stops MIME sniffing, keeps HTTPS once a browser has seen it,
 * and lets only Kin's own pages use the camera (a letter's photograph) and
 * the microphone (a spoken yes or no). The link pages set a stricter
 * referrer policy of their own in the proxy.
 */
export const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=()" },
] as const;
