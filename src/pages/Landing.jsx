import React from 'react';
import useIsMobile from '../hooks/useIsMobile';
import LandingDesktop from './LandingDesktop';
import LandingMobile from './LandingMobile';

/**
 * CalUp Landing Page Root Component
 * Automatically renders dedicated Desktop or Mobile layouts using synchronous useIsMobile hook.
 */
export default function Landing() {
  const isMobile = useIsMobile();

  return isMobile ? <LandingMobile /> : <LandingDesktop />;
}
