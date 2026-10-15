import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source, so Next compiles them.
  transpilePackages: ["@kin/domain"],
  // A self-contained server for the container image (apps/web/Dockerfile).
  // Tracing starts at the repository root, where the workspace packages live.
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
};

export default nextConfig;
