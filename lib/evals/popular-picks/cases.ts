/**
 * PHI-118 — Popular Picks eval cases.
 *
 * 6 cities × 3 profiles = 18 fixtures. Extracted verbatim from
 * `scripts/eval-popular-picks.ts`.
 */

export const PASS_AVG = 4.0;
export const PASS_FLOOR = 3.0;

export type Profile = {
  id: "solo-female" | "family-under-5" | "business-extender";
  travelCompany: string;
  childrenAges: string[] | null;
  styleTags: string[];
  context: string;
};

export const PROFILES: Profile[] = [
  {
    id: "solo-female",
    travelCompany: "solo",
    childrenAges: null,
    styleTags: ["Food-led", "Cultural"],
    context:
      "Solo female traveller. Time-of-day / safety notes welcome where relevant. Bias picks that are pleasant for one person — counter seating at restaurants, daytime markets, single-friendly spots.",
  },
  {
    id: "family-under-5",
    travelCompany: "family",
    childrenAges: ["Under 2", "2–4"],
    styleTags: ["Kid-friendly", "Cultural"],
    context:
      "Family with a baby + toddler. Stroller access matters; nap windows mid-morning and mid-afternoon. Hot midday outdoor sites and steep cobbles flag a fail. Pram-friendly + green-space proximity bias.",
  },
  {
    id: "business-extender",
    travelCompany: "solo",
    childrenAges: null,
    styleTags: ["Cultural", "Food-led"],
    context:
      "Jet-lagged business extender, 2 evenings + 1 day of leisure. Wants high-quality picks they can tap through in 60 seconds. Late-night nightlife matters less than 'open before 9pm and 5 minutes from the hotel district'.",
  },
];

export const CITIES = ["Lisbon", "Tokyo", "Kyoto", "Bangkok", "Málaga", "New York"];

export type Fixture = {
  id: string;
  city: string;
  profile: Profile;
};

export const FIXTURES: Fixture[] = CITIES.flatMap((city) =>
  PROFILES.map((profile) => ({ id: `${city.toLowerCase()}-${profile.id}`, city, profile })),
);
