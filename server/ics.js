/**
 * ics.js — fetch + parse a subscribed web ICS calendar URL into a flat,
 * sorted list of upcoming events (right pane's "next events"). Recurring
 * events are expanded via ical.js's own recurrence iterator, capped to a
 * time window so an infinitely-repeating event can't hang the request.
 */
import ICAL from "ical.js";

const WINDOW_DAYS = 120;
const MAX_OCCURRENCES_PER_EVENT = 10;

export async function fetchUpcomingEvents(icsUrl, { limit = 20 } = {}) {
  if (!icsUrl) return [];

  const res = await fetch(icsUrl);
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
  const text = await res.text();

  const jcal = ICAL.parse(text);
  const comp = new ICAL.Component(jcal);
  const vevents = comp.getAllSubcomponents("vevent");

  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const out = [];
  for (const ve of vevents) {
    const event = new ICAL.Event(ve);
    const summary = event.summary || "(sans titre)";
    const location = event.location || "";
    const description = event.description || "";

    if (event.isRecurring()) {
      const iterator = event.iterator();
      let next;
      let count = 0;
      while (count < MAX_OCCURRENCES_PER_EVENT && (next = iterator.next())) {
        const start = next.toJSDate();
        if (start > windowEnd) break;
        if (start >= now) {
          out.push({ summary, location, description, start: start.toISOString() });
          count++;
        }
      }
    } else {
      const start = event.startDate?.toJSDate();
      if (start && start >= now && start <= windowEnd) {
        out.push({ summary, location, description, start: start.toISOString() });
      }
    }
  }

  out.sort((a, b) => new Date(a.start) - new Date(b.start));
  return out.slice(0, limit);
}
