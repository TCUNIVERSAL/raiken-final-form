/**
 * Client Tracking & Cookie Traceability Utility
 * Captures user telemetry, persistent tracking cookies (phone, name, email, browser, OS, session),
 * and enables returning user identification for audit trail and compliance.
 */

// Helper to set a cookie with SameSite & Expiry
export function setCookie(name: string, value: string, days: number = 365) {
  const d = new Date();
  d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
  const expires = `expires=${d.toUTCString()}`;
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)};${expires};path=/;SameSite=Lax`;
  try {
    localStorage.setItem(name, value);
  } catch (e) {
    // ignore
  }
}

// Helper to get a cookie value
export function getCookie(name: string): string {
  const cname = `${encodeURIComponent(name)}=`;
  const decoded = decodeURIComponent(document.cookie);
  const ca = decoded.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i].trim();
    if (c.indexOf(cname) === 0) {
      return c.substring(cname.length, c.length);
    }
  }
  // Fallback to localStorage if cookies were blocked
  try {
    return localStorage.getItem(name) || '';
  } catch (e) {
    return '';
  }
}

// Generate or retrieve persistent unique session / device ID
export function getOrSetSessionId(): string {
  let sessionId = getCookie('raikan_session_id');
  if (!sessionId) {
    sessionId = 'sess_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now().toString(36);
    setCookie('raikan_session_id', sessionId, 365);
  }
  return sessionId;
}

// Save user identity to persistent cookies
export function saveUserIdentityCookies(data: { name?: string; phone?: string; email?: string }) {
  if (data.name) setCookie('raikan_user_name', data.name, 365);
  if (data.phone) setCookie('raikan_user_phone', data.phone, 365);
  if (data.email) setCookie('raikan_user_email', data.email, 365);
  setCookie('raikan_last_active', new Date().toISOString(), 365);

  const prevCount = parseInt(getCookie('raikan_visit_count') || '0', 10);
  setCookie('raikan_visit_count', String(prevCount + 1), 365);
}

// Retrieve remembered user information from cookies
export function getRememberedUser() {
  return {
    sessionId: getOrSetSessionId(),
    name: getCookie('raikan_user_name'),
    phone: getCookie('raikan_user_phone'),
    email: getCookie('raikan_user_email'),
    lastActive: getCookie('raikan_last_active'),
    visitCount: parseInt(getCookie('raikan_visit_count') || '1', 10)
  };
}

// Detect browser brand & version
function detectBrowser(): { browser: string; os: string; deviceType: string } {
  const ua = navigator.userAgent;
  let browser = 'Unknown Browser';
  let os = 'Unknown OS';
  let deviceType = 'Desktop';

  // Device type
  if (/mobile/i.test(ua)) {
    deviceType = 'Mobile';
  } else if (/tablet|ipad/i.test(ua)) {
    deviceType = 'Tablet';
  }

  // OS Detection
  if (/windows/i.test(ua)) os = 'Windows';
  else if (/macintosh|mac os x/i.test(ua)) os = 'macOS';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/linux/i.test(ua)) os = 'Linux';

  // Browser Detection
  if (/edg/i.test(ua)) {
    const m = ua.match(/edg\/([\d.]+)/i);
    browser = `Microsoft Edge ${m ? m[1] : ''}`.trim();
  } else if (/opr|opera/i.test(ua)) {
    const m = ua.match(/(?:opr|opera)\/([\d.]+)/i);
    browser = `Opera ${m ? m[1] : ''}`.trim();
  } else if (/chrome|crios/i.test(ua)) {
    const m = ua.match(/(?:chrome|crios)\/([\d.]+)/i);
    browser = `Chrome ${m ? m[1] : ''}`.trim();
  } else if (/firefox|fxios/i.test(ua)) {
    const m = ua.match(/(?:firefox|fxios)\/([\d.]+)/i);
    browser = `Firefox ${m ? m[1] : ''}`.trim();
  } else if (/safari/i.test(ua)) {
    const m = ua.match(/version\/([\d.]+)/i);
    browser = `Safari ${m ? m[1] : ''}`.trim();
  }

  return { browser, os, deviceType };
}

export interface ClientTelemetry {
  sessionId: string;
  userName: string;
  userPhone: string;
  userEmail: string;
  browser: string;
  operatingSystem: string;
  deviceType: string;
  screenResolution: string;
  viewportSize: string;
  timezone: string;
  language: string;
  referrer: string;
  userAgent: string;
  cookiesEnabled: boolean;
  timestamp: string;
}

// Collect comprehensive client telemetry for Supabase audit logging
export function collectClientTelemetry(userOverride?: { name?: string; phone?: string; email?: string }): ClientTelemetry {
  const remembered = getRememberedUser();
  const { browser, os, deviceType } = detectBrowser();

  const name = userOverride?.name || remembered.name || '';
  const phone = userOverride?.phone || remembered.phone || '';
  const email = userOverride?.email || remembered.email || '';

  // Update cookies with latest values
  if (name || phone || email) {
    saveUserIdentityCookies({ name, phone, email });
  }

  return {
    sessionId: remembered.sessionId,
    userName: name,
    userPhone: phone,
    userEmail: email,
    browser,
    operatingSystem: os,
    deviceType,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney',
    language: navigator.language || 'en-AU',
    referrer: document.referrer || 'Direct Entry',
    userAgent: navigator.userAgent,
    cookiesEnabled: navigator.cookieEnabled,
    timestamp: new Date().toISOString()
  };
}
