/**
 * PHI-34 / RISE-301 — Free-form parser eval harness
 *
 * Run: npm run eval:parser
 *
 * PHI-118: thin wrapper. Suite logic lives in `lib/evals/parser/`.
 */

import { main } from "../lib/evals/parser/runner";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
