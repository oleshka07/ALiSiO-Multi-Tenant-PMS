'use client';

import { useState, useEffect } from 'react';

interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouchDevice: boolean;
}

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

/**
 * Hook to detect device type based on viewport width and touch capability.
 * SSR-safe: defaults to desktop on server, then hydrates on client.
 */
export function useDevice(): DeviceInfo {
  const [device, setDevice] = useState<DeviceInfo>({
    isMobile: false,
    isTablet: false,
    isDesktop: true,
    isTouchDevice: false,
  });

  useEffect(() => {
    const update = () => {
      const w = window.innerWidth;
      const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isMobile = w < MOBILE_BREAKPOINT;
      const isTablet = w >= MOBILE_BREAKPOINT && w < TABLET_BREAKPOINT;
      const isDesktop = w >= TABLET_BREAKPOINT;

      setDevice({ isMobile, isTablet, isDesktop, isTouchDevice: hasTouch });
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return device;
}

/**
 * Check if user-agent indicates mobile device (for server-side use).
 */
export function isMobileUA(ua: string): boolean {
  return /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}
