/**
 * PHI-102 — Popular Picks quality eval (LLM-judge).
 *
 * Run: npm run eval:popular-picks (requires dev server on localhost:3000)
 *
 * PHI-118: thin wrapper. Suite logic lives in `lib/evals/popular-picks/`.
 */

import { main } from "../lib/evals/popular-picks/runner";

main().catch((err) => {
  console.error("Eval crashed:", err);
  process.exit(2);
});
