import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientIntakeFormData } from '../../types/index.js';
import {
  clearOfflineBuffer, normalizeFormData, OfflineSnapshot, readOfflineBuffer, writeOfflineBuffer
} from './formState.js';

/**
 * Keeps the form saved in Supabase (through our API) as the client types.
 *
 * - Changes are sent 800 ms after the last keystroke, or straight away for key actions.
 * - Only one save is in flight at a time; newer changes are sent when it finishes.
 * - If the server cannot be reached, the latest answers are kept in localStorage and
 *   sent as soon as the browser is back online.
 */

export type SyncStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'offline';

export interface SyncSnapshot {
  formData: ClientIntakeFormData;
  currentStep: number;
  partyIndex: number;
}

export interface RestoredSession extends SyncSnapshot {
  /** True when the restored data contains answers the client entered before. */
  hasAnswers: boolean;
}

const DEBOUNCE_MS = 800;
const RETRY_MS = 15000;

interface ServerSession {
  id: string;
  currentStep: number;
  partyIndex: number;
  formData: any;
  updatedAt: string;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON error page
  }
  return { ok: res.ok, status: res.status, body };
}

function toSnapshot(session: ServerSession): SyncSnapshot | null {
  const formData = normalizeFormData(session.formData);
  if (!formData) return null;
  return {
    formData,
    currentStep: session.currentStep || 1,
    partyIndex: Math.min(Math.max(session.partyIndex || 0, 0), formData.parties.length - 1)
  };
}

export function useSessionSync(enabled: boolean) {
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const latestRef = useRef<SyncSnapshot | null>(null);
  const unsavedRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const bufferLocally = (snapshot: SyncSnapshot) => {
    writeOfflineBuffer({ ...snapshot, sessionId: sessionIdRef.current, savedAt: new Date().toISOString() });
  };

  /** Gets (or creates) this browser's current draft session on the server. */
  const fetchSession = async (): Promise<ServerSession | null> => {
    const { ok, body } = await fetchJson('/api/session');
    if (!ok || !body?.session?.id) return null;
    sessionIdRef.current = body.session.id;
    return body.session as ServerSession;
  };

  const flush = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const snapshot = latestRef.current;
    if (!snapshot || !unsavedRef.current || !enabledRef.current) return true;

    if (!navigator.onLine) {
      bufferLocally(snapshot);
      setStatus('offline');
      return false;
    }
    if (inFlightRef.current) return false; // the running save picks up the newest data when it ends

    inFlightRef.current = true;
    unsavedRef.current = false;
    setStatus('saving');
    let saved = false;
    try {
      if (!sessionIdRef.current) await fetchSession();
      if (!sessionIdRef.current) throw new Error('No session');

      const put = () => fetchJson(`/api/session/${encodeURIComponent(sessionIdRef.current!)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot, formType: snapshot.formData.role })
      });

      let result = await put();
      if (result.status === 404 || result.status === 409) {
        // The session was submitted or removed elsewhere — continue in a fresh draft
        sessionIdRef.current = null;
        await fetchSession();
        if (sessionIdRef.current) result = await put();
      }
      if (!result.ok) throw new Error(result.body?.message || 'Save failed');

      saved = true;
      setLastSavedAt(result.body?.savedAt || new Date().toISOString());
      if (!unsavedRef.current) clearOfflineBuffer();
    } catch {
      unsavedRef.current = true;
      bufferLocally(snapshot);
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => { void flush(); }, RETRY_MS);
    } finally {
      inFlightRef.current = false;
    }

    if (unsavedRef.current && saved) {
      return flush();
    }
    setStatus(saved ? 'saved' : 'offline');
    return saved;
  }, []);

  /** Records the latest answers; sends them now or after a short pause. */
  const queueSave = useCallback((snapshot: SyncSnapshot, immediate: boolean) => {
    latestRef.current = snapshot;
    unsavedRef.current = true;
    if (!navigator.onLine) {
      bufferLocally(snapshot);
      setStatus('offline');
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    if (immediate) void flush();
    else timerRef.current = setTimeout(() => { void flush(); }, DEBOUNCE_MS);
  }, [flush]);

  // React StrictMode runs mount effects twice in development; share one request so a
  // first-time visitor is not given two visitor IDs.
  const restorePromiseRef = useRef<Promise<RestoredSession | null> | null>(null);

  /** Loads the saved form on first visit, preferring newer unsent answers kept on this device. */
  const restore = useCallback((): Promise<RestoredSession | null> => {
    if (!restorePromiseRef.current) restorePromiseRef.current = loadSaved();
    return restorePromiseRef.current;
  }, []);

  const loadSaved = async (): Promise<RestoredSession | null> => {
    const buffer: OfflineSnapshot | null = readOfflineBuffer();
    let server: ServerSession | null = null;
    try {
      server = await fetchSession();
    } catch {
      server = null;
    }

    const fromServer = server ? toSnapshot(server) : null;
    const bufferIsNewer = buffer && (!server || (buffer.sessionId === server.id && buffer.savedAt > (server.updatedAt || '')));

    let chosen: SyncSnapshot | null = fromServer;
    if (bufferIsNewer && buffer) {
      chosen = { formData: buffer.formData, currentStep: buffer.currentStep, partyIndex: buffer.partyIndex };
      latestRef.current = chosen;
      unsavedRef.current = true;
    } else if (buffer && server && buffer.sessionId !== server.id) {
      clearOfflineBuffer(); // left over from an older, finished form
    }

    setStatus(server ? (unsavedRef.current ? 'saving' : 'idle') : 'offline');
    if (server && unsavedRef.current) void flush();
    if (!chosen) return null;
    return { ...chosen, hasAnswers: chosen.formData.roleConfirmed };
  };

  /** Leaves the current draft and starts an empty one (the old one is kept as abandoned). */
  const startNewSession = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    latestRef.current = null;
    unsavedRef.current = false;
    clearOfflineBuffer();
    setLastSavedAt(null);
    try {
      const { ok, body } = await fetchJson('/api/session/new', { method: 'POST' });
      sessionIdRef.current = ok && body?.session?.id ? body.session.id : null;
      setStatus(ok ? 'idle' : 'offline');
    } catch {
      sessionIdRef.current = null;
      setStatus('offline');
    }
  }, []);

  /** Called after a successful submission: the server has frozen that session. */
  const markSubmitted = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (retryRef.current) clearTimeout(retryRef.current);
    latestRef.current = null;
    unsavedRef.current = false;
    sessionIdRef.current = null;
    clearOfflineBuffer();
  }, []);

  // Send anything waiting as soon as the connection comes back
  useEffect(() => {
    const onOnline = () => { void flush(); };
    const onOffline = () => setStatus('offline');
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [flush]);

  // Last-chance save when the tab is hidden or closed
  useEffect(() => {
    const onHide = () => {
      const snapshot = latestRef.current;
      if (!snapshot || !unsavedRef.current || !enabledRef.current) return;
      bufferLocally(snapshot);
      if (!sessionIdRef.current || !navigator.onLine) return;
      try {
        void fetch(`/api/session/${encodeURIComponent(sessionIdRef.current)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...snapshot, formType: snapshot.formData.role }),
          credentials: 'same-origin',
          keepalive: true
        });
      } catch {
        // the offline buffer above still has the answers
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') onHide(); };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (retryRef.current) clearTimeout(retryRef.current);
  }, []);

  return {
    status,
    lastSavedAt,
    restore,
    queueSave,
    saveNow: flush,
    startNewSession,
    markSubmitted,
    getSessionId: () => sessionIdRef.current
  };
}
