/**
 * Single helper for "today" as an Asia/Seoul calendar date. Spec 0001 §
 * Cross-platform: all *dates* (as_of_date, transaction_date, briefing_date)
 * are explicit Asia/Seoul calendar dates computed via a single helper, never
 * via the host locale/TZ.
 */
export function todayInSeoul(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date()); // en-CA formats as YYYY-MM-DD
}
