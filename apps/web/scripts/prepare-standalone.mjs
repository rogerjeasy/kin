// Completes Next's standalone build the way the container image does
// (apps/web/Dockerfile): the static files and the public folder (the Bryntum
// scripts the browser loads, copied there by the vendor script) beside the
// server, and the start file. The end-to-end tests then run exactly what is deployed.
import { cpSync } from "node:fs";
import { URL } from "node:url";

const standalone = new URL("../.next/standalone/apps/web/", import.meta.url);
cpSync(new URL("../.next/static", import.meta.url), new URL(".next/static", standalone), { recursive: true });
cpSync(new URL("../public", import.meta.url), new URL("public", standalone), { recursive: true });
cpSync(new URL("../docker/start.mjs", import.meta.url), new URL("start.mjs", standalone));
