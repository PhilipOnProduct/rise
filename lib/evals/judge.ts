/**
 * PHI-118 — Shared judge scaffolding.
 *
 * Three suites (anchors, country-destination, popular-picks) plus the
 * structured-output suites (location, recommendations, alternatives,
 * parser) all call the Anthropic API for either:
 *   - structured `tool_use` output (typed JSON via input_schema), or
 *   - raw JSON output that needs markdown-fence stripping before parse.
 *
 * This module exposes one thin helper per shape. Each suite's `judge.ts`
 * imports the relevant helper and supplies the rubric (system / user
 * message + tool schema). Behaviour matches what the original scripts
 * did — same model defaults, same validation throws, same error messages
 * — so the byte-identical CLI output gate holds.
 */

import Anthropic from "@anthropic-ai/sdk";

/** Default judge model used across LLM-as-judge suites. */
export const DEFAULT_JUDGE_MODEL = "claude-sonnet-4-6";

const client = new Anthropic();

export type ToolUseJudgeOpts<TTool> = {
  /** Tool definition matching Anthropic's tool schema. */
  tool: TTool;
  /** Tool name (must match `tool.name`). Forces the model to call it. */
  toolName: string;
  /** Pre-built user message — suites assemble this from the rubric. */
  userMessage: string;
  /** Defaults to {@link DEFAULT_JUDGE_MODEL}. */
  model?: string;
  /** Defaults to 1024 — every existing tool_use judge uses this cap. */
  maxTokens?: number;
};

/**
 * Sonnet 4.6 + tool_use call returning the tool's `input` block (typed).
 * Throws when the response carries no tool_use block — same shape every
 * pre-refactor script used.
 */
export async function runToolUseJudge<TResult, TTool = unknown>(
  opts: ToolUseJudgeOpts<TTool>,
): Promise<TResult> {
  const response = await client.messages.create({
    model: opts.model ?? DEFAULT_JUDGE_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    tools: [opts.tool as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: opts.toolName },
    messages: [{ role: "user", content: opts.userMessage }],
  });

  const block = response.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error(`Judge returned no tool_use block`);
  }
  return block.input as TResult;
}

export type RawJudgeOpts = {
  /** Pre-built user message. */
  userMessage: string;
  /** Defaults to {@link DEFAULT_JUDGE_MODEL}. */
  model?: string;
  /** Defaults to 1024. */
  maxTokens?: number;
};

/**
 * Sonnet 4.6 (or override) + raw text output. Returns the raw text from
 * the first `text` block. Suites parse + clean + throw with their own
 * error message shape to preserve byte-identical CLI output on failure.
 */
export async function runRawJudge(opts: RawJudgeOpts): Promise<string> {
  const response = await client.messages.create({
    model: opts.model ?? DEFAULT_JUDGE_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    messages: [{ role: "user", content: opts.userMessage }],
  });
  return response.content.find((b) => b.type === "text")?.text ?? "";
}

/**
 * Strip the markdown fences and (optionally) trailing commas that
 * Sonnet 4.6 occasionally emits, then JSON.parse. Does NOT swallow the
 * SyntaxError — callers wrap with their own prefix so the script's
 * error output stays byte-identical to pre-refactor.
 */
export function parseJsonJudgeResponse<TResult>(
  raw: string,
  stripTrailingCommas = false,
): TResult {
  let cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  if (stripTrailingCommas) {
    cleaned = cleaned.replace(/,(\s*[}\]])/g, "$1");
  }
  return JSON.parse(cleaned) as TResult;
}
