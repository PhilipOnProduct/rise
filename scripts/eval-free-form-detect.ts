/**
 * PHI-58 — Detection cases for `isFreeFormTripDescription`.
 *
 * Synchronous, no API calls. Verifies the homepage routing rule.
 *
 * Run: npm run eval:free-form-detect
 *
 * PHI-118: thin wrapper. Suite logic lives in `lib/evals/free-form-detect/`.
 */

import { main } from "../lib/evals/free-form-detect/runner";

main();
