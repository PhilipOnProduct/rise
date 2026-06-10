"use client";

import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";

type LandingStructuredProps = {
  animKey: number;
  destination: string;
  handleDestinationChange: (text: string) => void;
  handleDestinationSelect: (place: string) => void;
  destinationVerified: boolean;
  useDestinationAsTyped: () => void;
  goTo: (next: number) => void;
};

export function LandingStructured({
  animKey,
  destination,
  handleDestinationChange,
  handleDestinationSelect,
  destinationVerified,
  useDestinationAsTyped,
  goTo,
}: LandingStructuredProps) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: "#f8f6f1" }}>
        <div className="w-full max-w-xl animate-step" key={animKey}>
          <p className="font-extrabold text-xl tracking-tight mb-16" style={{ color: "#0e2a47" }}>Rise</p>
          <h1
            className="text-5xl md:text-6xl tracking-tight leading-tight mb-4"
            style={{ color: "#0e2a47", fontWeight: 300, letterSpacing: "-1px" }}
          >
            Where to?
          </h1>
          <p className="text-lg mb-10" style={{ color: "#4a6580" }}>
            Tell us your destination and we&apos;ll build your trip.
          </p>
          <PlacesAutocomplete
            value={destination}
            onChange={handleDestinationChange}
            onSelect={(place) => handleDestinationSelect(place)}
            placeholder="e.g. Tokyo, Japan"
            types={["(cities)"]}
            autoFocus
            theme="light"
            onEnter={() => {
              // PHI-30: Enter only advances when the user has explicitly
              // verified the destination. Otherwise nothing — the dropdown
              // and "Use anyway" link below give them a clear path.
              if (destination.trim() && destinationVerified) goTo(1);
            }}
            className="w-full bg-white border-b-2 border-[#d4cfc5] focus:border-[#1a6b7f] outline-none text-3xl font-medium py-3 transition-colors placeholder-[#b8b0a4]"
            style={{ color: "#0e2a47" }}
          />

          {/* PHI-30: escape hatch — explicit "Use anyway" affordance for
              free-form input that doesn't match an autocomplete suggestion
              (regions, unusual spellings, fictional places, etc.) */}
          {destination.trim().length >= 2 && !destinationVerified && (
            <button
              type="button"
              onClick={useDestinationAsTyped}
              className="mt-3 text-sm text-[#1a6b7f] hover:text-[var(--text-primary)] underline-offset-4 hover:underline transition-colors"
              data-testid="use-destination-anyway"
            >
              Use &ldquo;{destination.trim()}&rdquo; anyway →
            </button>
          )}

          <button
            onClick={() => goTo(1)}
            disabled={!destination.trim() || !destinationVerified}
            className="mt-10 w-full text-white font-semibold text-lg py-5 hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ backgroundColor: "#1a6b7f", borderRadius: 50 }}
          >
            Start planning &rarr;
          </button>
        </div>
      </main>
    );
}
