import { describe, expect, it } from "vitest";
import {
  buildSingleLegTrip,
  destinationsForPrompt,
  firstLeg,
  newLegId,
  primaryDestinationName,
  primaryHotel,
  tripDateRange,
  validateTrip,
  type Trip,
} from "@/lib/trip-schema";

function legsOnlyTrip(): Trip {
  return {
    legs: [
      { id: "a", place: { name: "Lisbon" }, hotel: null, startDate: "2026-07-03", endDate: "2026-07-06" },
      { id: "b", place: { name: "Madrid" }, hotel: null, startDate: "2026-07-06", endDate: "2026-07-10" },
    ],
    departureDate: null,
    returnDate: null,
  };
}

describe("accessors", () => {
  it("handle null/undefined trips", () => {
    expect(firstLeg(null)).toBeNull();
    expect(primaryDestinationName(undefined)).toBe("");
    expect(destinationsForPrompt(null)).toBe("");
    expect(primaryHotel(null)).toBeNull();
    expect(tripDateRange(null)).toEqual({ departure: null, return: null });
  });

  it("joins multi-leg destinations with 'then'", () => {
    expect(destinationsForPrompt(legsOnlyTrip())).toBe("Lisbon then Madrid");
  });

  it("derives the trip envelope from leg dates when top-level dates are null", () => {
    expect(tripDateRange(legsOnlyTrip())).toEqual({ departure: "2026-07-03", return: "2026-07-10" });
  });

  it("prefers explicit top-level dates over leg dates", () => {
    const trip = { ...legsOnlyTrip(), departureDate: "2026-07-01", returnDate: "2026-07-12" };
    expect(tripDateRange(trip)).toEqual({ departure: "2026-07-01", return: "2026-07-12" });
  });
});

describe("newLegId", () => {
  it("produces a v4-shaped UUID", () => {
    expect(newLegId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe("buildSingleLegTrip", () => {
  it("omits optional fields that were not supplied (JSONB shape stability)", () => {
    const trip = buildSingleLegTrip({ destinationName: "Lisbon" });
    const leg = trip.legs[0];
    expect(leg.place).toEqual({ name: "Lisbon" });
    expect(leg.hotel).toBeNull();
    expect("hotelPlaceId" in leg).toBe(false);
    expect("hotelLat" in leg).toBe(false);
    expect("costEstimate" in leg).toBe(false);
  });

  it("carries rich hotel fields as a unit when supplied", () => {
    const trip = buildSingleLegTrip({
      destinationName: "Singapore",
      hotel: "Pullman Singapore Hill Street",
      hotelPlaceId: "place123",
      hotelLat: 1.2906,
      hotelLng: 103.8466,
      hotelNeighborhood: "Clarke Quay",
    });
    const leg = trip.legs[0];
    expect(leg.hotelPlaceId).toBe("place123");
    expect(leg.hotelLat).toBe(1.2906);
    expect(leg.hotelLng).toBe(103.8466);
    expect(leg.hotelNeighborhood).toBe("Clarke Quay");
  });

  it("marks unverified destinations", () => {
    const trip = buildSingleLegTrip({ destinationName: "Atlantis", destinationVerified: false });
    expect(trip.legs[0].place.unverified).toBe(true);
  });
});

describe("validateTrip", () => {
  it("rejects a trip with no legs", () => {
    const errors = validateTrip({ legs: [], departureDate: null, returnDate: null });
    expect(errors).toEqual([{ path: "legs", message: "Trip must have at least one leg." }]);
  });

  it("flags missing ids and place names per leg", () => {
    const trip: Trip = {
      legs: [{ id: "", place: { name: "" }, hotel: null }],
      departureDate: null,
      returnDate: null,
    };
    const paths = validateTrip(trip).map((e) => e.path);
    expect(paths).toContain("legs[0].id");
    expect(paths).toContain("legs[0].place.name");
  });

  it("flags a leg whose startDate is after its endDate", () => {
    const trip: Trip = {
      legs: [{ id: "a", place: { name: "Lisbon" }, hotel: null, startDate: "2026-07-10", endDate: "2026-07-03" }],
      departureDate: null,
      returnDate: null,
    };
    const messages = validateTrip(trip).map((e) => e.message);
    expect(messages).toContain("Leg startDate is after endDate.");
  });

  it("accepts a well-formed trip", () => {
    expect(validateTrip(legsOnlyTrip())).toEqual([]);
  });
});
