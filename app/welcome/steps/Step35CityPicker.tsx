"use client";

import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";

type Step35CityPickerProps = {
  destination: string;
  countryRecsLoading: boolean;
  countryRecsError: string | null;
  countryRecommendations: { name: string; kind: "city" | "region"; why: string; lat?: number; lng?: number }[];
  pickRecommendedCity: (name: string) => void;
};

export function Step35CityPicker({
  destination,
  countryRecsLoading,
  countryRecsError,
  countryRecommendations,
  pickRecommendedCity,
}: Step35CityPickerProps) {
  return (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[var(--text-secondary)]">
                You picked <span className="font-semibold">{destination}</span> as a country. Here are 4 cities or regions that fit your profile.
              </p>
              {countryRecsLoading && (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <div className="w-3 h-3 rounded-full border-2 border-[#1a6b7f] border-t-transparent animate-spin" />
                  <span>Picking the best fit…</span>
                </div>
              )}
              {!countryRecsLoading && countryRecsError && (
                <p className="text-sm text-red-500">{countryRecsError}</p>
              )}
              {!countryRecsLoading && countryRecommendations.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  {countryRecommendations.map((rec) => (
                    <button
                      key={rec.name}
                      type="button"
                      onClick={() => pickRecommendedCity(rec.name)}
                      className="text-left bg-white border border-[#e8e4de] rounded-2xl px-4 py-3 hover:border-[#1a6b7f] transition-colors"
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-semibold text-[var(--text-primary)]">{rec.name}</span>
                        <span className="text-[10px] uppercase tracking-widest font-semibold text-[#1a6b7f]">
                          {rec.kind}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{rec.why}</p>
                    </button>
                  ))}
                </div>
              )}
              <div className="mt-2">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest mb-2">
                  Or pick a city yourself
                </p>
                <PlacesAutocomplete
                  value=""
                  onChange={() => {}}
                  onSelect={(place) => {
                    const name = place.split(",")[0].trim();
                    if (!name) return;
                    pickRecommendedCity(name);
                  }}
                  placeholder={`e.g. a city in ${destination}`}
                  types={["(cities)"]}
                  theme="light"
                  className="w-full bg-white border border-[#d4cfc5] focus:border-[#1a6b7f] outline-none rounded-xl px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[#9ca3af] transition-colors"
                />
              </div>
            </div>
  );
}
