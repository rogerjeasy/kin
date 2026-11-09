/** The public pages, as paths before any language prefix. */
export const routes = {
  home: "/",
  howItWorks: "/how-it-works",
  safety: "/safety",
  caregivers: "/caregivers",
  pricing: "/pricing",
  start: "/start",
  signIn: "/sign-in",
  /** How an assistant or an agency's software connects to a circle: the MCP server, the API and its OpenAPI document. */
  developers: "/developers",
} as const;

export type RouteKey = keyof typeof routes;

/** The links in the header, in order. */
export const mainNav = ["howItWorks", "safety", "caregivers", "pricing"] as const satisfies readonly RouteKey[];

export type MainNavKey = (typeof mainNav)[number];
