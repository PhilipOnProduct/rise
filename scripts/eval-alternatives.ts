/**
 * Eval script for /api/itinerary/alternative
 *
 * Run: npm run eval:alternatives (requires dev server on localhost:3000)
 *
 * PHI-118: thin wrapper. Suite logic lives in `lib/evals/alternatives/`.
 * Pre-PHI-118 this script existed in the repo but wasn't wired into
 * `package.json` — wiring landed in this same card.
 */

import { main } from "../lib/evals/alternatives/runner";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
