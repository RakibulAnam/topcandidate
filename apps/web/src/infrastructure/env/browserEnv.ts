// What kind of browser the page is running in, read from the user agent.
// Shared by analytics (every event carries it) and the in-app browser escape
// bar. Pure and synchronous — safe to call during render and in SSR (returns
// the "unknown" answer when there is no navigator).

export type InAppBrowser = 'facebook' | 'messenger' | 'instagram' | 'tiktok' | 'webview' | null;
export type DeviceClass = 'mobile' | 'tablet' | 'desktop';
export type MobileOs = 'android' | 'ios' | null;

const ua = (): string => (typeof navigator !== 'undefined' ? navigator.userAgent || '' : '');

/**
 * Which in-app browser (if any) is hosting the page. Messenger is checked
 * before Facebook because its UA also carries FBAN/FB_IAB. `webview` is a
 * generic Android WebView (`; wv)`) inside some other app.
 */
export function detectInAppBrowser(userAgent: string = ua()): InAppBrowser {
  if (/FB_IAB\/MESSENGER|FBAN\/Messenger|MessengerForiOS|MessengerLite/i.test(userAgent)) return 'messenger';
  if (/FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(userAgent)) return 'facebook';
  if (/Instagram/i.test(userAgent)) return 'instagram';
  if (/BytedanceWebview|musical_ly|TikTok/i.test(userAgent)) return 'tiktok';
  if (/Android.*; wv\)/i.test(userAgent)) return 'webview';
  return null;
}

export function detectMobileOs(userAgent: string = ua()): MobileOs {
  if (/Android/i.test(userAgent)) return 'android';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  return null;
}

export function detectDevice(userAgent: string = ua()): DeviceClass {
  if (/iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}
