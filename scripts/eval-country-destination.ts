/**
 * PHI-69 — Country → city ranking quality eval (LLM-judge).
 *
 * Run: npm run eval:country-destination
 *
 * PHI-118: thin wrapper. Suite logic lives in `lib/evals/country-destination/`.
 */

import { main } from "../lib/evals/country-destination/runner";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
