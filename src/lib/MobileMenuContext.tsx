'use client';

import { createContext, useContext } from 'react';

export const MobileMenuContext = createContext<() => void>(() => {});

export function useMobileMenu() {
  return useContext(MobileMenuContext);
}
