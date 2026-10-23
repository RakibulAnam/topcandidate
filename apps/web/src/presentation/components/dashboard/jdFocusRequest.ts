// One-shot "take me to the job-post box" request, for surfaces that live
// outside DashboardScreen (the purchase modal's free-kit gift panel, the
// profile page). The request survives a navigation to Home: DashboardScreen
// consumes it on mount, or straight away through the event when Home is
// already on screen.

const EVENT = 'tc:focus-jd';
let pending = false;

export function requestJdFocus(): void {
  pending = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

/** True once per request; clears it. */
export function consumeJdFocusRequest(): boolean {
  const was = pending;
  pending = false;
  return was;
}

export const JD_FOCUS_EVENT = EVENT;
