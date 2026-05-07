/**
 * PHI-53 — Weather forecast helpers (Open-Meteo, free tier, no API key).
 *
 * Used to flag which trip days are likely to be wet so outdoor activities
 * can surface their AI-paired wet-weather alternative inline. Fail-open
 * posture: if Open-Meteo errors, returns null and callers default to
 * showing alternatives universally for the affected dates.
 *
 * Endpoint: https://api.open-meteo.com/v1/forecast
 * Free forecast horizon is 16 days; trips beyond that fall back to
 * fail-open (caller passes null).
 */

export type DayForecast = {
  /** ISO date string YYYY-MM-DD. */
  date: string;
  /** Daily max precipitation probability (0-100). */
  precipitationProbabilityMax: number;
  /** Daily total precipitation in mm. */
  precipitationSum: number;
};

/**
 * Threshold rule per PRD: a day is "bad" if precip prob > 50% OR precip
 * sum > 2mm. The OR keeps a heavy-drizzle low-prob day flagged and a
 * high-prob light-drizzle day flagged too.
 */
export function isBadDay(forecast: DayForecast): boolean {
  return (
    forecast.precipitationProbabilityMax > 50 ||
    forecast.precipitationSum > 2
  );
}

/**
 * Fetch daily precipitation forecast for a coordinate over a date range.
 * Returns null on any failure (network, parse, out-of-horizon dates) so
 * the caller defaults to fail-open behaviour.
 */
export async function fetchForecast(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string
): Promise<DayForecast[] | null> {
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lng));
    url.searchParams.set("start_date", startDate);
    url.searchParams.set("end_date", endDate);
    url.searchParams.set(
      "daily",
      "precipitation_probability_max,precipitation_sum"
    );
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url, {
      // Short timeout — we'd rather fail open than block itinerary gen.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      daily?: {
        time?: string[];
        precipitation_probability_max?: number[];
        precipitation_sum?: number[];
      };
    };
    const daily = json.daily;
    if (!daily?.time || !Array.isArray(daily.time)) return null;
    return daily.time.map((date, i) => ({
      date,
      precipitationProbabilityMax:
        daily.precipitation_probability_max?.[i] ?? 0,
      precipitationSum: daily.precipitation_sum?.[i] ?? 0,
    }));
  } catch (err) {
    console.warn("[weather] fetch failed:", err);
    return null;
  }
}

/**
 * Convenience: returns the set of bad-day ISO dates given a forecast list.
 * Returns null when forecast is null so callers can detect fail-open.
 */
export function badDayDates(
  forecast: DayForecast[] | null
): string[] | null {
  if (!forecast) return null;
  return forecast.filter(isBadDay).map((f) => f.date);
}
