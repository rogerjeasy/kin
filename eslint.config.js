import path from "node:path";

import js from "@eslint/js";
import { defineConfig, includeIgnoreFile } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  includeIgnoreFile(path.join(import.meta.dirname, ".gitignore")),
  // Third-party scripts copied in at build time (apps/web/scripts/vendor-bryntum.ts), which are not ours to lint.
  { ignores: ["apps/web/public/vendor/**"] },
  js.configs.recommended,
  tseslint.configs.strict,
);
