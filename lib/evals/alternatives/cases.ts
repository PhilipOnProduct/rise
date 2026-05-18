/**
 * PHI-118 — Restaurant alternative eval cases.
 *
 * 5 replacement scenarios for /api/itinerary/alternative. Extracted
 * verbatim from `scripts/eval-alternatives.ts` (which was an orphan
 * pre-PHI-118 — see also package.json wiring).
 */

export type AlternativeRequest = {
  destination: string;
  departureDate: string;
  returnDate: string;
  travelCompany: string;
  travelerTypes: string[];
  budgetTier: string;
  replacingRestaurant: string;
  cuisine: string;
  vibe: string;
  timeBlock: string;
  date: string;
  dayNumber: number;
};

export type TestCase = {
  label: string;
  request: AlternativeRequest;
  criteria: string[];
};

export const TEST_CASES: TestCase[] = [
  {
    label: "Italian dinner swap in Rome (mid-range couple)",
    request: {
      destination: "Rome",
      departureDate: "2025-06-10",
      returnDate: "2025-06-15",
      travelCompany: "Couple",
      travelerTypes: ["Foodie — food comes first", "Cultural"],
      budgetTier: "comfortable",
      replacingRestaurant: "Trattoria Da Enzo al 29",
      cuisine: "Italian",
      vibe: "romantic",
      timeBlock: "evening",
      date: "2025-06-12",
      dayNumber: 3,
    },
    criteria: [
      "The alternative is a real, specific restaurant in Rome (not generic)",
      "It is different from Trattoria Da Enzo al 29 — different name and ideally different cuisine or vibe",
      "It fits an evening dining slot",
      "Price tier is appropriate for mid-range/comfortable budget (€€ or €€€)",
      "The response includes valid booking_meta with a search_query field",
      "The description is specific to Rome, not generic",
    ],
  },
  {
    label: "Budget sushi swap in Tokyo (solo backpacker)",
    request: {
      destination: "Tokyo",
      departureDate: "2025-08-01",
      returnDate: "2025-08-14",
      travelCompany: "Solo",
      travelerTypes: ["Adventurer — off the beaten track"],
      budgetTier: "budget",
      replacingRestaurant: "Sushi Dai",
      cuisine: "Japanese",
      vibe: "authentic",
      timeBlock: "afternoon",
      date: "2025-08-05",
      dayNumber: 5,
    },
    criteria: [
      "The alternative is a real, specific restaurant in Tokyo",
      "It is different from Sushi Dai — genuinely different option",
      "It fits a budget tier (€ or €€ pricing)",
      "It suits a solo traveler",
      "The response includes valid booking_meta with search_query",
      "It is appropriate for an afternoon meal slot",
    ],
  },
  {
    label: "Luxury seafood swap in Barcelona (family)",
    request: {
      destination: "Barcelona",
      departureDate: "2025-07-20",
      returnDate: "2025-07-27",
      travelCompany: "Family",
      travelerTypes: ["Relaxed", "Foodie — food comes first"],
      budgetTier: "luxury",
      replacingRestaurant: "Can Solé",
      cuisine: "Seafood",
      vibe: "lively",
      timeBlock: "evening",
      date: "2025-07-23",
      dayNumber: 4,
    },
    criteria: [
      "The alternative is a real, specific restaurant in Barcelona",
      "It is different from Can Solé",
      "Price tier matches luxury budget (€€€ or €€€€)",
      "It is family-friendly or at least not explicitly adults-only",
      "The response includes valid booking_meta with all three fields",
      "The description references Barcelona specifically",
    ],
  },
  {
    label: "Brunch swap in Lisbon (friends, weekend)",
    request: {
      destination: "Lisbon",
      departureDate: "2025-09-05",
      returnDate: "2025-09-09",
      travelCompany: "Friends",
      travelerTypes: ["Nightlife", "Art & Design"],
      budgetTier: "comfortable",
      replacingRestaurant: "Café A Brasileira",
      cuisine: "Café",
      vibe: "trendy",
      timeBlock: "morning",
      date: "2025-09-06",
      dayNumber: 2,
    },
    criteria: [
      "The alternative is a real, specific restaurant/café in Lisbon",
      "It is different from Café A Brasileira",
      "It fits a morning time slot (brunch, breakfast, or café)",
      "It suits a group of friends with artsy/nightlife interests",
      "The response includes valid booking_meta with search_query",
      "Price tier is appropriate for comfortable budget",
    ],
  },
  {
    label: "High-demand New Year's Eve dinner swap in Paris (couple, luxury)",
    request: {
      destination: "Paris",
      departureDate: "2025-12-29",
      returnDate: "2026-01-03",
      travelCompany: "Couple",
      travelerTypes: ["Comfort traveler — good hotels and restaurants"],
      budgetTier: "luxury",
      replacingRestaurant: "Le Cinq",
      cuisine: "French fine dining",
      vibe: "elegant",
      timeBlock: "evening",
      date: "2025-12-31",
      dayNumber: 3,
    },
    criteria: [
      "The alternative is a real, specific restaurant in Paris",
      "It is different from Le Cinq",
      "It matches luxury budget tier (€€€ or €€€€)",
      "It is suitable for a special New Year's Eve dinner (the model should recognise the date significance)",
      "The response includes valid booking_meta with all three fields",
      "The description or vibe reflects the romantic/celebratory occasion",
    ],
  },
];
