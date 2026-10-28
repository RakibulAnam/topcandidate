// The business runs on Bangladesh time (UTC+6, no DST). Day buckets and
// "today" use it, not UTC — otherwise 00:00–06:00 sales land on yesterday.
const OFFSET_MS = 6 * 3600_000;

/** 'YYYY-MM-DD' of the Dhaka calendar day an instant falls on. */
export const dhakaDay = (at: string | number | Date): string =>
  new Date(new Date(at).getTime() + OFFSET_MS).toISOString().slice(0, 10);

/** The instant today's Dhaka day started. */
export const startOfDhakaToday = (now = Date.now()): Date =>
  new Date(Date.parse(`${dhakaDay(now)}T00:00:00Z`) - OFFSET_MS);
