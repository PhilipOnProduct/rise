import { describe, expect, it } from "vitest";
import { cleanUserSeededActivities } from "@/lib/itinerary-gen-prompt";

describe("cleanUserSeededActivities", () => {
  it("returns an empty array for missing/non-array input", () => {
    expect(cleanUserSeededActivities(null)).toEqual([]);
    expect(cleanUserSeededActivities(undefined)).toEqual([]);
    expect(cleanUserSeededActivities("Louvre")).toEqual([]);
    expect(cleanUserSeededActivities({ 0: "Louvre" })).toEqual([]);
  });

  it("trims entries and drops blanks and non-strings", () => {
    expect(cleanUserSeededActivities(["  Louvre  ", "", "   ", 42, "Sushi Saito"])).toEqual([
      "Louvre",
      "Sushi Saito",
    ]);
  });

  it("drops paste accidents longer than 200 characters", () => {
    const long = "x".repeat(201);
    const exactly200 = "y".repeat(200);
    expect(cleanUserSeededActivities([long, exactly200])).toEqual([exactly200]);
  });

  it("caps the list at 20 items", () => {
    const many = Array.from({ length: 30 }, (_, i) => `Activity ${i}`);
    expect(cleanUserSeededActivities(many)).toHaveLength(20);
  });
});
