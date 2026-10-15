import { faviconSvg } from "./favicon.ts";
import { KNOT_MARK, knot, strandPath } from "./knot-geometry.ts";

/**
 * Kin's look for Cognito's sign-in and sign-up pages, which Kin does not host
 * and cannot style with CSS. Cognito accepts SVG images, and an SVG may carry
 * its own animation, so the logo draws itself in and the page background
 * drifts. Every colour is one of globals.css's design tokens.
 */

export type ColourMode = "LIGHT" | "DARK";

const TOKENS = {
  LIGHT: {
    paper: "#faf7f2",
    ink: "#1a1714",
    line: "#1d2b4f",
    accent: "#8a5a00",
    tile: "#efe8dc",
    shares: ["#2b6cd4", "#c2610c", "#a2398c"],
    shareOpacity: 0.16,
    watermark: 0.035,
  },
  DARK: {
    paper: "#11131a",
    ink: "#f2eee7",
    line: "#f2eee7",
    accent: "#e9b872",
    tile: "#232735",
    shares: ["#5b93f0", "#c97b2e", "#c05cab"],
    shareOpacity: 0.22,
    watermark: 0.045,
  },
} as const;

// Motion stops for anyone who asked their device for less of it.
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce){*{animation:none!important}}";

const { strands, centre } = knot(KNOT_MARK);
const KNOT_PATHS = strands.map((strand) => `<path pathLength="1" d="${strandPath(strand)}"/>`).join("");

/** The knot and the word Kin, side by side. The line draws itself, then the centre settles. */
export function signInLogoSvg(mode: ColourMode): string {
  const colour = TOKENS[mode];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 168 64" width="168" height="64">`,
    "<style>",
    // The finished logo is the resting state. The animation only plays in
    // from nothing, so a browser that does not run it still shows the logo.
    ".strand{stroke-dasharray:1;animation:draw 1.1s cubic-bezier(.65,0,.35,1) both}",
    ".strand:nth-child(2){animation-delay:.18s}.strand:nth-child(3){animation-delay:.36s}",
    ".centre{transform-origin:32px 32px;animation:pop .5s .95s cubic-bezier(.34,1.56,.64,1) both,breathe 4s 1.6s ease-in-out infinite}",
    ".word{animation:rise .7s .7s ease-out both}",
    "@keyframes draw{from{stroke-dashoffset:1}to{stroke-dashoffset:0}}",
    "@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}",
    "@keyframes breathe{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}",
    "@keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}",
    REDUCED_MOTION,
    "</style>",
    `<g fill="none" stroke="${colour.line}" stroke-width="${KNOT_MARK.strokeWidth}" stroke-linecap="round">`,
    ...strands.map((strand) => `<path class="strand" pathLength="1" d="${strandPath(strand)}"/>`),
    "</g>",
    `<circle class="centre" cx="${centre.x}" cy="${centre.y}" r="${KNOT_MARK.centreRadius}" fill="${colour.accent}"/>`,
    `<text class="word" x="78" y="46" font-family="Newsreader, Georgia, 'Times New Roman', serif" font-size="40" fill="${colour.ink}">Kin</text>`,
    "</svg>",
  ].join("");
}

/**
 * The page behind the form: Kin's paper, three soft shapes in the colours of
 * the siblings' shares drifting slowly, and the knot as a faint watermark
 * that turns once every two minutes.
 */
export function signInBackgroundSvg(mode: ColourMode): string {
  const colour = TOKENS[mode];
  const blobs = [
    { cx: 260, cy: 180, r: 520, drift: "a", duration: 26 },
    { cx: 1380, cy: 860, r: 560, drift: "b", duration: 32 },
    { cx: 1320, cy: 120, r: 380, drift: "c", duration: 22 },
  ];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">`,
    "<defs>",
    ...blobs.map(
      (_, index) =>
        `<radialGradient id="g${index}"><stop offset="0" stop-color="${colour.shares[index]}" stop-opacity="${colour.shareOpacity}"/><stop offset="1" stop-color="${colour.shares[index]}" stop-opacity="0"/></radialGradient>`,
    ),
    "</defs>",
    "<style>",
    ".blob{transform-box:fill-box;transform-origin:center}",
    ".a{animation:a 26s ease-in-out infinite alternate}.b{animation:b 32s ease-in-out infinite alternate}.c{animation:c 22s ease-in-out infinite alternate}",
    "@keyframes a{to{transform:translate(140px,90px) scale(1.12)}}",
    "@keyframes b{to{transform:translate(-160px,-70px) scale(0.92)}}",
    "@keyframes c{to{transform:translate(-90px,120px) scale(1.18)}}",
    ".mark{transform-origin:260px 820px;animation:turn 120s linear infinite}",
    "@keyframes turn{to{transform:rotate(360deg)}}",
    REDUCED_MOTION,
    "</style>",
    `<rect width="1600" height="1000" fill="${colour.paper}"/>`,
    ...blobs.map((blob, index) => `<circle class="blob ${blob.drift}" cx="${blob.cx}" cy="${blob.cy}" r="${blob.r}" fill="url(#g${index})"/>`),
    `<g class="mark" opacity="${colour.watermark}">`,
    `<g transform="translate(20 580) scale(7.5)" fill="none" stroke="${colour.line}" stroke-width="${KNOT_MARK.strokeWidth}">${KNOT_PATHS}</g>`,
    "</g>",
    "</svg>",
  ].join("");
}

/** The favicon of the sign-in pages: the site's own icon. */
export function signInFaviconSvg(): string {
  return faviconSvg();
}

export const SIGN_IN_GRAPHICS = ["EMAIL", "PASSWORD", "SMS", "AUTH_APP", "PASSKEY"] as const;
export type SignInGraphic = (typeof SIGN_IN_GRAPHICS)[number];

/** The line drawing inside each graphic, on a 24 unit grid. */
const GLYPHS: Record<SignInGraphic, string> = {
  EMAIL: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.8 7.2 12 13l8.2-5.8"/>',
  PASSWORD: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
  SMS: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
  AUTH_APP: '<path d="M12 3 4.5 6v5.5c0 4.4 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5.1 7.5-9.5V6z"/><path d="m8.8 12 2.2 2.2 4.2-4.4"/>',
  PASSKEY: '<path d="M7 10.5a5 5 0 0 1 10 0v2.5"/><path d="M9.5 20.5c.9-2 1.3-4.3 1.3-6.8v-2.2a1.2 1.2 0 0 1 2.4 0v2.2c0 2.9-.5 5.6-1.6 8"/><path d="M5 14c.4-1 .5-2.1.5-3.5"/><path d="M17 15.5c-.2 1.8-.6 3.4-1.2 5"/>',
};

/** One of the round pictures Cognito shows beside each way to sign in. */
export function signInGraphicSvg(graphic: SignInGraphic, mode: ColourMode): string {
  const colour = TOKENS[mode];
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="72" height="72">`,
    `<circle cx="36" cy="36" r="36" fill="${colour.tile}"/>`,
    `<g transform="translate(18 18) scale(1.5)" fill="none" stroke="${colour.line}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[graphic]}</g>`,
    `<circle cx="54" cy="18" r="4" fill="${colour.accent}"/>`,
    "</svg>",
  ].join("");
}
