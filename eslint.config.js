import path from "node:path";

import js from "@eslint/js";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  includeIgnoreFile(path.join(import.meta.dirname, ".gitignore")),
  // Third-party scripts copied in at build time (apps/web/scripts/vendor-bryntum.ts), which are not ours to lint.
  { ignores: ["apps/web/public/vendor/**"] },
  // SDKs APIMatic generates from the OpenAPI document (pnpm --filter @kin/web run sdk:generate), not ours to lint.
  { ignores: ["sdks/**"] },
  // Agents' git worktrees of this repository, each linted in its own checkout.
  { ignores: [".claude/worktrees/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
);
