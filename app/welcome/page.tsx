"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { track } from "@vercel/analytics";
import type { TripIntent } from "@/lib/trip-intent";
import { newLegId, type PlaceRef, type TripLeg } from "@/lib/trip-schema";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { cityLabel } from "@/lib/destination-label";
import type { NeighborhoodCard } from "@/lib/neighborhood-gen-prompt";
import { LandingFreeForm } from "./LandingFreeForm";
import { LandingStructured } from "./LandingStructured";
import { Step1Destination } from "./steps/Step1Destination";
import {
  Step2HotelSingle,
  Step2NeighborhoodPicker,
  Step2HotelMultiLeg,
} from "./steps/Step2Hotel";
import { Step3Preferences } from "./steps/Step3Preferences";
import { Step35CityPicker } from "./steps/Step35CityPicker";
import { Step4MustDos } from "./steps/Step4MustDos";
import { Step5Preview } from "./steps/Step5Preview";
import { Step6Account } from "./steps/Step6Account";
import {
  TOTAL_WIZARD_STEPS,
  getStyleOptions,
  MAX_STYLE_SELECTIONS,
  EMAIL_RE,
  FALLBACK_CHIPS,
} from "./welcome-constants";
import {
  addDays,
  splitSeededActivities,
  nightsBetween,
  equalSplitNights,
  parseActivities,
  logActivityEvent,
} from "./welcome-helpers";
import type {
  ActivityFeedbackEntry,
  Chip,
  ChipsEntry,
  ParsedActivity,
  PreviewDay,
} from "./welcome-types";

export type { ActivityFeedbackEntry } from "./welcome-types";

// ── Main page ──────────────────────────────────────────────────────────────

