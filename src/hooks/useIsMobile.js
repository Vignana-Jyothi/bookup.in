import { useState, useEffect } from 'react';

/**
 * useIsMobile — Synchronous on first render to prevent layout flashing.
 * Evaluates window.matchMedia('(max-width: 768px)').
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 768px)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 768px)');
    
    // Set current value in case hydration or window size adjusted
    setIsMobile(mql.matches);

    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isMobile;
}

export default useIsMobile;
