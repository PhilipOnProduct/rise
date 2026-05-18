/**
 * Eval script for /api/itinerary/edit — Location constraint
 *
 * Run: npm run eval:location (requires dev server on localhost:3000)
 *
 * PHI-118: thin wrapper. Suite logic lives in `lib/evals/location/`.
 */

import { main } from "../lib/evals/location/runner";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
