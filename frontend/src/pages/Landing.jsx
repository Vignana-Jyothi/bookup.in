import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import useIsMobile from '../hooks/useIsMobile';
import LandingDesktop from './LandingDesktop';
import LandingMobile from './LandingMobile';

/**
 * CalUp Landing Page Root Component
 * Automatically renders dedicated Desktop or Mobile layouts using synchronous useIsMobile hook.
 */
export default function Landing() {
  const isMobile = useIsMobile();
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [hash, isMobile]);

  return isMobile ? <LandingMobile /> : <LandingDesktop />;
}
