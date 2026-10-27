// Per-browser-session flags for Home surfaces (e.g. ResumeOfferPreview's
// "counted once"). sessionStorage on purpose — counted again next visit, but
// never twice within one. Lives apart from the components so those files
// export only components (Vite Fast Refresh requirement).

export function sessionFlag(key: string): boolean {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

export function setSessionFlag(key: string): void {
  try { sessionStorage.setItem(key, '1'); } catch { /* storage blocked: lasts this render only */ }
}
