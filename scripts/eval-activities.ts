/**
 * PHI-38 — Activity-gen eval harness
 *
 * Run: npm run eval:activities
 *
 * PHI-118: thin wrapper. Suite logic lives in `lib/evals/activities/`.
 */

import { main } from "../lib/evals/activities/runner";

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
