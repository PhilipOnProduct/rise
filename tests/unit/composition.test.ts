import { describe, expect, it } from "vitest";
import { buildCompositionSegment } from "@/lib/composition";

describe("buildCompositionSegment", () => {
  it("returns an empty string when nothing is provided", () => {
    expect(buildCompositionSegment(null, null)).toBe("");
    expect(buildCompositionSegment(undefined, undefined)).toBe("");
    expect(buildCompositionSegment(0, [])).toBe("");
  });

  it("uses singular/plural party wording", () => {
    expect(buildCompositionSegment(1, null)).toBe("Party size: 1 person.");
    expect(buildCompositionSegment(3, null)).toBe("Party size: 3 people.");
  });

  it("lists children ages and their behavioural constraints", () => {
    const out = buildCompositionSegment(3, ["Under 2"]);
    expect(out).toContain("Travelling with 1 child (ages: Under 2).");
    expect(out).toContain("pram access required");
    expect(out).toContain("nap windows mid-morning and mid-afternoon");
  });

  it("deduplicates constraints across siblings in the same age band", () => {
    const out = buildCompositionSegment(4, ["2–4", "2–4"]);
    expect(out).toContain("2 children");
    expect(out.match(/45-minute activity maximum/g)).toHaveLength(1);
  });

  it("merges constraints across different age bands without duplicates", () => {
    // 9–12 and 13–17 both carry "near-adult stamina" — it must appear once.
    const out = buildCompositionSegment(4, ["9–12", "13–17"]);
    expect(out.match(/near-adult stamina/g)).toHaveLength(1);
    expect(out).toContain("avoid playground or kid-club framing");
  });

  it("ignores unknown age bands but still mentions the children", () => {
    const out = buildCompositionSegment(2, ["18+"]);
    expect(out).toContain("Travelling with 1 child (ages: 18+).");
    expect(out).not.toContain("Plan every recommendation around");
  });
});
