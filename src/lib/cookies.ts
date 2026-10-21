export interface CookieConsent {
  essential: boolean;
  analytics: boolean;
  marketing: boolean;
  affiliate: boolean;
  timestamp: string;
  version: string;
}

const STORAGE_KEY = 'bae_cookie_consent_v1';

export function getConsent(): CookieConsent | null {
  if (typeof window === 'undefined') return null;
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setConsent(consent: Omit<CookieConsent, 'essential'>): CookieConsent {
  const fullConsent: CookieConsent = {
    essential: true,
    ...consent,
    timestamp: new Date().toISOString(),
    version: '1.0',
  };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(fullConsent));
    } catch {
      // localStorage not available
    }
    window.dispatchEvent(new CustomEvent('bae-consent-updated', { detail: fullConsent }));
  }
  applyConsent(fullConsent);
  return fullConsent;
}

export function applyConsent(consent: CookieConsent | null): void {
  if (typeof document === 'undefined' || !consent) return;
  document.body.setAttribute('data-consent-analytics', consent.analytics ? 'true' : 'false');
  document.body.setAttribute('data-consent-marketing', consent.marketing ? 'true' : 'false');
  document.body.setAttribute('data-consent-affiliate', consent.affiliate ? 'true' : 'false');
  
  // Conditionally load scripts based on consent
  if (consent.analytics) {
    loadAnalytics();
  }
  if (consent.affiliate) {
    enableAffiliateTracking();
  }
}

function loadAnalytics(): void {
  // GA4 will be loaded here when configured
  // gtag('consent', 'update', { analytics_storage: 'granted' });
}

function enableAffiliateTracking(): void {
  // Affiliate tracking enabled
  // Outbound click events will fire
}

export function hasConsent(): boolean {
  return getConsent() !== null;
}
