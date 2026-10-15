import { KNOT_MARK, knot, strandPath } from "./knot-geometry.ts";
import { round } from "./ring-geometry.ts";

const TILE = 64;
const TILE_RADIUS = 14;
/** The knot fills four fifths of the tile, centred. */
const KNOT_SCALE = 0.8;
const INSET = round((TILE * (1 - KNOT_SCALE)) / 2);

/**
 * A browser tab can be light or dark and cannot read the page's CSS variables,
 * so the icon carries its own ground. These are --band, --band-foreground and
 * --band-highlight from globals.css, and a test keeps them in step.
 */
const TILE_COLOUR = "#1d2b4f";
const LINE_COLOUR = "#faf7f2";
const CENTRE_COLOUR = "#e9b872";

/** The site icon: the Kin knot on a navy tile. */
export function faviconSvg(): string {
  const { strands, centre } = knot(KNOT_MARK);
  const paths = strands.map((strand) => `<path d="${strandPath(strand)}"/>`).join("");

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}">`,
    `<rect width="${TILE}" height="${TILE}" rx="${TILE_RADIUS}" fill="${TILE_COLOUR}"/>`,
    `<g transform="translate(${INSET} ${INSET}) scale(${KNOT_SCALE})">`,
    `<g fill="none" stroke="${LINE_COLOUR}" stroke-width="${KNOT_MARK.strokeWidth}">${paths}</g>`,
    `<circle cx="${centre.x}" cy="${centre.y}" r="${KNOT_MARK.centreRadius}" fill="${CENTRE_COLOUR}"/>`,
    "</g>",
    "</svg>",
  ].join("");
}
