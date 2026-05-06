"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import PlacesAutocomplete from "@/app/components/PlacesAutocomplete";

export default function LandingHero() {
  const [destination, setDestination] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();
  const submittedRef = useRef(false);

  const canSubmit = destination.trim().length >= 2 && !submitting;

  function handleSubmit() {
    if (submittedRef.current) return;
    if (destination.trim().length < 2) return;
    submittedRef.current = true;
    setSubmitting(true);
    const seed = destination.split(",")[0].trim();
    router.push(`/welcome?destination=${encodeURIComponent(seed)}`);
  }

  return (
    <div className="w-full max-w-2xl flex flex-col items-center text-center">
      <p
        className="text-[11px] font-medium uppercase mb-4"
        style={{ color: "#2a7f8f", letterSpacing: "2px" }}
      >
        AI-powered trip planning
      </p>

      <h1
        className="mb-4"
        style={{
          color: "#0e2a47",
          fontSize: "clamp(36px, 5vw, 56px)",
          fontWeight: 300,
          letterSpacing: "-1px",
          lineHeight: 1.15,
        }}
      >
        Plan a trip that knows{" "}
        <br className="hidden sm:inline" />
        where you&apos;re going.
      </h1>

      <p
        className="text-base sm:text-lg mb-6 max-w-xl mx-auto"
        style={{ color: "#4a6580", lineHeight: 1.6 }}
      >
        Most travel apps guess. Rise asks where you&apos;re going, who&apos;s
        coming, and how you actually like to travel — then builds the day.
      </p>

      <div
        className="w-full max-w-[480px] flex items-center gap-2 rounded-2xl pl-4 pr-1.5 py-1.5"
        style={{ backgroundColor: "#ffffff", border: "1px solid #e8e4de" }}
      >
        <div className="flex-1 min-w-0">
          <PlacesAutocomplete
            value={destination}
            onChange={setDestination}
            onSelect={setDestination}
            placeholder="Where to? Lisbon, Tokyo, Marrakech…"
            types={["(cities)"]}
            theme="light"
            onEnter={handleSubmit}
            className="w-full bg-transparent border-none outline-none text-[15px] py-2.5"
            style={{ color: "#0e2a47" }}
          />
        </div>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="Plan it"
          className="font-semibold text-sm text-white px-5 py-2.5 rounded-full transition-opacity disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
          style={{ backgroundColor: "#1a6b7f", whiteSpace: "nowrap" }}
        >
          Plan it &rarr;
        </button>
      </div>
    </div>
  );
}
