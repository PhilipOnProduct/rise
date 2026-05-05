/**
 * API cost constants and calculators for usage tracking.
 */

// Anthropic pricing per 1M tokens
const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6":        { input: 3,     output: 15 },
  "claude-sonnet-4-20250514": { input: 3,     output: 15 },
  "claude-opus-4-6":          { input: 15,    output: 75 },
  "claude-haiku-4-5-20251001":{ input: 0.80,  output: 4 },
};

// Google API pricing per request
const GOOGLE_PRICING: Record<string, number> = {
  "places-search":      0.017,
  "places-text-search": 0.032,
  "routes-compute":     0.005,
  "geocoding":          0.005,
};

export function calculateAnthropicCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = ANTHROPIC_PRICING[model];
  if (!pricing) {
    // Fall back to Sonnet pricing for unknown models
    return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  }
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export function calculateGoogleCost(apiType: string): number {
  return GOOGLE_PRICING[apiType] ?? 0.01;
}
