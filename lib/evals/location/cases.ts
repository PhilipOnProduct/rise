/**
 * PHI-118 — Location-constraint eval cases for /api/itinerary/edit.
 *
 * 6 trap cases (wrong-city items in context) — extracted verbatim from
 * `scripts/eval-itinerary-location.ts`.
 */

export type EditRequest = {
  mode: "swap" | "add";
  destination: string;
  dayNumber: number;
  date: string;
  block: "morning" | "afternoon" | "evening";
  dayItems: { title: string; description: string; time_block: string }[];
  replacingItem?: { title: string; description: string };
  rejectedTitles?: string[];
  travelCompany: string;
  travelerTypes: string[];
  budgetTier: string;
  travelerCount: number;
  childrenAges: string[] | null;
  // PHI-51: optional creative-inspiration soft bias. When set, the route
  // injects a single-slot bias clause; the trap case below verifies the
  // hallucination guard prevents wrong-city famous-but-themed POIs.
  inspiration?: string;
};

export type TestCase = {
  label: string;
  request: EditRequest;
  criteria: string[];
};

export const TEST_CASES: TestCase[] = [
  {
    label: "Swap: replacing a Paris activity in an Amsterdam itinerary",
    request: {
      mode: "swap",
      destination: "Amsterdam",
      dayNumber: 2,
      date: "2025-06-17",
      block: "morning",
      dayItems: [
        { title: "Canal boat tour", description: "Cruise through Amsterdam's historic canals", time_block: "afternoon" },
        { title: "Dinner at De Kas", description: "Farm-to-table restaurant in a greenhouse", time_block: "evening" },
      ],
      replacingItem: { title: "Eiffel Tower visit", description: "Famous Paris landmark with panoramic city views" },
      travelCompany: "partner",
      travelerTypes: ["Cultural"],
      budgetTier: "mid-range",
      travelerCount: 2,
      childrenAges: null,
    },
    criteria: [
      "The suggested activity is physically located in Amsterdam or its immediate surroundings (not Paris or any other city)",
      "The title does not reference the Eiffel Tower, Paris, or any Paris-specific landmark",
      "The description references Amsterdam-specific places, streets, or neighbourhoods",
    ],
  },
  {
    label: "Swap: replacing a Berlin museum in a Lisbon itinerary",
    request: {
      mode: "swap",
      destination: "Lisbon",
      dayNumber: 3,
      date: "2025-04-18",
      block: "morning",
      dayItems: [
        { title: "Lunch at Zé da Mouraria", description: "No-frills tasca beloved by locals for bacalhau", time_block: "afternoon" },
        { title: "Fado show in Alfama", description: "Traditional Portuguese music in an intimate venue", time_block: "evening" },
      ],
      replacingItem: { title: "Pergamon Museum Visit", description: "Explore the monumental Pergamon Altar and Ishtar Gate on Berlin's Museum Island" },
      travelCompany: "solo",
      travelerTypes: ["History", "Cultural"],
      budgetTier: "mid-range",
      travelerCount: 1,
      childrenAges: null,
    },
    criteria: [
      "The suggested activity is physically located in Lisbon (not Berlin or any other city)",
      "The title does not reference the Pergamon Museum, Berlin, or any Berlin-specific landmark",
      "The description references Lisbon-specific places, landmarks, or neighbourhoods",
    ],
  },
  {
    label: "Add: filling a slot in Barcelona with wrong-city context",
    request: {
      mode: "add",
      destination: "Barcelona",
      dayNumber: 1,
      date: "2025-07-10",
      block: "afternoon",
      dayItems: [
        { title: "Big Ben & Houses of Parliament", description: "Iconic London landmark on the Thames", time_block: "morning" },
        { title: "London Eye ride", description: "Panoramic views of London from the Ferris wheel", time_block: "morning" },
        { title: "Tapas at Bar Mut", description: "Upscale tapas in Diagonal neighbourhood", time_block: "evening" },
      ],
      travelCompany: "friends",
      travelerTypes: ["Food-led", "Adventure"],
      budgetTier: "mid-range",
      travelerCount: 4,
      childrenAges: null,
    },
    criteria: [
      "The suggested activity is physically located in Barcelona (not London or any other city)",
      "The title does not reference Big Ben, London Eye, London, or any London-specific landmark",
      "The suggestion fits a food-led or adventurous group of friends in Barcelona",
    ],
  },
  {
    label: "Swap: replacing a Tokyo activity in a Rome itinerary",
    request: {
      mode: "swap",
      destination: "Rome",
      dayNumber: 4,
      date: "2025-09-20",
      block: "afternoon",
      dayItems: [
        { title: "Colosseum guided tour", description: "Skip-the-line tour of the ancient amphitheatre", time_block: "morning" },
        { title: "Dinner in Trastevere", description: "Trattoria hopping in Rome's most charming neighbourhood", time_block: "evening" },
      ],
      replacingItem: { title: "Tsukiji Outer Market tour", description: "Fresh sushi and street food in Tokyo's famous fish market district" },
      travelCompany: "family",
      travelerTypes: ["Food-led", "Cultural"],
      budgetTier: "mid-range",
      travelerCount: 4,
      childrenAges: ["5–8", "9–12"],
    },
    criteria: [
      "The suggested activity is physically located in Rome (not Tokyo or any other city)",
      "The title does not reference Tsukiji, Tokyo, or any Japan-specific landmark",
      "The suggestion is suitable for a family with children aged 5–12",
      "The description references Rome-specific places or Italian food/culture",
    ],
  },
  {
    label: "PHI-51: Harry Potter inspired Edinburgh — must NOT suggest Warner Bros (Watford)",
    request: {
      mode: "add",
      destination: "Edinburgh",
      dayNumber: 2,
      date: "2025-08-12",
      block: "afternoon",
      dayItems: [
        { title: "The Elephant House", description: "Café where J.K. Rowling drafted early Harry Potter chapters", time_block: "morning" },
        { title: "Dinner in Old Town", description: "Traditional Scottish fare on the Royal Mile", time_block: "evening" },
      ],
      travelCompany: "family",
      travelerTypes: ["Cultural", "Kid-friendly"],
      budgetTier: "comfortable",
      travelerCount: 3,
      childrenAges: ["9–12"],
      inspiration: "Harry Potter",
    },
    criteria: [
      "The suggested activity is physically located in Edinburgh (not Watford, London, or any other city)",
      "The title does NOT reference Warner Bros, the Wizarding World studio tour, or any London/Watford-area Harry Potter attraction",
      "The activity is real and verifiable — no invented Wizarding-themed venues that don't exist (e.g. fake themed cafes or fictional shops)",
      "If the suggestion references the Harry Potter inspiration, it cites a real Edinburgh location plausibly linked to the books (Greyfriars Kirkyard, Victoria Street, the Elephant House, the Edinburgh Writers' Museum, etc.) — or it leans on a non-themed Edinburgh activity that fits the slot",
    ],
  },
  {
    label: "Add: empty morning in Prague — no trap context",
    request: {
      mode: "add",
      destination: "Prague",
      dayNumber: 2,
      date: "2025-05-15",
      block: "morning",
      dayItems: [
        { title: "Lunch at Lokál", description: "Classic Czech pub food and tank beer", time_block: "afternoon" },
        { title: "Jazz at Reduta Club", description: "Oldest jazz club in Prague, intimate setting", time_block: "evening" },
      ],
      travelCompany: "partner",
      travelerTypes: ["Cultural", "Food-led"],
      budgetTier: "budget",
      travelerCount: 2,
      childrenAges: null,
    },
    criteria: [
      "The suggested activity is physically located in Prague",
      "The suggestion fits a cultural couple on a budget",
      "The suggestion is appropriate for a morning time slot",
    ],
  },
];
