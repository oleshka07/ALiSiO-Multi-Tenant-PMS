'use client';

/**
 * «Відкрий пошук» — доступне з будь-якої шапки.
 *
 * Той самий підхід, що й `MobileMenuContext`: діалог живе один раз у
 * розкладці, а кнопки лише просять його відкритись. Тримати діалог у `Header`
 * не можна — `Header` малюється на кожному з 77 екранів, тобто було б 77
 * незалежних станів пошуку і 77 обробників Ctrl+K, які б перебивали один
 * одного.
 */

import { createContext, useContext } from 'react';

export const GlobalSearchContext = createContext<() => void>(() => {});

export function useGlobalSearch() {
  return useContext(GlobalSearchContext);
}
