import { useEffect, useState } from 'react';
import { useStore } from '../data/store';
import { ACTIONS } from '../data/actions';
import { dbService } from '../services/supabase/dbService';

/** One server-owned appointment snapshot shared by every dashboard route. */
export function useLiveAppointments(providerId) {
  const { dispatch } = useStore();
  const [sync, setSync] = useState({ loading: true, error: '', updatedAt: null });
  useEffect(() => {
    if (!providerId) return undefined;
    let active = true;
    let running = false;
    let controller;
    let fingerprint = '';
    const refresh = async () => {
      if (!active || running || document.visibilityState === 'hidden') return;
      running = true;
      controller = new AbortController();
      let timedOut = false;
      const requestController = controller;
      const timeout = setTimeout(() => { timedOut = true; requestController.abort(); }, 15000);
      try {
        const bookings = await dbService.getBookings(providerId, { signal: controller.signal });
        if (!active) return;
        const nextFingerprint = JSON.stringify(bookings);
        if (nextFingerprint !== fingerprint) {
          fingerprint = nextFingerprint;
          dispatch({ type: ACTIONS.SET_BOOKINGS, payload: bookings });
        }
        setSync({ loading: false, error: '', updatedAt: Date.now() });
      } catch (error) {
        if (active && (error.name !== 'AbortError' || timedOut)) setSync(current => ({ ...current, loading: false, error: 'Live updates are unavailable. Showing the last loaded appointments.' }));
      } finally { clearTimeout(timeout); running = false; }
    };
    setSync({ loading: true, error: '', updatedAt: null });
    refresh();
    const timer = setInterval(refresh, 5000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [providerId, dispatch]);
  return sync;
}
