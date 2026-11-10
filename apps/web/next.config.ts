import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

import { BRYNTUM_URL_DIR } from "./src/components/dashboard/shifts/bryntum-files.ts";
import { bryntumVersion } from "./scripts/vendor-bryntum.ts";
import { SECURITY_HEADERS } from "./security-headers.ts";

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source, so Next compiles them.
  transpilePackages: ["@kin/domain"],
  // A self-contained server for the container image (apps/web/Dockerfile).
  // Tracing starts at the repository root, where the workspace packages live.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
  // The version in the names of the Bryntum files the browser loads at runtime
  // (care calendar). It is the installed package's, so a new version is a new URL.
  env: { NEXT_PUBLIC_BRYNTUM_VERSION: bryntumVersion() },
  async headers() {
    return [
      { source: "/:path*", headers: [...SECURITY_HEADERS] },
      {
        // Each file's name carries the version, so a file never changes under its name.
        source: `${BRYNTUM_URL_DIR}/:file*`,
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
