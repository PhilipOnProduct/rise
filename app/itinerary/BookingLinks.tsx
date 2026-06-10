"use client";

import type { ItineraryItem } from "./itinerary-types";

function buildBookingUrl(platform: string, searchQuery: string): string {
  const q = encodeURIComponent(searchQuery);
  switch (platform) {
    case "opentable":
      return `https://www.opentable.com/s?term=${q}`;
    case "resy":
      return `https://resy.com/cities?query=${q}`;
    case "thefork":
      return `https://www.thefork.com/search?q=${q}`;
    default:
      return "#";
  }
}

const PLATFORM_LABELS: Record<string, string> = {
  opentable: "OpenTable",
  resy: "Resy",
  thefork: "TheFork",
};

export function BookingLinks({ item }: { item: ItineraryItem }) {
  const searchQuery = item.booking_meta?.search_query || item.title;
  const preferred = item.booking_meta?.preferred_platform;

  return (
    <div className="flex gap-2 mt-2 flex-wrap">
      {(["opentable", "resy", "thefork"] as const).map((platform) => (
        <a
          key={platform}
          href={buildBookingUrl(platform, searchQuery)}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
            platform === preferred
              ? "bg-[#00D64F]/15 text-[#00D64F] border border-[#00D64F]/30 hover:bg-[#00D64F]/25"
              : "bg-[#1a1a1a] text-gray-400 border border-[#2a2a2a] hover:text-white hover:border-[#444]"
          }`}
        >
          {PLATFORM_LABELS[platform]}
          {platform === preferred && item.booking_meta?.confidence === "high" && " \u2713"}
        </a>
      ))}
    </div>
  );
}
