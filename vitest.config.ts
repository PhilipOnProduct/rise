import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" path alias.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    // Unit tests only — Playwright owns tests/e2e, the eval suites own
    // scripts/ + lib/evals/*/runner.ts (live API, costs money per run).
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