// PHI-48: useSearchParams() requires a Suspense boundary at build time.
// The default export below wraps this inner component in Suspense so the
// production prerender doesn't bail out. Local dev was forgiving — this
// only surfaced on Vercel build.
function WelcomePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  // PHI-48: one-time seed from `?destination=` query param sent by the
  // landing-page CTA. Treated as initial state, not a controlled value —
  // the user's edits to the destination input win after the seed fires.
  const seededFromUrlRef = useRef(false);

  // Trip data
  const [destination, setDestination] = useState("");
  const [destinationBias, setDestinationBias] = useState<{ lat: number; lng: number } | null>(null);
  // PHI-30: destinationVerified is true only when the user explicitly
  // selected a place from the autocomplete dropdown OR clicked the
  // "Use anyway" escape. Free-form typed text is *unverified* — Continue
  // is gated until the user resolves it. Closes the trust gap from the
  // May 2026 onboarding review where typing "Lisbon, Portugal" silently
  // resolved to a different place.
  const [destinationVerified, setDestinationVerified] = useState(false);
  // Follow-up #4: resolved PlaceRef for the primary destination — populated
  // either by the parser flow (via /api/resolve-place) or by future
  // PHI-30-aware autocomplete wiring. Persisted on save so the leg carries
  // lat/lng/id, not just a name.
  const [destinationPlace, setDestinationPlace] = useState<PlaceRef | null>(null);
  const [departureDate, setDepartureDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [hotel, setHotel] = useState("");
  // PHI-111: rich hotel payload captured when the user picks a Places
  // suggestion in step 2 (single-leg path). null when the user typed a
  // hotel name without picking a suggestion, or skipped the step entirely.
  // Flows to the API on save so the row's flat hotel_lat/lng columns and
  // legs[0]'s rich fields land in one shot.
  type HotelRich = {
    placeId: string;
    lat: number;
    lng: number;
    neighborhood: string | null;
  };
  const [hotelRich, setHotelRich] = useState<HotelRich | null>(null);

  // PHI-99: flex-date entry. When the user clicks "Not sure yet — I'm just
  // exploring →" below the Return field on step 1, we swap the two date
  // inputs for a month dropdown + nights stepper. Toggling between modes
  // preserves destination + hotel state — only the date/flex pair flips.
  // flexMonth carries an ISO month string (e.g. "2026-10") so the server
  // can parse it unambiguously regardless of locale.
  const [flexMode, setFlexMode] = useState(false);
  const [flexMonth, setFlexMonth] = useState("");
  const [flexNights, setFlexNights] = useState(5);

  // PHI-109: when the free-form parser inferred a duration ("5 days late
  // September") without explicit dates, capture that here so the
  // departure-date default effect uses the parser's number instead of the
  // hardcoded 7. Null on the structured-wizard path so the 7 fallback holds.
  const [parserInferredNights, setParserInferredNights] = useState<number | null>(null);

  // PHI-109 (regression fix): explicit "user has set Return" flag. The
  // previous empty-guard misfires on Chrome's `<input type="date">` —
  // when the user types `01/10/2026` keystroke-by-keystroke, the input
  // emits `onChange` after each year-segment completion (`0001-10-01`,
  // `0010-10-01`, `0102-10-01`, `2026-10-01`). With an empty-guard, the
  // FIRST emit (year 0001) lands the auto-default at year 0002, and
  // subsequent Departure-year emits don't update Return any more. The
  // flag lets the effect re-fire on every Departure change as long as
  // the user hasn't explicitly set Return — both the parser-typed-both-
  // dates case (flag flips true in applyParsedIntentAndAdvance) and the
  // user-typed-Return-on-step-1 case (flag flips true in the Return
  // input's onChange) keep their explicit value, while the keyboard-
  // typing-Departure-only case re-derives Return until Departure
  // stabilises. Cleared when Return is wiped so a future Departure edit
  // re-auto-fills.
  const [userTypedReturn, setUserTypedReturn] = useState(false);

  // PHI-100: soft neighbourhood picker on step 2. When the traveller hasn't
  // booked a hotel they can opt into picking a neighbourhood instead.
  // `neighborhoodPickerOpen` swaps the hotel input area for the cards.
  // Selecting one fills `anchorNeighborhood` and continues to step 3 —
  // downstream activity-gen / itinerary-gen receive it as a soft area
  // anchor when no hotel is set. No Anthropic call fires until the user
  // explicitly opens the picker; cards are cached per visit so reopening
  // doesn't re-bill.
  const [neighborhoodPickerOpen, setNeighborhoodPickerOpen] = useState(false);
  const [neighborhoodCards, setNeighborhoodCards] = useState<NeighborhoodCard[]>([]);
  const [neighborhoodsLoading, setNeighborhoodsLoading] = useState(false);
  const [neighborhoodsError, setNeighborhoodsError] = useState<string | null>(null);
  const [anchorNeighborhood, setAnchorNeighborhood] = useState("");

  // Preferences (Step 3)
  const [travelCompany, setTravelCompany] = useState("");
  const [adultCount, setAdultCount] = useState(2);
  const [childrenAges, setChildrenAges] = useState<string[]>([]);
  const [travelerTypes, setTravelerTypes] = useState<string[]>([]);
  const [budgetTier, setBudgetTier] = useState("");

  // PHI-35: optional constraints. tags are chip-toggleable; freeText is a
  // textarea for anything not covered by chips.
  const [constraintTags, setConstraintTags] = useState<string[]>([]);
  const [constraintText, setConstraintText] = useState("");

  // PHI-51: optional creative inspiration captured by the free-form parser.
  // Sits below constraint chips on the chip-confirm screen as an editable
  // chip ("Inspired by: Harry Potter"). Threaded into activity-gen and
  // itinerary-gen calls when set.
  const [inspiration, setInspiration] = useState("");

  // PHI-90: traveller-seeded must-dos. The new Step 4 collects a free-text
  // list (one item per line). Stored as a single string in component
  // state so the textarea round-trips naturally; we split + trim at save
  // time and at API-call time. Empty / whitespace-only = no anchors and
  // the existing prompt path runs unchanged.
  const [userSeededText, setUserSeededText] = useState("");

  // PHI-102 — popular picks panel state. Local to step 4; reset on
  // destination change because the cache key includes city. The panel is
  // collapsed by default so users who already have anchors aren't tempted
  // to skip their own typing. picksDisabled stays true for a destination
  // when Haiku returns <3 picks (sub-minimum fallback), so the affordance
  // hides for the rest of the session.
  type PopularPickRow = {
    name: string;
    context_note: string;
    category: "friction" | "fit" | "pro_tip";
  };
  const [popularPicksOpen, setPopularPicksOpen] = useState(false);
  const [popularPicks, setPopularPicks] = useState<PopularPickRow[]>([]);
  const [popularPicksLoading, setPopularPicksLoading] = useState(false);
  const [popularPicksError, setPopularPicksError] = useState<string | null>(null);
  // Per-destination disable — when Haiku returned <3 picks for this city,
  // hide the affordance for the rest of the session so the user isn't
  // staring at a dead button.
  const [popularPicksDisabledForDest, setPopularPicksDisabledForDest] = useState<string | null>(null);
  // Soft-cap nudge — once the user has added 5 picks via the panel in
  // this session, surface a one-time "Add anything else?" line. Fires
  // once per session regardless of which destination.
  const [popularPicksAddedCount, setPopularPicksAddedCount] = useState(0);
  const popularPicksNudgeFiredRef = useRef(false);

  // Account
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // PHI-47: only show the inline email error after the field has been
  // blurred at least once — typing "p" shouldn't immediately read as wrong.
  const [emailTouched, setEmailTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  // Partial traveler ID written to DB at step 3 advance
  const [travelerId, setTravelerId] = useState<string | null>(null);

  // AI Preview (step 4)
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewAbortRef = useRef<AbortController | null>(null);
  // PHI-53: trip-date forecast on the activity preview. null = forecast
  // unavailable, slow, or no bad days — render nothing. Non-empty array =
  // bad-day count for the rainy-day hint banner above the cards.
  const [previewBadDays, setPreviewBadDays] = useState<string[] | null>(null);

  // PHI-31 Part 2 slice 2: itinerary preview rendered on step 5 BEFORE
  // signup. Generated by /api/itinerary/generate using the full state we
  // already have (destination, dates, party, styles, activity feedback).
  const [itineraryPreview, setItineraryPreview] = useState<PreviewDay[] | null>(null);
  const [itineraryPreviewLoading, setItineraryPreviewLoading] = useState(false);
  const [itineraryPreviewError, setItineraryPreviewError] = useState<string | null>(null);
  // PHI-90: top-level "placement_notes" from /api/itinerary/generate when
  // an anchor was filtered out (wrong city) or couldn't be fitted. Mirrors
  // the response shape returned to /itinerary so the preview surfaces it
  // here too rather than swallowing it silently.
  const [itineraryPlacementNotes, setItineraryPlacementNotes] = useState<string | null>(null);
  // PHI-114: top-level "time_sensitive_alerts" — one-sentence facts the
  // traveller must verify or act on (closures, pre-booking, seasonal
  // cutoffs, peak-time advice, transport quirks). Rendered as a "Before
  // you go" amber block ABOVE the placement_notes callout. Null = nothing
  // actionable to flag; UI renders nothing in that case.
  const [itineraryTimeSensitiveAlerts, setItineraryTimeSensitiveAlerts] = useState<
    string[] | null
  >(null);
  const itineraryAbortRef = useRef<AbortController | null>(null);
  const itineraryViewedFiredRef = useRef(false);

  // PHI-34 UI: parser-mode landing. Per Sarah's PRD, the dual-CTA hero is
  // the default first impression — free-form textarea is primary, the
  // structured form is the fallback. parserPhase drives which view step 0
  // renders; once we leave step 0 the existing structured wizard runs.
  const [parserPhase, setParserPhase] = useState<
    "landing" | "parsing" | "confirming" | "structured"
  >("landing");
  const [parserText, setParserText] = useState("");
  const [parsedIntent, setParsedIntent] = useState<TripIntent | null>(null);
  const [parserError, setParserError] = useState<string | null>(null);
  // PHI-54: cities seeded from the curated atlas (case-insensitive). Used
  // to render a "suggested" tag on those destination chips so the user
  // knows they were proposed by Rise rather than typed.
  const [atlasSuggestedCities, setAtlasSuggestedCities] = useState<Set<string>>(
    new Set(),
  );
  // PHI-57: country-level destination state. When the user types a
  // country (Places result type === "country"), step 3.5 surfaces 4
  // AI-recommended cities/regions personalised to their preferences.
  const [countryRecommendations, setCountryRecommendations] = useState<
    { name: string; kind: "city" | "region"; why: string; lat?: number; lng?: number }[]
  >([]);
  const [countryRecsLoading, setCountryRecsLoading] = useState(false);
  const [countryRecsError, setCountryRecsError] = useState<string | null>(null);
  // Follow-up #4: resolved places for parser output. Keyed by destination
  // name as the parser returned it. Populated in the background while the
  // user is reviewing chips, so when they accept we already have lat/lng/id
  // for the structured form + persisted leg.
  const [resolvedPlaces, setResolvedPlaces] = useState<Record<string, PlaceRef>>({});
  // PHI-37 slice 4: per-leg night overrides edited on the chip-confirm
  // screen via the date allocator. Default empty — applyParsedIntentAndAdvance
  // falls back to equal-split when no override exists. Cleared on parse
  // start and on chip-screen "Start over".
  const [legNightOverrides, setLegNightOverrides] = useState<number[]>([]);
  // PHI-46: which chip on the chip-confirm screen is currently in edit
  // mode. Values: null | "destination-add" | "destination-N" | "dates"
  // | "adults". Replaces window.prompt() for these three chip types.
  const [editingChipKey, setEditingChipKey] = useState<string | null>(null);
  // PHI-46: live-typed value for the destination autocomplete during
  // inline edit. Snapshot taken when editing begins; the underlying
  // parsedIntent only updates on commit.
  const [destEditDraft, setDestEditDraft] = useState("");
  // PHI-37 slice 1: per-leg snapshot taken at chip-accept time. Holds the
  // parser's destinations (with resolved PlaceRefs where available) and a
  // per-leg night allocation. Empty / single-entry means single-leg path
  // and the existing `destination` field is the source of truth. 2+ entries
  // means the trip is multi-leg and we send `legs[]` to the API at save
  // time. Date allocation is equal-split for v1 (slice 4 will add a UI
  // for the user to override).
  const [parsedLegs, setParsedLegs] = useState<
    { place: PlaceRef; nights: number }[]
  >([]);
  // PHI-39: per-leg hotels for multi-leg trips. Indexed by leg, each
  // entry is the hotel name (free text via PlacesAutocomplete) or "" if
  // the user skipped that leg. For single-leg trips this stays empty
  // and the existing `hotel` state is the source of truth. Sized in
  // applyParsedIntentAndAdvance + chip-edit handlers to match parsedLegs.
  const [legHotels, setLegHotels] = useState<string[]>([]);
  // PHI-111: per-leg rich hotel payloads — parallel array to legHotels.
  // null entries = no rich data for that leg (user typed without picking,
  // or skipped). Persisted into legs[i] before save so each leg carries
  // its own coords; leg 0's coords additionally mirror to the flat
  // hotel_* columns for single-leg-aware consumers.
  const [legHotelsRich, setLegHotelsRich] = useState<(HotelRich | null)[]>([]);

  // Activity cards + feedback
  const [parsedActivities, setParsedActivities] = useState<ParsedActivity[]>([]);
  const [activityChips, setActivityChips] = useState<Record<string, ChipsEntry>>({});
  const [activityFeedback, setActivityFeedback] = useState<
    Record<string, ActivityFeedbackEntry>
  >({});
  const [openChipId, setOpenChipId] = useState<string | null>(null);
  const chipsFetchedRef = useRef<Set<string>>(new Set());
  // Tracks submitted activities so dynamic chip swaps don't disrupt in-flight interactions
  const submittedActivitiesRef = useRef<Set<string>>(new Set());
  // PHI-44: shown briefly when a step-4 stream restarts after the user
  // had prior ratings — explains why the rated cards just disappeared.
  // Cleared once the new stream finishes, or after a 4s timeout fallback.
  const [streamRefreshNote, setStreamRefreshNote] = useState(false);
  // PHI-44: ref-mirrored count of activityFeedback so the stream useEffect
  // can detect "had prior ratings" without subscribing to feedback updates
  // (which would re-fire the stream on every thumbs-up).
  const activityFeedbackCountRef = useRef(0);

  // PHI-64: detect an existing Supabase session so we can skip the
  // "Send magic link" form on step 5. authedUser carries the signed-in
  // user's id + email + a best-effort name (from auth metadata or a prior
  // traveler row). When non-null, step 5 saves the trip and routes
  // straight to /dashboard instead of mailing a magic link.
  type AuthedUser = { id: string; email: string; existingName: string | null };
  const [authedUser, setAuthedUser] = useState<AuthedUser | null>(null);
  // Guard so the auto-finish on step 5 only fires once per session.
  const autoFinishedRef = useRef(false);
  // PHI-88: Vercel Analytics — guard against double-firing magic_link_sent
  // for the same click (e.g. React strict-mode double-invocation in dev).
  const magicLinkSentRef = useRef(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let cancelled = false;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled || !session?.user) return;

      const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
      const metaName =
        (typeof meta.full_name === "string" && meta.full_name.trim()) ||
        (typeof meta.name === "string" && meta.name.trim()) ||
        null;

      let existingName: string | null = metaName || null;
      if (!existingName) {
        // Best-effort: a returning user who signed up earlier will have
        // their name on a previous traveler row linked by auth_user_id.
        const { data } = await supabase
          .from("travelers")
          .select("name")
          .eq("auth_user_id", session.user.id)
          .not("name", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data && typeof (data as { name?: unknown }).name === "string") {
          const n = (data as { name: string }).name.trim();
          if (n) existingName = n;
        }
      }
      if (cancelled) return;

      const sessionEmail = session.user.email ?? "";
      setAuthedUser({ id: session.user.id, email: sessionEmail, existingName });
      // Pre-fill name/email if the user hasn't typed anything yet. Functional
      // setState avoids overwriting an in-progress edit.
      if (existingName) setName((prev) => (prev.trim().length > 0 ? prev : existingName!));
      if (sessionEmail) setEmail((prev) => (prev.trim().length > 0 ? prev : sessionEmail));
    })();

    // If the session expires mid-flow we drop authedUser and the standard
    // anonymous step-5 form takes over.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session?.user) {
          setAuthedUser(null);
          autoFinishedRef.current = false;
        }
      },
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // PHI-109: re-derive Return from Departure ONLY when the user hasn't
  // explicitly set Return yet. `userTypedReturn` is the source of truth —
  // see the state definition above for why the original empty-guard
  // misfired on Chrome keyboard typing. When the parser supplies an
  // inferred duration (`parserInferredNights`), that's the preferred
  // offset over the hardcoded 7. The effect re-fires on every Departure
  // change so structured-wizard keyboard typing — which emits partial
  // dates per year-segment — eventually lands on the correct full year.
  useEffect(() => {
    if (!departureDate) return;
    if (userTypedReturn) return;
    setReturnDate(addDays(departureDate, parserInferredNights ?? 7));
  }, [departureDate, parserInferredNights, userTypedReturn]);

  // PHI-48 / PHI-58: seed once from query params sent by the landing page.
  // `?parser_text=` (PHI-58) takes precedence — when the homepage detects
  // free-form input it forwards the raw text here and we hand off straight
  // to the parser flow. Otherwise `?destination=` (PHI-48) drops the user
  // into Step 1 with the structured wizard pre-filled. The ref guard
  // prevents re-seeding when the user navigates back from later steps.
  useEffect(() => {
    if (seededFromUrlRef.current) return;
    const parserSeed = searchParams.get("parser_text")?.trim();
    if (parserSeed) {
      seededFromUrlRef.current = true;
      setParserText(parserSeed);
      // Strip the param from the URL so a refresh doesn't re-fire the
      // parser. replaceState skips the Next.js router on purpose — the
      // useSearchParams snapshot can stay stale, the ref guard already
      // prevents re-entry.
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("parser_text");
        window.history.replaceState(null, "", url.toString());
      }
      void submitFreeForm(parserSeed);
      return;
    }
    const seed = searchParams.get("destination")?.trim();
    if (!seed) return;
    seededFromUrlRef.current = true;
    handleDestinationSelect(seed);
    setStep(1);
    // PHI-88: URL-seed advance is still a step transition. SessionStorage
    // key matches the goTo() path so we don't double-fire if the user
    // re-enters /welcome with the same seed in the same tab.
    if (typeof window !== "undefined" && !sessionStorage.getItem("rise_va_step_1_fired")) {
      sessionStorage.setItem("rise_va_step_1_fired", "1");
      track("welcome_step_advanced", { step: 1 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Derive valid trip type options from composition and auto-set/clear travelCompany
  useEffect(() => {
    if (childrenAges.length > 0) {
      setTravelCompany("family");
      return;
    }
    const validIds =
      adultCount === 1 ? ["solo"] :
      adultCount === 2 ? ["partner", "friends"] :
      ["friends", "family"];
    if (validIds.length === 1) {
      setTravelCompany(validIds[0]);
    } else {
      setTravelCompany((prev) => validIds.includes(prev) ? prev : "");
    }
  }, [adultCount, childrenAges.length]);

  // Clear style selections that are no longer available when company changes
  useEffect(() => {
    if (!travelCompany) return;
    const available = getStyleOptions(travelCompany);
    setTravelerTypes((prev) => prev.filter((t) => available.includes(t)));
  }, [travelCompany]);

  // PHI-44: auto-dismiss the "refreshing your picks" note after 4s so it
  // doesn't linger past the new stream's first cards arriving.
  useEffect(() => {
    if (!streamRefreshNote) return;
    const t = setTimeout(() => setStreamRefreshNote(false), 4000);
    return () => clearTimeout(t);
  }, [streamRefreshNote]);

  // PHI-44: keep activityFeedbackCountRef in sync without making the
  // stream useEffect depend on the full feedback object.
  useEffect(() => {
    activityFeedbackCountRef.current = Object.keys(activityFeedback).length;
  }, [activityFeedback]);

  // Follow-up #2 — Maya's Tier-3 escalation: modal-on-leave.
  // Once the user has invested real time (step 4+) and we don't yet have an
  // email, attach a beforeunload listener. Modern browsers ignore the custom
  // string and show their generic "Leave site? Changes you made may not be
  // saved" prompt — that's by design and is exactly what we want here.
  // The anonymous-session row keeps the trip alive on the server side; this
  // prompt just makes sure the user doesn't lose access by closing the tab
  // before they realise the trip is unsaved.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // PHI-90: previously step 4 (AI preview). Now step 5 — guard moved
    // along with the step renumber so the prompt fires at the same point
    // in the flow (after the AI preview has streamed in).
    const guarded = step >= 5 && !email && parsedActivities.length > 0;
    if (!guarded) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Required for legacy browsers; modern ones ignore the string.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [step, email, parsedActivities.length]);

  // Fire streaming preview when entering the AI-preview step — parse cards
  // incrementally. PHI-90 renumber: AI preview was step 4, now step 5.
  useEffect(() => {
    if (step !== 5) return;

    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);
    setParsedActivities([]);
    setPreviewBadDays(null);
    chipsFetchedRef.current = new Set();
    submittedActivitiesRef.current = new Set();
    // PHI-44: a stream restart after the user already rated cards would
    // leave their feedback attached to ID slots (act-0, act-1...) that
    // a new stream re-uses for different activities. Reset every piece
    // of feedback/chip state, and surface a one-line note explaining
    // why their ratings just disappeared. We read prior count from a
    // ref so the stream effect doesn't depend on the feedback object.
    const hadPriorFeedback = activityFeedbackCountRef.current > 0;
    setActivityFeedback({});
    setActivityChips({});
    setOpenChipId(null);
    if (hadPriorFeedback) setStreamRefreshNote(true);

    (async () => {
      let accumulated = "";
      let emittedCount = 0;
      try {
        // PHI-37 slice 2: include legs[] when multi-leg so the activity
        // stream is generated per-leg with LEG: <index> markers.
        const legsForApi = buildLegsForApi();
        const res = await fetch("/api/activities-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            destination,
            // PHI-99: dates only on the exact path; flex columns instead
            // when the user took the "I'm just exploring" route.
            ...(flexMode
              ? { flexMonth, flexNights }
              : {
                  departureDate: departureDate || "",
                  returnDate: returnDate || "",
                }),
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            // PHI-35: optional constraints. Empty fields are dropped server-side.
            constraintTags: constraintTags.length > 0 ? constraintTags : null,
            constraintText: constraintText.trim() || null,
            // PHI-51: optional creative-inspiration soft bias.
            inspiration: inspiration.trim() || null,
            // PHI-100: soft area anchor when no hotel is set.
            anchorNeighborhood: anchorNeighborhood || null,
            ...(legsForApi && { legs: legsForApi }),
          }),
        });
        if (!res.body) return;
        // PHI-53: forecast result is attached as a response header
        // (server runs Open-Meteo in parallel with the Anthropic stream).
        // Header is only set when bad days were detected — absence means
        // either no bad days, forecast unavailable, or out-of-horizon.
        // Treat absence as "no banner".
        try {
          const badDayHeader = res.headers.get("X-Bad-Day-Dates");
          if (badDayHeader) {
            const days: unknown = JSON.parse(badDayHeader);
            if (Array.isArray(days) && days.every((d) => typeof d === "string")) {
              setPreviewBadDays(days as string[]);
            }
          }
        } catch {
          // Malformed header — ignore.
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          // Parse all complete cards so far
          const all = parseActivities(accumulated);
          // A card is "complete" if there's a subsequent ** delimiter or we can count
          // that more text follows after the card's *When:...* line. We detect this
          // by checking if there's a next ** header after the current card's match.
          // Since parseActivities uses a greedy regex that only matches fully-formed
          // cards, we emit all parsed cards except the last one (which might still be
          // streaming) unless a new ** header follows it.
          const hasTrailingHeader = /\*When:[^*]+\*[^]*?\*\*/.test(
            accumulated.slice(accumulated.lastIndexOf("*When:"))
          );
          const safeCount = all.length > 0 && !hasTrailingHeader ? all.length - 1 : all.length;
          if (safeCount > emittedCount) {
            const newCards = all.slice(0, safeCount);
            emittedCount = safeCount;
            setParsedActivities(newCards);
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
          console.error("[preview]", e);
        }
      }
      // Final parse — emit all remaining cards. PHI-32: always re-emit so
      // any rationales that arrived after a card was first emitted get
      // applied to the rendered cards.
      const final = parseActivities(accumulated);
      if (final.length > 0) {
        setParsedActivities(final);
      }
      setPreviewLoading(false);
    })();

    return () => {
      controller.abort();
    };
  }, [step, destination, departureDate, returnDate, flexMode, flexMonth, flexNights, travelCompany, travelerTypes, budgetTier]);

  // PHI-31 Part 2 slice 2: generate the itinerary preview when entering
  // the account step, so the user sees the actual product output BEFORE
  // the signup form. This is the activation lever: 4 of 5 personas in the
  // May 2026 review flagged forced-signup as drop-off; showing payoff
  // first should close most of that gap. PHI-90 renumber: account step
  // was 5, now 6.
  useEffect(() => {
    if (step !== 6) return;
    if (itineraryPreview || itineraryPreviewLoading) return; // already loaded / loading
    const controller = new AbortController();
    itineraryAbortRef.current = controller;
    setItineraryPreviewLoading(true);
    setItineraryPreviewError(null);

    (async () => {
      try {
        const feedbackArray = Object.values(activityFeedback);
        // PHI-37 slice 2: include legs[] when multi-leg so the day-by-day
        // plan covers every leg with transition days flagged.
        const legsForApi = buildLegsForApi();
        const res = await fetch("/api/itinerary/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            destination,
            // PHI-99: dates vs. flex columns per wizard mode.
            ...(flexMode
              ? { flexMonth, flexNights }
              : { departureDate, returnDate }),
            hotel: hotel || null,
            ...buildRichHotelFields(),
            travelCompany: travelCompany || null,
            travelerTypes,
            activityFeedback: feedbackArray,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            // PHI-51: optional creative-inspiration soft bias.
            inspiration: inspiration.trim() || null,
            // PHI-90: traveller-seeded must-dos. Split + trimmed at the
            // boundary so the server sees a clean string[] regardless of
            // how the textarea was filled in. Empty list = no anchors,
            // generator behaves as before.
            userSeededActivities: splitSeededActivities(userSeededText),
            // PHI-100: soft area anchor when no hotel is set.
            anchorNeighborhood: anchorNeighborhood || null,
            ...(legsForApi && { legs: legsForApi }),
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          setItineraryPreviewError(err || "Couldn't load your trip preview.");
          setItineraryPreviewLoading(false);
          return;
        }
        const data = (await res.json()) as {
          days?: PreviewDay[];
          placement_notes?: string | null;
          time_sensitive_alerts?: string[] | null;
        };
        if (Array.isArray(data.days) && data.days.length > 0) {
          setItineraryPreview(data.days);
          // PHI-90: hold onto placement_notes so the preview banner can
          // explain to the user when an anchor was filtered out (wrong
          // city) or couldn't be fitted.
          if (typeof data.placement_notes === "string" && data.placement_notes.trim().length > 0) {
            setItineraryPlacementNotes(data.placement_notes.trim());
          } else {
            setItineraryPlacementNotes(null);
          }
          // PHI-114: clean + cap alerts at 4 client-side as a belt-and-
          // braces guard against an oversized server response. The route
          // already enforces this, but the preview renders the array
          // directly so double-checking here keeps the UI consistent.
          const cleanedAlerts = Array.isArray(data.time_sensitive_alerts)
            ? data.time_sensitive_alerts
                .filter((a): a is string => typeof a === "string")
                .map((a) => a.trim())
                .filter((a) => a.length > 0)
                .slice(0, 4)
            : [];
          setItineraryTimeSensitiveAlerts(cleanedAlerts.length > 0 ? cleanedAlerts : null);
          // Cache for /itinerary so we don't regenerate after signup
          if (typeof window !== "undefined") {
            localStorage.setItem("rise_itinerary", JSON.stringify(data.days));
            if (typeof data.placement_notes === "string" && data.placement_notes.trim().length > 0) {
              localStorage.setItem(
                "rise_itinerary_placement_notes",
                data.placement_notes.trim(),
              );
            } else {
              localStorage.removeItem("rise_itinerary_placement_notes");
            }
            // PHI-114: persist alerts so /itinerary picks them up on the
            // post-signup hydration path. JSON-encoded array; empty/null
            // clears the key so a clean generate wipes stale alerts.
            if (cleanedAlerts.length > 0) {
              localStorage.setItem(
                "rise_itinerary_time_sensitive_alerts",
                JSON.stringify(cleanedAlerts),
              );
            } else {
              localStorage.removeItem("rise_itinerary_time_sensitive_alerts");
            }
          }
          // Telemetry — fire once per session
          if (!itineraryViewedFiredRef.current) {
            itineraryViewedFiredRef.current = true;
            logOnboardingEvent("itinerary_viewed", {
              dayCount: data.days.length,
              activityCount: data.days.reduce(
                (n: number, d) => n + (d.items?.length ?? 0),
                0
              ),
            });
          }
        } else {
          setItineraryPreviewError("Couldn't load your trip preview.");
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") {
          setItineraryPreviewError(e.message);
        }
      } finally {
        setItineraryPreviewLoading(false);
      }
    })();

    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // PHI-64: auto-finish on the account step when the user is already
  // signed in AND we already know their name (from auth metadata or a
  // prior traveler row). Fires once per session — the ref guard prevents
  // loops if the PATCH/redirect hasn't completed before a re-render. If
  // the session expires mid-flow the guard is reset by onAuthStateChange.
  // PHI-90 renumber: account step was 5, now 6.
  useEffect(() => {
    if (step !== 6) return;
    if (!authedUser?.existingName) return;
    if (autoFinishedRef.current) return;
    if (saving) return;
    autoFinishedRef.current = true;
    void handleFinish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, authedUser]);

  // Generate dynamic chips for each card in the background as soon as they're parsed.
  // On thumbs-down, fallback chips are shown immediately; dynamic chips replace them
  // silently when they arrive, unless the user has already submitted for that card.
  useEffect(() => {
    if (parsedActivities.length === 0) return;
    parsedActivities.forEach((activity) => {
      if (chipsFetchedRef.current.has(activity.id)) return;
      chipsFetchedRef.current.add(activity.id);
      fetch("/api/activity-chips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityName: activity.name,
          activityCategory: activity.category,
          travelCompany: travelCompany || null,
          styleTags: travelerTypes.length > 0 ? travelerTypes : null,
          budgetTier: budgetTier || null,
        }),
      })
        .then((r) => r.json())
        .then((data: { chips?: Chip[] }) => {
          if (!data.chips) return;
          setActivityChips((prev) => {
            // Don't swap if the user has already submitted feedback for this card
            if (submittedActivitiesRef.current.has(activity.id)) return prev;
            return { ...prev, [activity.id]: { chips: data.chips!, source: "dynamic" } };
          });
        })
        .catch(() => {});
    });
  }, [parsedActivities, travelCompany, travelerTypes, budgetTier]);

  // PHI-31 Part 2: write the partial trip state to the anonymous session
  // on every step advance. Fire-and-forget — client-side state remains the
  // primary source of truth during onboarding. Failures are silent (the
  // happy path doesn't depend on it; the row will catch up on next advance).
  // PHI-37 slice 1: build the TripLeg[] that we send to the API at save
  // time. Returns null when the trip is single-leg (parsedLegs.length <= 1)
  // — callers fall back to the existing flat-fields path. When multi-leg,
  // the leg list reflects parsedLegs (places + per-leg nights) anchored
  // on the current departureDate when one is set, so subsequent date
  // edits on the wizard flow through naturally. PHI-39 adds per-leg
  // hotels from legHotels — empty strings become null so the prompt knows
  // not to anchor on a hotel for that leg.
  // PHI-111: emit the four rich hotel fields onto the POST/PATCH body when
  // (a) the user picked a real Places suggestion and (b) the visible hotel
  // string is non-empty (skipping the step or clearing the typed text
  // invalidates a captured payload). Single-leg path only — multi-leg
  // routes the rich fields inside legs[i] via buildLegsForApi above.
  function buildRichHotelFields(): Record<string, unknown> {
    if (!hotelRich || !hotel.trim()) return {};
    return {
      hotelPlaceId: hotelRich.placeId,
      hotelLat: hotelRich.lat,
      hotelLng: hotelRich.lng,
      hotelNeighborhood: hotelRich.neighborhood,
    };
  }

  function buildLegsForApi(): TripLeg[] | null {
    if (parsedLegs.length < 2) return null;
    // PHI-99: when the wizard is in flex mode the leg list has no concrete
    // dates — leg.nights still carries the per-leg duration the parser
    // produced (or equalSplitNights against flex_nights when the user
    // edited it). The downstream prompt builders fall back to leg.nights
    // when startDate/endDate are absent.
    const start = !flexMode && departureDate ? departureDate : undefined;
    let cursor = start;
    return parsedLegs.map((leg, i) => {
      const startDate = cursor;
      const endDate = cursor ? addDays(cursor, leg.nights) : undefined;
      cursor = endDate;
      const legHotel = legHotels[i]?.trim() || null;
      // PHI-111: only attach rich coords when (a) the user picked a real
      // suggestion (legHotelsRich[i] is set) AND (b) the visible hotel
      // string still matches that selection. The onChange handler clears
      // the rich entry on free-text edits, so this guard is belt-and-
      // braces against an edge race where the typed string drifts.
      const rich = legHotelsRich[i];
      const richValid = !!rich && !!legHotel;
      return {
        id: newLegId(),
        place: leg.place,
        hotel: legHotel,
        ...(richValid && rich.placeId ? { hotelPlaceId: rich.placeId } : {}),
        ...(richValid && typeof rich.lat === "number" ? { hotelLat: rich.lat } : {}),
        ...(richValid && typeof rich.lng === "number" ? { hotelLng: rich.lng } : {}),
        ...(richValid && rich.neighborhood !== undefined
          ? { hotelNeighborhood: rich.neighborhood }
          : {}),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
        // Always include the leg.nights so the prompt builder can render
        // per-leg night counts in flex mode. Cheap and harmless in
        // exact-date mode (startDate/endDate already win).
        ...(typeof leg.nights === "number" && leg.nights > 0
          ? { nights: leg.nights }
          : {}),
      };
    });
  }

  function patchAnonymousSession() {
    if (typeof window === "undefined") return;
    // PHI-37 slice 1: when the parser produced a multi-leg trip, send the
    // full legs[] array so all destinations are persisted (not just legs[0]).
    const legs = buildLegsForApi();
    const body = {
      destination,
      destinationVerified,
      // Follow-up #4: persist resolved place fields when available so the
      // anon session row can be claimed into a leg with lat/lng/id intact.
      ...(destinationPlace?.id && { destinationPlaceId: destinationPlace.id }),
      ...(destinationPlace?.lat != null && { destinationLat: destinationPlace.lat }),
      ...(destinationPlace?.lng != null && { destinationLng: destinationPlace.lng }),
      ...(destinationPlace?.type && { destinationPlaceType: destinationPlace.type }),
      ...(legs && { legs }),
      // PHI-99: dates only on the exact path; the anonymous-session row
      // mirrors the same shape so a /api/travelers/claim later doesn't
      // clobber the flex mode.
      ...(flexMode
        ? { flexMonth, flexNights }
        : { departureDate, returnDate }),
      hotel: hotel || null,
      ...buildRichHotelFields(),
      travelCompany: travelCompany || null,
      styleTags: travelerTypes,
      budgetTier: budgetTier || null,
      travelerCount: adultCount + childrenAges.length,
      childrenAges: childrenAges.length > 0 ? childrenAges : null,
      constraintTags: constraintTags.length > 0 ? constraintTags : null,
      constraintText: constraintText.trim() || null,
      activityFeedback: Object.values(activityFeedback),
    };
    fetch("/api/anonymous-session", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true, // tolerate page-unload mid-flight
    }).catch(() => {});
  }

  // PHI-31 Part 2: lightweight telemetry — fire-and-forget to the existing
  // activity-feedback endpoint which already accepts arbitrary event payloads.
  function logOnboardingEvent(event: string, extra?: Record<string, unknown>) {
    fetch("/api/activity-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event,
        ...(extra ?? {}),
      }),
      keepalive: true,
    }).catch(() => {});
  }

  function goTo(next: number) {
    // Persist before navigating so the session row reflects what the user
    // saw. Skip on the very first advance from step 0 (we may not even
    // have a destination yet — and the API rejects empty trips).
    if (step > 0) patchAnonymousSession();
    setStep(next);
    setAnimKey((k) => k + 1);
    // PHI-88: fire welcome_step_advanced once per (tab session, target step).
    // Per-tab idempotency only — a fresh tab is a new walk and re-fires.
    if (typeof window !== "undefined") {
      const key = `rise_va_step_${next}_fired`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, "1");
        track("welcome_step_advanced", { step: next });
      }
    }
  }

  function handleDestinationSelect(place: string) {
    setDestination(place);
    // PHI-30: confirmed selection from the autocomplete dropdown — the
    // user explicitly saw and accepted this place.
    setDestinationVerified(true);
    if (typeof window === "undefined" || !window.google?.maps) return;
    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: place }, (results, status) => {
      if (status === "OK" && results?.[0]) {
        const loc = results[0].geometry.location;
        setDestinationBias({ lat: loc.lat(), lng: loc.lng() });
        // Follow-up #4: capture the autocomplete-confirmed place into the
        // PlaceRef so the saved leg has lat/lng (and place_id when the
        // geocoder returns one).
        const r = results[0] as google.maps.GeocoderResult & { place_id?: string };
        setDestinationPlace({
          name: place,
          ...(r.place_id && { id: r.place_id }),
          lat: loc.lat(),
          lng: loc.lng(),
        });
      }
    });
  }

  // PHI-30: typing into the destination input always invalidates the
  // verified state — the user is editing, so any prior selection is stale.
  function handleDestinationChange(text: string) {
    setDestination(text);
    setDestinationVerified(false);
    // Follow-up #4: clear the resolved PlaceRef when the user types, so
    // a stale lat/lng/id doesn't accompany the new name.
    setDestinationPlace(null);
  }

  // PHI-30: user explicitly chose to proceed with their typed text without
  // selecting from the dropdown (e.g. a region or unusual spelling). We
  // mark verified=true so they can continue, and the downstream payload
  // could carry an "unverified" flag if we wanted to tell the model to
  // be cautious. For Sprint 2 minimum, we just unblock Continue.
  function useDestinationAsTyped() {
    if (!destination.trim()) return;
    setDestinationVerified(true);
  }

  function toggleStyle(style: string) {
    setTravelerTypes((prev) => {
      if (prev.includes(style)) return prev.filter((s) => s !== style);
      if (prev.length >= MAX_STYLE_SELECTIONS) return prev;
      return [...prev, style];
    });
  }

  // PHI-35: constraint chips toggle on/off. No upper bound — users may
  // have several real constraints that all need respecting.
  function toggleConstraint(tag: string) {
    setConstraintTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function addChild() {
    // PHI-27: empty default so users must consciously pick an age range.
    // Pre-selecting "Under 2" was a trap — inattentive parents got
    // toddler-itineraries by default.
    setChildrenAges((prev) => [...prev, ""]);
  }

  function updateChildAge(idx: number, age: string) {
    setChildrenAges((prev) => prev.map((a, i) => (i === idx ? age : a)));
  }

  function removeChild(idx: number) {
    setChildrenAges((prev) => prev.filter((_, i) => i !== idx));
  }

  // Activity feedback handlers
  function handleThumbsUp(activity: ParsedActivity) {
    const current = activityFeedback[activity.id];
    if (current?.feedbackType === "thumbs_up") {
      // Deselect — return to neutral
      setActivityFeedback((prev) => {
        const next = { ...prev };
        delete next[activity.id];
        return next;
      });
      return;
    }
    setActivityFeedback((prev) => ({
      ...prev,
      [activity.id]: {
        activityId: activity.id,
        activityName: activity.name,
        activityCategory: activity.category,
        feedbackType: "thumbs_up",
      },
    }));
    logActivityEvent({
      event: "thumbs_up",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  function handleThumbsDown(activity: ParsedActivity) {
    const current = activityFeedback[activity.id];
    // Clear any existing feedback (e.g. thumbs-up) before opening chips
    if (current) {
      setActivityFeedback((prev) => {
        const next = { ...prev };
        delete next[activity.id];
        return next;
      });
    }
    // Set fallback chips immediately so they're present the instant the layer opens.
    // If dynamic chips are already loaded, they take precedence.
    setActivityChips((prev) => {
      if (prev[activity.id]) return prev;
      return { ...prev, [activity.id]: { chips: FALLBACK_CHIPS, source: "fallback" } };
    });
    setOpenChipId(activity.id);
    logActivityEvent({
      event: "chips_shown",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  function handleChipSelect(activity: ParsedActivity, chip: Chip) {
    const chipsEntry = activityChips[activity.id];
    submittedActivitiesRef.current.add(activity.id);
    setActivityFeedback((prev) => ({
      ...prev,
      [activity.id]: {
        activityId: activity.id,
        activityName: activity.name,
        activityCategory: activity.category,
        feedbackType: "chip_selected",
        chip,
      },
    }));
    setOpenChipId(null);
    logActivityEvent({
      event: "chip_selected",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
      chipLabel: chip.label,
      chipType: chip.type,
      chipsSource: chipsEntry?.source ?? "fallback",
      firstChipLabel: chipsEntry?.chips[0]?.label ?? "",
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  // PHI-28: skipping is a *distinct* signal from "no rating yet" — the user
  // saw the card and consciously chose not to commit. Track separately so
  // the model can use it (or not) downstream without confusing it with the
  // unrated cards.
  function handleSkip(activity: ParsedActivity) {
    setActivityFeedback((prev) => ({
      ...prev,
      [activity.id]: {
        activityId: activity.id,
        activityName: activity.name,
        activityCategory: activity.category,
        feedbackType: "skipped",
      },
    }));
    logActivityEvent({
      event: "skipped",
      activityId: activity.id,
      activityName: activity.name,
      activityCategory: activity.category,
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  function handleRemoveExclusion(activityId: string) {
    const entry = activityFeedback[activityId];
    if (!entry) return;
    setActivityFeedback((prev) => {
      const next = { ...prev };
      delete next[activityId];
      return next;
    });
    logActivityEvent({
      event: "exclusion_removed",
      activityId,
      activityName: entry.activityName,
      activityCategory: entry.activityCategory,
      inspiration: inspiration.trim() || null,
      inspirationStrength: inspiration.trim() ? (childrenAges.length > 0 ? "family" : "adult") : null,
    });
  }

  const hardExcludedActivities = Object.values(activityFeedback).filter(
    (f) => f.feedbackType === "chip_selected" && f.chip?.type === "hard_exclusion"
  );

  // PHI-57: derived — destination resolved to a country (vs city/region).
  // Prefer the parser's resolvedPlaces lookup (free-form path); fall back
  // to the structured-form destinationPlace state when the user came in
  // via the autocomplete on /welcome step 0.
  const resolvedDestinationKind =
    resolvedPlaces[destination]?.type ?? destinationPlace?.type;
  const isCountryDestination = resolvedDestinationKind === "country";
  // Persist country alongside resolved city. Best-effort, fire-and-forget.
  function patchCountry(country: string) {
    if (!travelerId) return;
    void fetch("/api/travelers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: travelerId, country }),
    }).catch(() => {});
  }
  // PHI-57: load 4 AI city recommendations for the current country.
  async function fetchCountryRecommendations() {
    setCountryRecsLoading(true);
    setCountryRecsError(null);
    try {
      const res = await fetch("/api/destinations/cities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          country: destination,
          preferences: {
            travelCompany,
            styleTags: travelerTypes,
            budgetTier,
            travelerCount: adultCount + childrenAges.length,
            childrenAges,
          },
        }),
      });
      if (!res.ok) {
        setCountryRecsError("Couldn't load suggestions — try a city directly.");
        setCountryRecommendations([]);
        return;
      }
      const data = (await res.json()) as {
        recommendations?: { name: string; kind: "city" | "region"; why: string; lat?: number; lng?: number }[];
      };
      setCountryRecommendations(data.recommendations ?? []);
    } catch {
      setCountryRecsError("Couldn't load suggestions — try a city directly.");
      setCountryRecommendations([]);
    } finally {
      setCountryRecsLoading(false);
    }
  }
  // PHI-57: pick a recommended city → resolve it, set destination, advance.
  function pickRecommendedCity(name: string) {
    patchCountry(destination);
    setDestination(name);
    setDestinationVerified(true);
    void resolveParsedDestinations([{ name }]);
    setCountryRecommendations([]);
    goTo(4);
  }

  // PHI-100: open the soft neighbourhood picker. No Anthropic call on
  // mount of step 2 — only here, on explicit user click. Idempotent: if
  // we already have cards for the current destination we skip the fetch.
  async function openNeighborhoodPicker() {
    const dest = destination.trim();
    if (!dest) return;
    setNeighborhoodPickerOpen(true);
    setNeighborhoodsError(null);
    if (neighborhoodCards.length > 0) return;
    setNeighborhoodsLoading(true);
    try {
      // PHI-107: thread childrenAges so the route shards the cache and
      // engages the system prompt's family-mode rules. Empty/null array
      // hits the non-family cache row, byte-identical to pre-PHI-107.
      const res = await fetch("/api/neighborhoods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination: dest, childrenAges }),
      });
      if (!res.ok) {
        setNeighborhoodsError("Couldn't load neighbourhoods. Try again?");
        return;
      }
      const data = (await res.json()) as { neighborhoods?: NeighborhoodCard[] };
      if (Array.isArray(data.neighborhoods) && data.neighborhoods.length > 0) {
        setNeighborhoodCards(data.neighborhoods);
      } else {
        setNeighborhoodsError("No neighbourhoods returned. Try again?");
      }
    } catch {
      setNeighborhoodsError("Couldn't load neighbourhoods. Try again?");
    } finally {
      setNeighborhoodsLoading(false);
    }
  }

  // PHI-100: pick a neighbourhood card. Hotel and anchor are mutually
  // exclusive — choosing a neighbourhood clears any half-typed hotel,
  // mirroring the skip link's behaviour.
  function pickNeighborhood(name: string) {
    setAnchorNeighborhood(name);
    setHotel("");
    // PHI-111: picking a neighbourhood is mutually exclusive with a booked
    // hotel — drop any rich payload we captured before the user pivoted.
    setHotelRich(null);
    setNeighborhoodPickerOpen(false);
    void handleContinue();
  }

  // PHI-102 — fetch popular picks. Lazy; only fires on explicit "See popular
  // picks" click. Idempotent for the same (destination, profile) — if we
  // already have picks loaded for the current destination we don't refetch.
  async function openPopularPicks() {
    const dest = destination.trim();
    if (!dest) return;
    setPopularPicksOpen(true);
    setPopularPicksError(null);
    if (popularPicks.length > 0) return;
    if (popularPicksDisabledForDest === dest) return;
    setPopularPicksLoading(true);
    try {
      const res = await fetch("/api/destination/popular-picks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination: dest,
          travelCompany: travelCompany || null,
          childrenAges: childrenAges.length > 0 ? childrenAges : null,
          styleTags: travelerTypes,
        }),
      });
      if (!res.ok) {
        setPopularPicksError("Couldn't load popular picks. Try again?");
        return;
      }
      const data = (await res.json()) as { picks?: PopularPickRow[] };
      const picks = Array.isArray(data.picks) ? data.picks : [];
      if (picks.length === 0) {
        // Sub-minimum fallback — disable the affordance for this dest.
        setPopularPicksDisabledForDest(dest);
        setPopularPicks([]);
      } else {
        setPopularPicks(picks);
        // Telemetry — fire one pick_shown event per surfaced row, in the
        // shape extended by the route's metadata-harvest path (PHI-45).
        for (const pick of picks) {
          void fetch("/api/activity-feedback", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "pick_shown",
              activityName: pick.name,
              activityCategory: pick.category,
              city: dest,
              travelCompany: travelCompany || null,
              picks_source: "popular-picks",
            }),
          }).catch(() => {});
        }
      }
    } catch {
      setPopularPicksError("Couldn't load popular picks. Try again?");
    } finally {
      setPopularPicksLoading(false);
    }
  }

  // PHI-102 — derive added/not-added state from the textarea on every
  // render. Textarea is the single source of truth (hard constraint).
  // Match case-insensitive on the trimmed pick name appearing on its own
  // line in the textarea.
  function isPickAdded(pickName: string): boolean {
    const target = pickName.trim().toLowerCase();
    if (!target) return false;
    const lines = userSeededText.split(/\r?\n/);
    return lines.some((line) => line.trim().toLowerCase() === target);
  }

  function addPick(pick: { name: string; category: string }) {
    if (isPickAdded(pick.name)) return;
    const current = userSeededText;
    const sep = current.length === 0 || current.endsWith("\n") ? "" : "\n";
    setUserSeededText(current + sep + pick.name);
    const nextCount = popularPicksAddedCount + 1;
    setPopularPicksAddedCount(nextCount);
    void fetch("/api/activity-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "pick_added",
        activityName: pick.name,
        activityCategory: pick.category,
        city: destination.trim(),
        travelCompany: travelCompany || null,
        picks_source: "popular-picks",
      }),
    }).catch(() => {});
  }

  function removePick(pick: { name: string; category: string }) {
    const target = pick.name.trim().toLowerCase();
    if (!target) return;
    const next = userSeededText
      .split(/\r?\n/)
      .filter((line) => line.trim().toLowerCase() !== target)
      .join("\n");
    setUserSeededText(next);
    void fetch("/api/activity-feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "pick_removed",
        activityName: pick.name,
        activityCategory: pick.category,
        city: destination.trim(),
        travelCompany: travelCompany || null,
        picks_source: "popular-picks",
      }),
    }).catch(() => {});
  }

  // PHI-90: PATCH the must-dos onto the traveler row when leaving step 4.
  // Best-effort partial write — if the row isn't created yet (rare —
  // savePreferencesToDb at step 3 creates it), we silently skip and the
  // localStorage payload still carries the seeded list. handleFinish PATCHes
  // again at sign-up so nothing is lost.
  async function saveSeededActivitiesToDb() {
    if (!travelerId) return;
    try {
      await fetch("/api/travelers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: travelerId,
          userSeededActivities: splitSeededActivities(userSeededText),
        }),
      });
    } catch {
      // Non-fatal — list is in component state and localStorage.
    }
  }

  // Write preferences to DB when advancing from step 3 to step 4
  async function savePreferencesToDb() {
    try {
      if (travelerId) {
        await fetch("/api/travelers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: travelerId,
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            // PHI-100: persist the soft neighbourhood anchor if picked on
            // step 2. Empty string is a valid "no anchor" signal — the
            // server treats it as null.
            anchorNeighborhood: anchorNeighborhood || null,
            // PHI-99: keep the row coherent with the wizard mode. When the
            // user later changes mind on step 1 (or jumps back) the patch
            // explicitly clears the unused pair so the row never carries
            // both an exact-date leg and flex columns.
            ...(flexMode
              ? { flexMonth, flexNights }
              : { flexMonth: null, flexNights: null }),
          }),
        });
      } else {
        // PHI-37 slice 1: send full legs[] when multi-leg.
        const legs = buildLegsForApi();
        const res = await fetch("/api/travelers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination,
            // Follow-up #4: include resolved place data when available so
            // the leg's place_id / lat / lng land in the JSONB on first write.
            ...(destinationPlace?.id && { destinationPlaceId: destinationPlace.id }),
            ...(destinationPlace?.lat != null && { destinationLat: destinationPlace.lat }),
            ...(destinationPlace?.lng != null && { destinationLng: destinationPlace.lng }),
            ...(destinationPlace?.type && { destinationPlaceType: destinationPlace.type }),
            ...(legs && { legs }),
            // PHI-99: omit date fields entirely in flex mode so the leg's
            // startDate/endDate stay undefined. The flex columns carry the
            // duration signal instead.
            ...(flexMode
              ? { flexMonth, flexNights }
              : { departureDate, returnDate }),
            hotel: hotel || null,
            ...buildRichHotelFields(),
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            activities: [],
            // PHI-100: include on first write so the row carries the anchor.
            ...(anchorNeighborhood && { anchorNeighborhood }),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setTravelerId(data.id ?? null);
        }
      }
    } catch {
      // Non-fatal: preferences are in state; partial write is best-effort
    }
  }

  async function handleFinish() {
    setSaving(true);
    // PHI-31 Part 2: fire signup-after-itinerary telemetry. Today this
    // event is emitted *before* the user has actually viewed the itinerary
    // (because the itinerary-pre-signup view is a follow-up). Once that
    // ships, the event meaning aligns with the design — for now, it
    // captures every welcome → signup transition.
    logOnboardingEvent("signup_initiated_after_itinerary", {
      hasActivityFeedback: Object.keys(activityFeedback).length,
    });
    // PHI-64: when the visitor is already signed in, the canonical email
    // is the session email — never overwrite it with whatever sits in
    // the (hidden) email state. Name comes from the form when collected,
    // else from auth metadata / a prior traveler row.
    const finalEmail = authedUser?.email || email;
    const finalName = name.trim().length > 0 ? name : (authedUser?.existingName ?? "");
    // PHI-59: Step 5 no longer creates the account directly. We persist
    // name + email on the existing traveler row, save the local snapshot,
    // then send a magic link. The /auth/callback handler links the row
    // to auth.users.id once the user clicks the email.
    // PHI-74: when the user is already signed in we skip the magic link
    // entirely and hand off to /auth/claim so the PHI-60 conflict UI
    // can reconcile the new trip against any existing primary trip.
    let resolvedTravelerId = travelerId;
    // PHI-90: seeded list at finish-time — covers both happy path (already
    // patched onto the row from step 4) and the fallback POST below where
    // the row didn't exist yet.
    const seededAtFinish = splitSeededActivities(userSeededText);
    try {
      if (travelerId) {
        await fetch("/api/travelers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: travelerId,
            name: finalName,
            email: finalEmail,
            // Re-PATCH the must-dos so they reach the row even if the
            // step-4 partial write failed.
            userSeededActivities: seededAtFinish,
            // PHI-100: re-PATCH the neighbourhood anchor for the same
            // reason — guards against a step-3 partial-write that
            // silently dropped the column.
            anchorNeighborhood: anchorNeighborhood || null,
            // PHI-99: re-assert the date-or-flex mode on finish too. If
            // the step-3 partial PATCH already set this, the second write
            // is idempotent.
            ...(flexMode
              ? { flexMonth, flexNights }
              : { flexMonth: null, flexNights: null }),
          }),
        });
      } else {
        // Fallback: partial-write at step 3 didn't land. Create the row
        // now with full payload so we have something to link to.
        const legs = buildLegsForApi();
        const res = await fetch("/api/travelers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: finalName,
            email: finalEmail,
            destination,
            ...(destinationPlace?.id && { destinationPlaceId: destinationPlace.id }),
            ...(destinationPlace?.lat != null && { destinationLat: destinationPlace.lat }),
            ...(destinationPlace?.lng != null && { destinationLng: destinationPlace.lng }),
            ...(destinationPlace?.type && { destinationPlaceType: destinationPlace.type }),
            ...(legs && { legs }),
            // PHI-99: omit date fields in flex mode (same shape as
            // savePreferencesToDb's POST).
            ...(flexMode
              ? { flexMonth, flexNights }
              : { departureDate, returnDate }),
            hotel: hotel || null,
            ...buildRichHotelFields(),
            travelCompany: travelCompany || null,
            styleTags: travelerTypes.length > 0 ? travelerTypes : null,
            budgetTier: budgetTier || null,
            travelerCount: adultCount + childrenAges.length,
            childrenAges: childrenAges.length > 0 ? childrenAges : null,
            activities: [],
            // PHI-90: include the must-dos in the fallback POST too, so the
            // row carries the field on first write.
            ...(seededAtFinish.length > 0 && {
              userSeededActivities: seededAtFinish,
            }),
            // PHI-100: same shape as the must-dos — only include the
            // anchor when set so legacy callers stay clean.
            ...(anchorNeighborhood && { anchorNeighborhood }),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          resolvedTravelerId = data.id ?? null;
          setTravelerId(resolvedTravelerId);
        }
      }
    } catch {}
    // PHI-37 slice 3: persist legs[] in the local snapshot so /itinerary
    // can render leg headers + transition-day chrome without a refetch.
    const legsForStorage = buildLegsForApi();
    // PHI-90: cache the user-seeded must-dos on the local snapshot so the
    // /itinerary page can pass them through to /api/itinerary/generate on
    // a fresh-cache regenerate. Empty list = undefined → key is omitted
    // (`...(seeded.length && { ... })`) so legacy travelers stay clean.
    const seededForStorage = splitSeededActivities(userSeededText);
    const travelerData = {
      id: resolvedTravelerId,
      name: finalName,
      email: finalEmail,
      destination,
      // PHI-99: in flex mode the dates are empty strings — leave them
      // empty in the snapshot. The flex pair carries the duration signal
      // and downstream readers (dashboard, /itinerary) check flexMonth
      // first.
      departureDate: flexMode ? "" : departureDate,
      returnDate: flexMode ? "" : returnDate,
      hotel: hotel || null,
      ...buildRichHotelFields(),
      travelCompany,
      travelerCount: adultCount + childrenAges.length,
      childrenAges: childrenAges.length > 0 ? childrenAges : null,
      travelerTypes,
      budgetTier,
      constraintTags: constraintTags.length > 0 ? constraintTags : null,
      constraintText: constraintText.trim() || null,
      activities: [],
      ...(legsForStorage && { legs: legsForStorage }),
      ...(seededForStorage.length > 0 && { userSeededActivities: seededForStorage }),
      // PHI-100: persist the soft neighbourhood anchor so /itinerary and
      // any later regenerate path can pass it back to the AI prompts when
      // no hotel is set. Omitted when empty so legacy snapshots stay clean.
      ...(anchorNeighborhood && { anchorNeighborhood }),
      // PHI-99: persist the flex pair so the dashboard date-lock nudge
      // can detect that the user is in flex mode on a return visit, and
      // so /itinerary can pass it back to /api/itinerary/generate on a
      // regenerate without needing to refetch from Supabase.
      ...(flexMode ? { flexMonth, flexNights } : {}),
    };
    localStorage.setItem("rise_traveler", JSON.stringify(travelerData));
    localStorage.setItem("rise_onboarded", "true");
    const feedbackArray = Object.values(activityFeedback);
    localStorage.setItem("rise_activity_feedback", JSON.stringify(feedbackArray));

    // PHI-74: signed-in path — hand off to /auth/claim so the PHI-60
    // conflict UI can resolve the new trip against any existing primary
    // trip on this account. We deliberately do NOT pre-link auth_user_id
    // here: the claim API owns linking as part of the chosen action
    // (keep_local / use_saved / save_both), and pre-linking would leave
    // an orphaned linked row if the user picks "Use saved trip".
    // localStorage.rise_traveler stays — /auth/claim reads it.
    if (authedUser) {
      setSaving(false);
      // PHI-88: signed-in completion. Fire-and-forget; sessionStorage guard
      // covers both the explicit submit and the auto-finish useEffect.
      if (typeof window !== "undefined" && !sessionStorage.getItem("rise_va_completed_fired")) {
        sessionStorage.setItem("rise_va_completed_fired", "1");
        track("welcome_completed", { signedIn: true });
      }
      router.push("/auth/claim?next=/dashboard");
      return;
    }

    // PHI-59: send magic link, then route to the check-email interstitial.
    // emailRedirectTo points at /auth/callback (allowlisted in middleware
    // so the email link works behind the SITE_PASSWORD gate). travelerId
    // is preserved through the link so the callback can write it onto
    // travelers.auth_user_id once the session is established.
    const supabaseAuth = getSupabaseBrowserClient();
    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/dashboard");
    if (resolvedTravelerId) {
      callbackUrl.searchParams.set("travelerId", resolvedTravelerId);
    }
    const { error: otpErr } = await supabaseAuth.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: callbackUrl.toString() },
    });
    setSaving(false);
    if (otpErr) {
      console.error("[welcome] magic link failed:", otpErr.message);
      // Don't strand the user — fall back to the legacy local-only path
      // so they still see their itinerary. Account-link can happen later
      // from the homepage Sign in CTA.
      router.push("/itinerary");
      return;
    }
    // PHI-88: magic_link_sent — useRef-guarded so a stray double-invocation
    // in dev / strict-mode doesn't double-fire for the same click.
    if (!magicLinkSentRef.current) {
      magicLinkSentRef.current = true;
      track("magic_link_sent", { source: "welcome" });
    }
    // PHI-88: welcome_completed for the magic-link path.
    if (typeof window !== "undefined" && !sessionStorage.getItem("rise_va_completed_fired")) {
      sessionStorage.setItem("rise_va_completed_fired", "1");
      track("welcome_completed", { signedIn: false });
    }
    const checkEmailParams = new URLSearchParams();
    checkEmailParams.set("email", email.trim());
    if (resolvedTravelerId) checkEmailParams.set("travelerId", resolvedTravelerId);
    router.push(`/auth/check-email?${checkEmailParams.toString()}`);
  }

  // ── Step 0: Full-screen landing ────────────────────────────────────────────

  // ── PHI-34 UI: dual-CTA landing ────────────────────────────────────────
  // Default first impression. Free-form textarea → /api/parse-trip → chips
  // confirmation → pre-fill state and advance. Structured form remains
  // available via the "Or step by step →" link.
  // PHI-58: accepts an optional text override so the homepage handoff can
  // submit before parserText state has been committed in React.
  async function submitFreeForm(textOverride?: string) {
    const text = textOverride ?? parserText;
    if (!text.trim()) return;
    setParserPhase("parsing");
    setParserError(null);
    // PHI-37 slice 4: clear stale per-leg night overrides when the user
    // re-parses; the allocator initialises again on the new chip screen.
    setLegNightOverrides([]);
    // PHI-46: drop any open inline editor before showing fresh chips.
    setEditingChipKey(null);
    setDestEditDraft("");
    logOnboardingEvent("freeform_initiated", { length: text.length });
    try {
      const res = await fetch("/api/parse-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const err = await res.text();
        setParserError(err || "Couldn't read that — try the structured form below.");
        setParserPhase("landing");
        return;
      }
      const data = (await res.json()) as {
        intent: TripIntent;
        suggestedLegs?: { city: string; country: string; nights: number; source: "atlas" }[];
      };
      // PHI-54: if the atlas matched the inspiration AND the parser
      // didn't already extract destinations the user mentioned, fold the
      // suggested legs into intent.destinations so they render on the
      // chip-confirm screen with a "suggested" tag. User can remove
      // freely. Never overwrite user-typed destinations.
      let intent = data.intent;
      if (
        data.suggestedLegs &&
        data.suggestedLegs.length > 0 &&
        intent.destinations.length === 0
      ) {
        intent = {
          ...intent,
          destinations: data.suggestedLegs.map((l) => ({
            name: l.city,
            kind: "place" as const,
          })),
        };
        setAtlasSuggestedCities(
          new Set(data.suggestedLegs.map((l) => l.city.toLowerCase())),
        );
      } else {
        setAtlasSuggestedCities(new Set());
      }
      setParsedIntent(intent);
      setParserPhase("confirming");
      logOnboardingEvent(
        intent.clarifications.length > 0
          ? "freeform_required_clarification"
          : "freeform_parsed_clean",
        {
          clarifications: intent.clarifications.length,
          atlasMatched: !!data.suggestedLegs,
        }
      );
      // Follow-up #4: kick off place resolution in the background while the
      // user reviews the chips. Parallel + fire-and-forget; failures fall
      // through to the unverified-name path on accept.
      void resolveParsedDestinations(intent.destinations);
    } catch (e: unknown) {
      setParserError(e instanceof Error ? e.message : "Network error.");
      setParserPhase("landing");
    }
  }

  // Follow-up #4: resolve a list of parser-produced destinations to PlaceRefs.
  // Runs in parallel; merges results into resolvedPlaces as each one returns.
  // Skips entries already resolved (covers chip-edits where most destinations
  // are unchanged).
  async function resolveParsedDestinations(
    destinations: { name: string; kind?: string }[]
  ) {
    const work = destinations
      .filter((d) => d.name && !resolvedPlaces[d.name])
      .map(async (d) => {
        try {
          const r = await fetch("/api/resolve-place", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: d.name, hint: d.kind ?? null }),
          });
          if (!r.ok) return null;
          const body = (await r.json()) as { resolved: PlaceRef | null };
          return body.resolved ? ([d.name, body.resolved] as const) : null;
        } catch {
          return null;
        }
      });
    const settled = await Promise.all(work);
    const next: Record<string, PlaceRef> = {};
    for (const entry of settled) {
      if (entry) next[entry[0]] = entry[1];
    }
    if (Object.keys(next).length) {
      setResolvedPlaces((prev) => ({ ...prev, ...next }));
    }
  }

  function applyParsedIntentAndAdvance() {
    if (!parsedIntent) return;
    // Pre-fill structured state from the parsed intent. The user already
    // approved the chips, so we trust the parse output going forward.
    const first = parsedIntent.destinations[0];
    if (first?.name) {
      setDestination(first.name);
      setDestinationVerified(true);
      // Follow-up #4: pull the resolved PlaceRef (if the background
      // resolution finished). Fall back to a name-only PlaceRef marked
      // unverified so downstream readers can tell the difference.
      const resolved = resolvedPlaces[first.name];
      setDestinationPlace(
        resolved ?? { name: first.name, unverified: true }
      );
      // Capture lat/lng for the autocomplete bias on the structured form,
      // matching what handleDestinationSelect would do.
      if (resolved?.lat != null && resolved?.lng != null) {
        setDestinationBias({ lat: resolved.lat, lng: resolved.lng });
      }
    }
    // PHI-37 slice 1+4: snapshot all parsed destinations into parsedLegs
    // so we can persist a full TripLeg[] when the user saves. We don't
    // persist legs (only legs[0] gets used) when there's a single
    // destination — that's the current single-leg path.
    const dests = parsedIntent.destinations.filter((d) => d.name);
    if (dests.length >= 2) {
      const totalNights =
        parsedIntent.dates.durationNights ??
        nightsBetween(parsedIntent.dates.departure, parsedIntent.dates.return) ??
        0;
      // Slice 4: prefer the user's allocator overrides when they edited
      // them on the chip-confirm screen; fall back to equal-split.
      const split =
        legNightOverrides.length === dests.length
          ? legNightOverrides
          : equalSplitNights(dests.length, totalNights);
      setParsedLegs(
        dests.map((d, i) => ({
          place:
            resolvedPlaces[d.name] ?? { name: d.name, unverified: true },
          nights: split[i] ?? 0,
        }))
      );
      // PHI-39: initialise per-leg hotel slots (one empty string per leg).
      // The user fills these in step 2.
      setLegHotels(new Array(dests.length).fill(""));
      // PHI-111: parallel rich-payload array, same length as legHotels.
      setLegHotelsRich(new Array(dests.length).fill(null));
    } else {
      // Single-leg: keep parsedLegs empty so persistence falls through
      // to the existing single-leg path.
      setParsedLegs([]);
      setLegHotels([]);
      setLegHotelsRich([]);
    }
    // PHI-109: capture the parser's nights inference so the date-default
    // effect uses it (instead of the hardcoded 7) when the user only set a
    // duration on the chip screen and picks a departure on step 1.
    if (
      typeof parsedIntent.dates.durationNights === "number" &&
      parsedIntent.dates.durationNights > 0
    ) {
      setParserInferredNights(parsedIntent.dates.durationNights);
    }
    if (parsedIntent.dates.departure) setDepartureDate(parsedIntent.dates.departure);
    if (parsedIntent.dates.return) {
      setReturnDate(parsedIntent.dates.return);
      // PHI-109 regression fix: when the parser hands off an explicit
      // return date (the user typed it on the confirmation page's inline
      // editor, or the parser captured both endpoints from the free
      // text), mark it as user-typed so the date-default effect doesn't
      // re-derive Return = Departure + N on the wizard step.
      setUserTypedReturn(true);
    }
    if (parsedIntent.party.adults) setAdultCount(parsedIntent.party.adults);
    if (parsedIntent.party.children?.length) {
      setChildrenAges(
        parsedIntent.party.children
          .map((c) => c.ageRange ?? "")
          .filter((a, i, arr) => arr[i] || true) // keep all, even empties
      );
    }
    if (parsedIntent.styleTags?.length)
      setTravelerTypes(parsedIntent.styleTags.slice(0, MAX_STYLE_SELECTIONS));
    if (parsedIntent.budgetTier) setBudgetTier(parsedIntent.budgetTier);
    if (parsedIntent.constraintTags?.length) setConstraintTags(parsedIntent.constraintTags);
    if (parsedIntent.constraintText) setConstraintText(parsedIntent.constraintText);
    // PHI-51: thread inspiration into the wizard state if the user kept the chip.
    if (parsedIntent.inspiration) setInspiration(parsedIntent.inspiration);

    logOnboardingEvent("freeform_completed", {
      destinationCount: parsedIntent.destinations.length,
      hadConstraints:
        parsedIntent.constraintTags.length + (parsedIntent.constraintText ? 1 : 0),
      hadInspiration: !!parsedIntent.inspiration,
      inspiration: parsedIntent.inspiration ?? null,
    });

    // Skip to step 1 (dates) — destination is now pre-filled. The user
    // walks the rest of the flow, but skipping step 0 means the parsed
    // text gave us the foundational input.
    setParserPhase("structured");
    goTo(1);
  }

  if (step === 0 && parserPhase !== "structured") {
    return (
      <LandingFreeForm
        parserPhase={parserPhase}
        setParserPhase={setParserPhase}
        parsedIntent={parsedIntent}
        setParsedIntent={setParsedIntent}
        animKey={animKey}
        editingChipKey={editingChipKey}
        setEditingChipKey={setEditingChipKey}
        destEditDraft={destEditDraft}
        setDestEditDraft={setDestEditDraft}
        resolveParsedDestinations={resolveParsedDestinations}
        atlasSuggestedCities={atlasSuggestedCities}
        legNightOverrides={legNightOverrides}
        setLegNightOverrides={setLegNightOverrides}
        applyParsedIntentAndAdvance={applyParsedIntentAndAdvance}
        parserText={parserText}
        setParserText={setParserText}
        parserError={parserError}
        submitFreeForm={submitFreeForm}
      />
    );
  }

  if (step === 0) {
    return (
      <LandingStructured
        animKey={animKey}
        destination={destination}
        handleDestinationChange={handleDestinationChange}
        handleDestinationSelect={handleDestinationSelect}
        destinationVerified={destinationVerified}
        useDestinationAsTyped={useDestinationAsTyped}
        goTo={goTo}
      />
    );
  }

  // ── Wizard steps 1–6 (PHI-90: must-dos inserted at step 4) ─────────────────

  // PHI-27: every child must have an age range picked before Continue is
  // enabled. Pre-selecting "Under 2" was a personalisation trap; making the
  // pick conscious is the right tradeoff.
  const allChildrenHaveAges = childrenAges.every((a) => a.length > 0);

  // PHI-47: regex check at the gate; "x" no longer passes. Server mirrors.
  const emailValid = EMAIL_RE.test(email.trim());

  // PHI-64: signed-in users only need a name (email comes from the
  // session). If their session already supplied a name we auto-finish,
  // so the gate only matters for the name-only branch.
  // PHI-90 renumber: variable was step5Ready; account step is now 6.
  const accountStepReady = authedUser
    ? name.trim().length > 0
    : name.trim().length > 0 && emailValid;

  const canContinue: Record<number, boolean> = {
    // PHI-30: step 1 also requires destinationVerified — the user might
    // have re-opened the autocomplete here and started editing.
    // PHI-99: flex mode swaps the date-field gate for a month + nights gate.
    1:
      destination.trim().length > 0 &&
      destinationVerified &&
      (flexMode
        ? flexMonth.length > 0 && flexNights >= 1
        : departureDate.length > 0 && returnDate.length > 0),
    2: true,
    3: travelCompany.length > 0 && allChildrenHaveAges,
    // PHI-90: must-dos step is fully skippable — empty textarea always
    // advances. Hard constraint: the step never blocks forward progress.
    4: true,
    5: !previewLoading && Object.keys(activityFeedback).length > 0,
    6: accountStepReady,
  };

  async function handleContinue() {
    // PHI-90 renumber: account step is now 6.
    if (step === 6) { await handleFinish(); return; }
    if (step === 3) { await savePreferencesToDb(); }
    if (step === 4) { await saveSeededActivitiesToDb(); }
    // PHI-99 — fire a telemetry event on step-1 advance with the mode the
    // user took. Build-readiness only; we don't act on this signal until
    // real traffic arrives. Fire-and-forget so a slow logger never blocks
    // the wizard.
    if (step === 1) {
      logOnboardingEvent("welcome_step1_advance", {
        mode: flexMode ? "flex" : "exact",
        ...(flexMode ? { flexMonth, flexNights } : {}),
      });
    }
    // PHI-57: when the destination is a country (not a city), insert
    // step 3.5 — AI city recommendations — between preferences and the
    // must-dos step. We use step 35 as a sentinel; from 35 we hand off
    // to step 4 (must-dos) when the user picks a recommendation.
    if (step === 3 && isCountryDestination) {
      goTo(35);
      void fetchCountryRecommendations();
      return;
    }
    goTo(step + 1);
  }

  // PHI-64: when the user is already signed in, swap account-step copy.
  // With a known name we auto-finish (no input needed); otherwise we ask
  // only for a display name. The anon path keeps its original copy.
  // PHI-90 renumber: account step was 5, now 6.
  const accountStepHeading = authedUser
    ? authedUser.existingName
      ? "Saving your trip…"
      : "One last thing — what should we call you?"
    : "Save your trip plan.";
  const accountStepSub = authedUser
    ? authedUser.existingName
      ? "We're tucking your itinerary into your account."
      : "We'll save your itinerary, transport advice, and trip summary to your account."
    : "Your activity plan, transport advice, and trip summary are ready. Create your account to save everything.";

  const headings: Record<number, string> = {
    1: "When are you going?",
    2: "Where are you staying?",
    3: "Tell us about yourself.",
    // PHI-130: show the clean city label in headings, not the verbose
    // geocoded string. The full `destination` is preserved for prompts.
    35: `Where in ${cityLabel(destination)}?`,
    // PHI-90: new must-dos step heading. Optional — user can skip.
    4: "Anything you already want to do?",
    5: `Activities for your ${cityLabel(destination)} trip.`,
    6: accountStepHeading,
  };

  const subs: Record<number, string> = {
    1: `Great choice. Now let's lock in the dates for ${cityLabel(destination)}.`,
    2: "Your hotel helps us give better local advice — skip if you haven\u2019t booked yet.",
    3: "A few quick questions so we can personalise your experience.",
    35: "Pick a city or region \u2014 we'll personalise the rest from there.",
    // PHI-90: explicit "skippable" signal in the sub \u2014 Marcus persona test
    // case from the PRD ("skip the step in one tap").
    4: "Add the things you already know you want \u2014 one per line. Skip if you\u2019d rather we plan from scratch.",
    5: "Rate what excites you \u2014 and what doesn\u2019t. It shapes your itinerary.",
    6: accountStepSub,
  };

  const darkInput =
    "w-full bg-white border border-[#b8b3a9] focus:border-[#1a6b7f] outline-none rounded-xl px-5 py-4 text-[var(--text-primary)] text-lg placeholder-[#9ca3af] transition-colors";
  const underlineInput =
    "w-full bg-transparent border-b-2 border-[#d4cfc5] focus:border-[#1a6b7f] outline-none text-3xl font-semibold text-[var(--text-primary)] placeholder-[#9ca3af] py-3 transition-colors";

  return (
    <main className="min-h-screen bg-[#f8f6f1] flex flex-col">

      {/* Progress bar */}
      <div className="w-full h-1 bg-[#f0ede8]">
        <div
          className="h-1 bg-[#1a6b7f] transition-all duration-500 ease-out"
          style={{ width: `${(step / TOTAL_WIZARD_STEPS) * 100}%` }}
        />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-2">
        <button
          onClick={() => goTo(step === 35 ? 3 : step - 1)}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-sm font-medium"
        >
          ← Back
        </button>
        <span className="text-[var(--text-muted)] text-sm">
          {/* PHI-90: 35 is the sentinel for the country-recs sub-step; show
              it as "3.5" while keeping the step counter sensible. */}
          {step === 35 ? "3.5" : step} / {TOTAL_WIZARD_STEPS}
        </span>
      </div>

      {/* Step content */}
      <div className="flex-1 flex flex-col justify-center px-6 pb-10">
        <div className="w-full max-w-xl mx-auto animate-step" key={animKey}>

          <div className="mb-10">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight leading-tight mb-3 text-[var(--text-primary)]">
              {headings[step]}
            </h1>
            <p className="text-[var(--text-secondary)] text-lg">{subs[step]}</p>
          </div>

          {/* Step 1: Destination (editable) + Dates */}
          {step === 1 && (
            <Step1Destination
              destination={destination}
              handleDestinationChange={handleDestinationChange}
              handleDestinationSelect={handleDestinationSelect}
              destinationVerified={destinationVerified}
              useDestinationAsTyped={useDestinationAsTyped}
              darkInput={darkInput}
              flexMode={flexMode}
              setFlexMode={setFlexMode}
              departureDate={departureDate}
              setDepartureDate={setDepartureDate}
              returnDate={returnDate}
              setReturnDate={setReturnDate}
              setUserTypedReturn={setUserTypedReturn}
              flexMonth={flexMonth}
              setFlexMonth={setFlexMonth}
              flexNights={flexNights}
              setFlexNights={setFlexNights}
            />
          )}

          {/* Step 2: Hotel (optional). PHI-39: when multi-leg, render
              one hotel field per leg with the leg name as the label.
              Single-leg path is unchanged.
              PHI-100: single-leg path also exposes a "help me pick a
              neighbourhood →" affordance below the hotel input. Clicking
              swaps the hotel area for 4–6 AI-generated neighbourhood cards
              (lazy — no Anthropic call until clicked). Selecting a card
              fills `anchorNeighborhood` and continues to step 3. */}
          {step === 2 && parsedLegs.length < 2 && !neighborhoodPickerOpen && (
            <Step2HotelSingle
              hotel={hotel}
              setHotel={setHotel}
              hotelRich={hotelRich}
              setHotelRich={setHotelRich}
              destination={destination}
              destinationBias={destinationBias}
              handleContinue={handleContinue}
              openNeighborhoodPicker={openNeighborhoodPicker}
              anchorNeighborhood={anchorNeighborhood}
              setAnchorNeighborhood={setAnchorNeighborhood}
              underlineInput={underlineInput}
            />
          )}
          {step === 2 && parsedLegs.length < 2 && neighborhoodPickerOpen && (
            <Step2NeighborhoodPicker
              destination={destination}
              neighborhoodsLoading={neighborhoodsLoading}
              neighborhoodsError={neighborhoodsError}
              setNeighborhoodCards={setNeighborhoodCards}
              openNeighborhoodPicker={openNeighborhoodPicker}
              neighborhoodCards={neighborhoodCards}
              pickNeighborhood={pickNeighborhood}
              setNeighborhoodPickerOpen={setNeighborhoodPickerOpen}
            />
          )}
          {step === 2 && parsedLegs.length >= 2 && (
            <Step2HotelMultiLeg
              parsedLegs={parsedLegs}
              legHotels={legHotels}
              setLegHotels={setLegHotels}
              setLegHotelsRich={setLegHotelsRich}
              destinationBias={destinationBias}
              handleContinue={handleContinue}
              underlineInput={underlineInput}
            />
          )}

          {/* Step 3: Travel preferences */}
          {step === 3 && (
            <Step3Preferences
              adultCount={adultCount}
              setAdultCount={setAdultCount}
              childrenAges={childrenAges}
              addChild={addChild}
              updateChildAge={updateChildAge}
              removeChild={removeChild}
              travelCompany={travelCompany}
              setTravelCompany={setTravelCompany}
              travelerTypes={travelerTypes}
              toggleStyle={toggleStyle}
              budgetTier={budgetTier}
              setBudgetTier={setBudgetTier}
              constraintText={constraintText}
              setConstraintText={setConstraintText}
              constraintTags={constraintTags}
              toggleConstraint={toggleConstraint}
            />
          )}

          {/* PHI-57: Step 3.5 — AI city recommendations when the user
              entered a country instead of a city. Single Haiku call;
              re-rank-on-revisit handled by re-firing fetchCountryRecommendations
              when the user navigates back from a later step. */}
          {step === 35 && (
            <Step35CityPicker
              destination={destination}
              countryRecsLoading={countryRecsLoading}
              countryRecsError={countryRecsError}
              countryRecommendations={countryRecommendations}
              pickRecommendedCity={pickRecommendedCity}
            />
          )}

          {/* PHI-90 — Step 4: Must-dos textarea. Inserted between
              preferences (3) and the AI activity preview (now 5).
              Optional. Empty textarea is allowed and the user advances
              unchanged; the existing prompt path runs without an
              anchors block when the array is empty. The textarea grows
              with content (`min-h-[160px]`) and stays usable on a 360px
              viewport — the skip link sits visibly below it. */}
          {step === 4 && (
            <Step4MustDos
              userSeededText={userSeededText}
              setUserSeededText={setUserSeededText}
              destination={destination}
              popularPicksDisabledForDest={popularPicksDisabledForDest}
              countryRecommendations={countryRecommendations}
              popularPicksOpen={popularPicksOpen}
              setPopularPicksOpen={setPopularPicksOpen}
              popularPicksAddedCount={popularPicksAddedCount}
              popularPicksNudgeFiredRef={popularPicksNudgeFiredRef}
              openPopularPicks={openPopularPicks}
              popularPicksLoading={popularPicksLoading}
              popularPicksError={popularPicksError}
              setPopularPicks={setPopularPicks}
              popularPicks={popularPicks}
              isPickAdded={isPickAdded}
              addPick={addPick}
              removePick={removePick}
              handleContinue={handleContinue}
            />
          )}

          {/* Step 5: AI Preview with activity cards (was step 4 pre-PHI-90) */}
          {step === 5 && (
            <Step5Preview
              inspiration={inspiration}
              parsedActivities={parsedActivities}
              previewBadDays={previewBadDays}
              streamRefreshNote={streamRefreshNote}
              previewLoading={previewLoading}
              destination={destination}
              travelCompany={travelCompany}
              activityFeedback={activityFeedback}
              activityChips={activityChips}
              openChipId={openChipId}
              setOpenChipId={setOpenChipId}
              handleThumbsUp={handleThumbsUp}
              handleThumbsDown={handleThumbsDown}
              handleChipSelect={handleChipSelect}
              handleSkip={handleSkip}
              email={email}
            />
          )}

          {/* Step 6: Itinerary preview FIRST, then account creation.
              PHI-31 Part 2 slice 2 — the activation lever. Users see the
              actual product output before committing email. The signup
              form moves below as a "Save your trip" CTA.
              PHI-90 renumber: account step was 5, now 6. */}
          {step === 6 && (
            <Step6Account
              hardExcludedActivities={hardExcludedActivities}
              handleRemoveExclusion={handleRemoveExclusion}
              itineraryTimeSensitiveAlerts={itineraryTimeSensitiveAlerts}
              itineraryPlacementNotes={itineraryPlacementNotes}
              itineraryPreviewLoading={itineraryPreviewLoading}
              itineraryPreview={itineraryPreview}
              itineraryPreviewError={itineraryPreviewError}
              destination={destination}
              parsedLegs={parsedLegs}
              authedUser={authedUser}
              name={name}
              setName={setName}
              email={email}
              setEmail={setEmail}
              emailTouched={emailTouched}
              setEmailTouched={setEmailTouched}
              emailValid={emailValid}
              darkInput={darkInput}
            />
          )}

          {/* Continue / finish button — hidden on step 3.5 since the
              user advances by picking a recommendation card or typing
              into the free-text fallback. PHI-64: also hidden on the
              account step (now 6) when a signed-in user has a known name
              (auto-finish runs). */}
          {step !== 35 && !(step === 6 && authedUser?.existingName) && (
          <button
            onClick={handleContinue}
            disabled={!canContinue[step] || saving}
            className="mt-10 w-full rounded-2xl bg-[#1a6b7f] text-white font-bold text-lg py-5 hover:bg-[#155a6b] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {saving
              ? step === TOTAL_WIZARD_STEPS
                ? authedUser
                  ? "Saving your trip…"
                  : "Sending magic link…"
                : "Saving your trip…"
              : step === TOTAL_WIZARD_STEPS
              ? authedUser
                ? "Save trip →"
                : "Send magic link →"
              : step === 4
              ? splitSeededActivities(userSeededText).length > 0
                ? `Continue with ${splitSeededActivities(userSeededText).length} must-do${splitSeededActivities(userSeededText).length === 1 ? "" : "s"} →`
                : "Continue →"
              : step === 5
              ? previewLoading
                ? "Loading activities…"
                : Object.keys(activityFeedback).length === 0
                ? "Rate at least one activity to continue"
                : Object.keys(activityFeedback).length < Math.ceil(parsedActivities.length / 2)
                ? `Continue with ${Object.keys(activityFeedback).length} rated — more = better results →`
                : `Continue with ${Object.keys(activityFeedback).length} rated →`
              : "Continue →"}
          </button>
          )}

        </div>
      </div>

    </main>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomePageInner />
    </Suspense>
  );
}
