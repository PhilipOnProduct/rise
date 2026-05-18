/**
 * Eval script for /api/recommendations
 *
 * Run: npm run eval:recommendations (requires dev server on localhost:3000)
 *
 * PHI-118: thin wrapper. Suite logic lives in `lib/evals/recommendations/`.
 */

import { main } from "../lib/evals/recommendations/runner";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
