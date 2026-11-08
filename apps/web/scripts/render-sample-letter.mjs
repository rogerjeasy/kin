// Renders the sample letter the demo's "Try a sample letter photo" button sends
// to Claude: an invented water bill for Rose's circle, drawn from the HTML
// below with the Chromium that Playwright already installs for the tests.
//   pnpm --filter @kin/web exec node scripts/render-sample-letter.mjs
// The picture is committed (src/content/demo/sample-letter.png); run this only
// to change it. It is fictional: no real company, account or person.
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import { chromium } from "@playwright/test";

const WIDTH = 1000;
const OUTPUT = fileURLToPath(new URL("../src/content/demo/sample-letter.png", import.meta.url));

const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; width: ${WIDTH}px; padding: 48px; background: #cfc8bb; font-family: Georgia, "Times New Roman", serif; color: #1f2933; }
  .sheet { background: #fdfcf8; padding: 64px 72px 56px; box-shadow: 0 6px 22px rgba(0, 0, 0, 0.28); }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1d5f8a; padding-bottom: 22px; }
  .brand { font: 700 40px "Helvetica Neue", Arial, sans-serif; color: #1d5f8a; letter-spacing: 0.5px; }
  .brand small { display: block; margin-top: 6px; font: 400 18px "Helvetica Neue", Arial, sans-serif; color: #52606d; letter-spacing: 0; }
  .meta { text-align: right; font: 400 19px/1.6 "Helvetica Neue", Arial, sans-serif; color: #323f4b; }
  .to { margin: 34px 0 30px; font-size: 24px; line-height: 1.5; }
  h1 { margin: 0 0 18px; font: 700 30px "Helvetica Neue", Arial, sans-serif; text-transform: uppercase; letter-spacing: 1.5px; color: #1d5f8a; }
  table { width: 100%; border-collapse: collapse; font-size: 24px; }
  td { padding: 10px 0; border-bottom: 1px solid #d9d4c7; }
  td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
  .paid td { color: #7b8794; }
  .due { margin-top: 30px; padding: 22px 26px; background: #e8f1f7; border: 2px solid #1d5f8a; display: flex; justify-content: space-between; font: 700 34px "Helvetica Neue", Arial, sans-serif; }
  .by { margin: 26px 0 0; font-size: 25px; line-height: 1.55; }
  .small { margin-top: 40px; padding-top: 18px; border-top: 1px solid #d9d4c7; font: 400 17px/1.55 "Helvetica Neue", Arial, sans-serif; color: #616e7c; }
  .sample { margin-top: 14px; font: 700 16px "Helvetica Neue", Arial, sans-serif; letter-spacing: 1.2px; color: #9b1c1c; text-transform: uppercase; }
</style>
<body>
  <div class="sheet">
    <div class="head">
      <div class="brand">Lakeside Water<small>Customer Care and Billing</small></div>
      <div class="meta">Statement date: November 6, 2026<br>Account 4471-0238<br>Service period: Oct 1 - Oct 31, 2026</div>
    </div>
    <div class="to">Rose<br>14 Linden Court<br>Northfield</div>
    <h1>Water and sewer statement</h1>
    <table>
      <tr class="paid"><td>Previous balance (paid, thank you)</td><td>$61.00</td></tr>
      <tr><td>Water use, 9,420 gallons</td><td>$58.40</td></tr>
      <tr><td>Sewer service</td><td>$14.75</td></tr>
    </table>
    <div class="due"><span>Amount due: $73.15</span><span>Due Nov 27, 2026</span></div>
    <p class="by">Please pay by November 27, 2026 to avoid a late fee. You can pay with your bank, by mail, or on our website. Thank you for being our customer.</p>
    <div class="small">Questions about this bill? Call Customer Care on weekdays from 8 to 5.<br>Lakeside Water, 200 Harbor Road, Northfield.</div>
    <div class="sample">Sample letter for the Kin demo. Fictional: no real company, account or person.</div>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: 100 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.screenshot({ path: OUTPUT, fullPage: true, type: "png" });
} finally {
  await browser.close();
}
process.stdout.write(`wrote ${OUTPUT}\n`);
