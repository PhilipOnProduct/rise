import { describe, expect, it } from "vitest";
import {
  applyFamilyModifier,
  buildActivityPairs,
  calculateActivityTimes,
  determineFlag,
} from "@/lib/travel-connectors";
import type { Activity, TimeBlock } from "@/types/itinerary";

function act(id: string, time: TimeBlock, sequence: number): Activity {
  return { id, name: id, description: "", time, sequence, category: "activity" };
}

describe("calculateActivityTimes", () => {
  it("splits a block evenly and caps each activity at the default duration", () => {
    // Morning block is 09:00–12:00 (540–720). Two activities → 90-min slots.
    const times = calculateActivityTimes([act("a", "morning", 0), act("b", "morning", 1)]);
    expect(times.get("a")).toEqual({ start_min: 540, end_min: 630 });
    expect(times.get("b")).toEqual({ start_min: 630, end_min: 720 });
  });

  it("caps a lone activity at 90 minutes even when the block is longer", () => {
    const times = calculateActivityTimes([act("solo", "afternoon", 0)]);
    // Afternoon starts 13:00 (780); slot is 240 min but duration caps at 90.
    expect(times.get("solo")).toEqual({ start_min: 780, end_min: 870 });
  });

  it("orders within a block by sequence, not array order", () => {
    const times = calculateActivityTimes([act("second", "morning", 1), act("first", "morning", 0)]);
    expect(times.get("first")!.start_min).toBeLessThan(times.get("second")!.start_min);
  });
});

describe("buildActivityPairs", () => {
  it("pairs adjacent activities sorted by block then sequence", () => {
    const pairs = buildActivityPairs([
      act("evening1", "evening", 0),
      act("morning1", "morning", 0),
      act("morning2", "morning", 1),
    ]);
    expect(pairs.map((p) => [p.from.id, p.to.id])).toEqual([
      ["morning1", "morning2"],
      ["morning2", "evening1"],
    ]);
    expect(pairs[0].sameBlock).toBe(true);
    expect(pairs[1].sameBlock).toBe(false);
  });

  it("returns no pairs for a single activity", () => {
    expect(buildActivityPairs([act("only", "morning", 0)])).toEqual([]);
  });
});

describe("applyFamilyModifier", () => {
  it("returns null without children or with only older children", () => {
    expect(applyFamilyModifier(600, null)).toBeNull();
    expect(applyFamilyModifier(600, [])).toBeNull();
    expect(applyFamilyModifier(600, ["9–12"])).toBeNull();
  });

  it("applies the 1.5× multiplier (ceiled) for young children", () => {
    expect(applyFamilyModifier(600, ["Under 2"])).toBe(900);
    expect(applyFamilyModifier(601, ["2–4"])).toBe(Math.ceil(601 * 1.5));
  });
});

describe("determineFlag", () => {
  it("does not flag when no route data exists", () => {
    expect(determineFlag(null, null, null, null, 600)).toEqual({ flagged: false, reason: null });
  });

  it("does not flag when the fastest mode fits within gap + 5-minute buffer", () => {
    // Gap 600s + 300s buffer = 900s allowance.
    expect(determineFlag(900, null, null, null, 600).flagged).toBe(false);
  });

  it("flags when even the fastest mode exceeds the gap plus buffer", () => {
    const result = determineFlag(2000, 1800, 1500, null, 600);
    expect(result.flagged).toBe(true);
    // Fastest is drive (1500s = 25 min) vs a 10 min gap.
    expect(result.reason).toBe("Fastest option (drive 25 min) exceeds 10 min gap");
  });

  it("uses the family-adjusted walk time instead of the raw walk time", () => {
    // Raw walk fits (800s ≤ 900s allowance) but adjusted walk does not,
    // and no other mode exists — so the connector is flagged.
    const result = determineFlag(800, null, null, 1200, 600);
    expect(result.flagged).toBe(true);
  });
});
