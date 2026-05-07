"use client";

import { useState, useEffect, useRef, useCallback } from "react";

type Suggestion = {
  placeId: string;
  mainText: string;
  secondaryText: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSelect: (description: string) => void;
  placeholder?: string;
  types?: string[];
  locationBias?: { lat: number; lng: number } | null;
  /** PHI-56 / PHI-57: ISO-3166 region code (e.g. "GB", "JP") for country-biased
   *  searches. Restricts suggestions to that country only. */
  countryCode?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
  onEnter?: () => void;
  theme?: "dark" | "light";
};

// PHI-56: legacy "(cities)" callers used to pass this string. The new
// Places API doesn't accept it; map it to the equivalent strict primary
// types so country queries no longer surface granular sub-city matches
// (e.g. "Hoyland, Barnsley" for "United Kingdom").
const CITY_PRIMARY_TYPES = ["locality", "administrative_area_level_1"] as const;
function coercePrimaryTypes(types: string[] | undefined): string[] {
  if (!types || types.length === 0) return [...CITY_PRIMARY_TYPES];
  return types.flatMap((t) =>
    t === "(cities)" ? [...CITY_PRIMARY_TYPES] : [t],
  );
}

// Module-level singleton so the script loads only once per page
let mapsLoadPromise: Promise<void> | null = null;

function ensureMapsLoaded(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps?.places) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise<void>((resolve, reject) => {
    const cbName = "__riseMapsReady__";
    (window as unknown as Record<string, unknown>)[cbName] = resolve;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_PLACES_KEY}&libraries=places&callback=${cbName}&loading=async`;
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });

  return mapsLoadPromise;
}

export default function PlacesAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "",
  types,
  locationBias,
  countryCode,
  className = "",
  style,
  autoFocus,
  onEnter,
  theme = "dark",
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [ready, setReady] = useState(false);
  // PHI-56: distinguish "haven't searched yet" from "searched and got
  // zero results." The empty-state row appears only when the latter is
  // true so we don't show "We couldn't find that" before the first call.
  const [searched, setSearched] = useState(false);
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only show suggestions after the user has actively typed — prevents the
  // dropdown from opening immediately when a pre-filled value is passed in.
  const hasTypedRef = useRef(false);
  // Suppresses the suggestions fetch for one cycle after a selection is made,
  // preventing the dropdown from reopening when onSelect updates the value.
  const justSelectedRef = useRef(false);

  useEffect(() => {
    ensureMapsLoaded()
      .then(() => {
        tokenRef.current = new google.maps.places.AutocompleteSessionToken();
        setReady(true);
      })
      .catch(() => {
        // Silently fall back to plain text input
      });
  }, []);

  useEffect(() => {
    if (justSelectedRef.current) {
      return;
    }
    if (!ready || !hasTypedRef.current || value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      setSearched(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        // PHI-56: tighten primary types so country queries ("united
        // kingdom", "japan") no longer return random villages whose
        // address happens to contain the country name. Default is
        // locality + administrative_area_level_1; legacy "(cities)"
        // callers are translated.
        const includedPrimaryTypes = coercePrimaryTypes(types);
        const request: google.maps.places.AutocompleteRequest = {
          input: value,
          sessionToken: tokenRef.current ?? undefined,
          // PHI-56: avoid mixed-language output ("Verenigd Koninkrijk").
          language: "en",
          includedPrimaryTypes,
          ...(countryCode && { includedRegionCodes: [countryCode] }),
          ...(locationBias && {
            locationBias: {
              center: new google.maps.LatLng(locationBias.lat, locationBias.lng),
              radius: 50000,
            },
          }),
        };

        const { suggestions: raw } =
          await google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);

        const mapped: Suggestion[] = raw
          .map((s) => {
            const p = s.placePrediction;
            if (!p) return null;
            const mainText = ((p as any).text?.text as string | undefined) ?? String((p as any).text ?? "");
            const secondaryText = "";
            return {
              placeId: p.placeId,
              mainText,
              secondaryText,
            };
          })
          .filter((s): s is Suggestion => s !== null);

        setSuggestions(mapped);
        // PHI-56: open the dropdown even when results are empty so the
        // empty-state row can render. Without this the user sees nothing
        // when they type a country.
        setOpen(true);
        setSearched(true);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
        setOpen(true);
        setSearched(true);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, ready, types, locationBias, countryCode]);

  const handleSelect = useCallback(
    (s: Suggestion) => {
      const description = s.secondaryText
        ? `${s.mainText}, ${s.secondaryText}`
        : s.mainText;
      justSelectedRef.current = true;
      onChange(description);
      onSelect(description);
      setSuggestions([]);
      setOpen(false);
      // Renew session token after selection
      tokenRef.current = new google.maps.places.AutocompleteSessionToken();
    },
    [onChange, onSelect]
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) {
      if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        handleSelect(suggestions[activeIdx]);
      } else if (onEnter) {
        onEnter();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={(e) => { hasTypedRef.current = true; justSelectedRef.current = false; onChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
        style={style}
      />

      {open && (suggestions.length > 0 || searched) && (
        <div className={`absolute z-50 w-full mt-2 rounded-2xl overflow-hidden shadow-2xl ${
          theme === "light"
            ? "bg-white border border-[#d4cfc5]"
            : "bg-[#1a1a1a] border border-[#2a2a2a]"
        }`}>
          {suggestions.map((s, i) => (
            <button
              key={s.placeId}
              type="button"
              onMouseDown={() => handleSelect(s)}
              className={`w-full text-left px-5 py-3.5 transition-colors ${
                theme === "light"
                  ? `${i === activeIdx ? "bg-[#f0ede6]" : "hover:bg-[#f5f2ec]"} ${i > 0 ? "border-t border-[#e8e4dc]" : ""}`
                  : `${i === activeIdx ? "bg-[#2a2a2a]" : "hover:bg-[#222]"} ${i > 0 ? "border-t border-[#222]" : ""}`
              }`}
            >
              <div className={`text-sm font-semibold ${theme === "light" ? "text-[var(--text-primary)]" : "text-white"}`}>{s.mainText}</div>
              {s.secondaryText && (
                <div className={`text-xs mt-0.5 ${theme === "light" ? "text-[var(--text-secondary)]" : "text-gray-500"}`}>{s.secondaryText}</div>
              )}
            </button>
          ))}
          {/* PHI-56: empty-state row when the query (especially a
              country query) returned no city or region match. */}
          {suggestions.length === 0 && searched && (
            <div
              data-testid="autocomplete-empty"
              className={`px-5 py-3.5 text-sm ${
                theme === "light"
                  ? "text-[var(--text-muted)]"
                  : "text-gray-400"
              }`}
            >
              We couldn&apos;t find that — try a city or region.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
