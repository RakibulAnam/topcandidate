// Single source of truth for how customers reach us.
//
// Update the address here and it propagates everywhere — the Terms of Service
// contact section, the bKash purchase-status pill, and the dispute dialog all
// import from this module. Don't hard-code the email anywhere else.

export const CONTACT_EMAIL = 'topcandidatebd@gmail.com';

/**
 * Builds a `mailto:` link, optionally prefilled with a subject and body.
 * Both are URL-encoded so transaction IDs and notes survive intact.
 */
export const contactMailto = (subject?: string, body?: string): string => {
  const params = new URLSearchParams();
  if (subject) params.set('subject', subject);
  if (body) params.set('body', body);
  const qs = params.toString();
  return `mailto:${CONTACT_EMAIL}${qs ? `?${qs}` : ''}`;
};
