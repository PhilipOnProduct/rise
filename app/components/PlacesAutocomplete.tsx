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
  className?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
};

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
  className = "",
  autoFocus,
  onEnter,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [ready, setReady] = useState(false);
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
      justSelectedRef.current = false;
      return;
    }
    if (!ready || !hasTypedRef.current || value.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        const request = {
          input: value,
          sessionToken: tokenRef.current ?? undefined,
          ...(types?.length && { includedPrimaryTypes: types }),
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
        setOpen(mapped.length > 0);
        setActiveIdx(-1);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, ready, types, locationBias]);

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
        onChange={(e) => { hasTypedRef.current = true; onChange(e.target.value); }}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={className}
      />

      {open && suggestions.length > 0 && (
        <div className="absolute z-50 w-full mt-2 bg-[#1a1a1a] border border-[#2a2a2a] rounded-2xl overflow-hidden shadow-2xl">
          {suggestions.map((s, i) => (
            <button
              key={s.placeId}
              type="button"
              onMouseDown={() => handleSelect(s)}
              className={`w-full text-left px-5 py-3.5 transition-colors ${
                i === activeIdx ? "bg-[#2a2a2a]" : "hover:bg-[#222]"
              } ${i > 0 ? "border-t border-[#222]" : ""}`}
            >
              <div className="text-sm font-semibold text-white">{s.mainText}</div>
              {s.secondaryText && (
                <div className="text-xs text-gray-500 mt-0.5">{s.secondaryText}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
