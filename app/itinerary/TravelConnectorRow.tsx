"use client";

import { formatDistance, formatDuration } from "./itinerary-helpers";
import type { TravelConnector } from "./itinerary-types";

// ── TravelConnectorRow ───────────────────────────────────────────────────────

export function TravelConnectorRow({ connector }: { connector: TravelConnector }) {
  // Error state — no data at all
  if (connector.error && connector.walk_seconds == null && connector.transit_seconds == null && connector.drive_seconds == null) {
    return (
      <div className="mx-1 my-1 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 text-red-500 text-xs flex items-center gap-1.5">
        <span aria-hidden>⚠</span>
        <span>Travel data unavailable</span>
      </div>
    );
  }

  const walkSec = connector.walk_adjusted_seconds ?? connector.walk_seconds;
  type Segment = { icon: string; label: string; text: string };
  const segments: Segment[] = [];

  // Filter out zero-duration modes — 0 means no viable route, not instant travel
  if (walkSec != null && walkSec > 0) {
    segments.push({ icon: "🚶", label: "Walking", text: formatDuration(walkSec) });
  }
  if (connector.transit_seconds != null && connector.transit_seconds > 0) {
    let text = formatDuration(connector.transit_seconds);
    if (connector.transit_fare) text += ` ${connector.transit_fare}`;
    segments.push({ icon: "🚇", label: "Public transit", text });
  }
  if (connector.drive_seconds != null && connector.drive_seconds > 0) {
    const text =
      connector.drive_meters != null && connector.drive_meters > 0
        ? `~${formatDistance(connector.drive_meters)}`
        : formatDuration(connector.drive_seconds);
    segments.push({ icon: "🚕", label: "Driving", text });
  }

  if (segments.length === 0) return null;

  // Flagged state
  if (connector.gap_flagged) {
    return (
      <div className="mx-1 my-1.5 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span aria-hidden>⚠</span>
          <span className="font-semibold">Tight connection</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-amber-600">
          {segments.map((seg, i) => (
            <span key={i}>
              {i > 0 && <span className="text-amber-300 mr-2">·</span>}
              <span title={seg.label} aria-label={seg.label}>{seg.icon}</span> {seg.text}
            </span>
          ))}
        </div>
        {connector.flag_reason && (
          <p className="text-[10px] text-amber-500 mt-0.5">{connector.flag_reason}</p>
        )}
      </div>
    );
  }

  // Normal state
  return (
    <div className="mx-1 my-1.5 text-xs text-[var(--text-secondary)] flex items-center gap-2 flex-wrap px-2 py-1 border-l-2 border-[#e8e4de]">
      {segments.map((seg, i) => (
        <span key={i}>
          {i > 0 && <span className="text-[#d4cfc5] mr-2">·</span>}
          <span title={seg.label} aria-label={seg.label}>{seg.icon}</span> {seg.text}
        </span>
      ))}
    </div>
  );
}
