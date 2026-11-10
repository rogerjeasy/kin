import {
  Frank_Ruhl_Libre,
  Geist,
  Geist_Mono,
  IBM_Plex_Sans_Arabic,
  IBM_Plex_Sans_Hebrew,
  Newsreader,
  Noto_Naskh_Arabic,
} from "next/font/google";

const newsreader = Newsreader({
  subsets: ["latin", "latin-ext"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
  display: "swap",
});

// Geist is a variable face: one file carries every weight the interface uses.
const geist = Geist({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
  preload: false,
});

// The Arabic and Hebrew faces are fetched only by pages that show those scripts.
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-arabic",
  display: "swap",
  preload: false,
});

const plexHebrew = IBM_Plex_Sans_Hebrew({
  subsets: ["hebrew"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-hebrew",
  display: "swap",
  preload: false,
});

const naskh = Noto_Naskh_Arabic({
  subsets: ["arabic"],
  variable: "--font-naskh",
  display: "swap",
  preload: false,
});

const frank = Frank_Ruhl_Libre({
  subsets: ["hebrew"],
  variable: "--font-frank",
  display: "swap",
  preload: false,
});

/** Class names that define every font variable. Set once, on <html>. */
export const fontVariables = [
  newsreader,
  geist,
  geistMono,
  plexArabic,
  plexHebrew,
  naskh,
  frank,
]
  .map((font) => font.variable)
  .join(" ");
