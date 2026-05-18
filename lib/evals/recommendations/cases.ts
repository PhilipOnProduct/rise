/**
 * PHI-118 — Restaurant recommendations eval cases.
 *
 * 3 traveler profiles → /api/recommendations. Extracted verbatim from
 * `scripts/eval-recommendations.ts`.
 */

export type Profile = {
  name: string;
  travelerTypes: string[];
  destination: string;
  travelCompany: string;
  budget: string;
  departureDate: string;
  returnDate: string;
  dietaryWishes: string;
};

export type TestCase = {
  label: string;
  profile: Profile;
  criteria: string[];
};

export const TEST_CASES: TestCase[] = [
  {
    label: "Vegetarian foodie",
    profile: {
      name: "Maya",
      travelerTypes: ["Foodie — food comes first"],
      destination: "Barcelona",
      travelCompany: "Couple",
      budget: "mid-range",
      departureDate: "2025-06-01",
      returnDate: "2025-06-08",
      dietaryWishes: "vegetarian, no meat or fish",
    },
    criteria: [
      "All or most recommended restaurants offer vegetarian options",
      "No restaurant is recommended primarily for meat or seafood",
      "At least one recommendation highlights local vegetarian or plant-based cuisine",
      "Price range matches mid-range budget (€€ or €€€)",
      "Recommendations are relevant to Barcelona",
    ],
  },
  {
    label: "Luxury business traveler",
    profile: {
      name: "James",
      travelerTypes: ["Comfort traveler — good hotels and restaurants"],
      destination: "Tokyo",
      travelCompany: "Business trip",
      budget: "luxury",
      departureDate: "2025-09-10",
      returnDate: "2025-09-14",
      dietaryWishes: "",
    },
    criteria: [
      "Recommendations are upscale or fine-dining restaurants (€€€€ or €€€)",
      "At least one recommendation is suitable for a business dinner",
      "Restaurants reflect the high-end, comfort-focused traveler profile",
      "Recommendations are relevant to Tokyo",
      "Descriptions mention quality of service or ambiance",
    ],
  },
  {
    label: "Budget backpacker",
    profile: {
      name: "Sam",
      travelerTypes: ["Adventurer — off the beaten track"],
      destination: "Lisbon",
      travelCompany: "Solo",
      budget: "budget",
      departureDate: "2025-07-15",
      returnDate: "2025-07-29",
      dietaryWishes: "",
    },
    criteria: [
      "Recommendations are affordable (€ or €€ price range)",
      "At least one recommendation is a local, non-touristy spot",
      "No recommendations are luxury or fine-dining restaurants",
      "Recommendations suit a solo traveler exploring independently",
      "Recommendations are relevant to Lisbon",
    ],
  },
];
