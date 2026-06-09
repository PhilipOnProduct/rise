import { describe, expect, it } from "vitest";
import { parseJsonJudgeResponse } from "@/lib/evals/judge";

describe("parseJsonJudgeResponse", () => {
  it("parses bare JSON", () => {
    expect(parseJsonJudgeResponse<{ score: number }>('{"score": 8}')).toEqual({ score: 8 });
  });

  it("strips ```json fences", () => {
    const raw = '```json\n{"score": 8, "pass": true}\n```';
    expect(parseJsonJudgeResponse<{ score: number; pass: boolean }>(raw)).toEqual({ score: 8, pass: true });
  });

  it("strips anonymous ``` fences", () => {
    const raw = '```\n{"score": 3}\n```';
    expect(parseJsonJudgeResponse<{ score: number }>(raw)).toEqual({ score: 3 });
  });

  it("removes trailing commas only when asked", () => {
    const raw = '{"items": [1, 2,], "score": 5,}';
    expect(parseJsonJudgeResponse<{ items: number[]; score: number }>(raw, true)).toEqual({
      items: [1, 2],
      score: 5,
    });
    expect(() => parseJsonJudgeResponse(raw)).toThrow(SyntaxError);
  });

  it("propagates SyntaxError on garbage so callers keep their own error prefix", () => {
    expect(() => parseJsonJudgeResponse("not json at all")).toThrow(SyntaxError);
  });
});
