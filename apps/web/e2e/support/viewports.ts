/**
 * The four viewports every screen must work at (AGENTS.md section 8), plus the
 * 320 pixel width at which it must still reflow.
 */
export const viewports = [
  { name: "phone", width: 360, height: 740 },
  { name: "tablet portrait", width: 768, height: 1024 },
  { name: "tablet landscape", width: 1024, height: 768 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "320 pixel reflow", width: 320, height: 640 },
] as const;

export const laptop = viewports[3];
export const phone = viewports[0];
