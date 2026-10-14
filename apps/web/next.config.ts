import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages export TypeScript source, so Next compiles them.
  transpilePackages: ["@kin/domain"],
};

export default nextConfig;
