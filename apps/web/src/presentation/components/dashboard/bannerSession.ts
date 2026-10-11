// Per-browser-session flags for the Home guide banners (WelcomeBanner,
// KitReadyBanner): "hide for now" and "counted once". sessionStorage on
// purpose — a gift the user hasn't used should greet them again next visit,
// but never nag twice within one. Lives apart from the components so those
// files export only components (Vite Fast Refresh requirement).

export function sessionFlag(key: string): boolean {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

export function setSessionFlag(key: string): void {
  try { sessionStorage.setItem(key, '1'); } catch { /* storage blocked: lasts this render only */ }
}

export const WELCOME_HIDDEN_KEY = 'tc.welcomeBanner.hidden';
export const KIT_READY_HIDDEN_KEY = 'tc.kitReadyBanner.hidden';
