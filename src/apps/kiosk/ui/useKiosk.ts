'use client';

/**
 * Два гачки, без яких екран у холі стає діркою: памʼять про пристрій і
 * забуття про гостя.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const TOKEN_KEY = 'alisio.kiosk.token';

/**
 * Токен пристрою — у `localStorage`, і КОЖЕН доступ у try/catch.
 *
 * Не обережність: `localStorage` кидає, а не повертає null, у приватному
 * вікні, при вимкнених даних сайту і в момент знімка сторінки. Термінал, який
 * упав на читанні токена, показує гостю білий екран — і полагодити його нема
 * кому, бо в холі немає людини з клавіатурою.
 */
export function useDeviceToken(): {
  token: string | null;
  setToken: (value: string | null) => void;
  ready: boolean;
} {
  const [token, setValue] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setValue(window.localStorage.getItem(TOKEN_KEY));
    } catch {
      // Сховище недоступне — термінал працює як неспарований і просить код.
      setValue(null);
    }
    setReady(true);
  }, []);

  const setToken = useCallback((value: string | null) => {
    setValue(value);
    try {
      if (value) window.localStorage.setItem(TOKEN_KEY, value);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Не збереглося — термінал працює до перезавантаження сторінки.
      // Гірше, ніж мовчазна втрата, було б падіння посеред парування.
    }
  }, []);

  return { token, setToken, ready };
}

/**
 * Забути гостя через 60 секунд бездіяльності, попередивши на 45-й.
 *
 * Це не зручність, це вимога §3.2: гість відійшов від екрана, лишивши на
 * ньому своє прізвище, номер кімнати й код скриньки, — і наступний, хто
 * підійде, все це прочитає. Тому таймер рахує від ОСТАННЬОГО дотику, а не
 * від початку сценарію.
 *
 * `onWarn` на 45-й секунді дає гостю шанс сказати «я тут»; `onReset` на 60-й
 * чистить стан. Обидва — колбеки: що саме чистити, знає екран, а не таймер.
 */
export function useIdleReset(opts: {
  warnAfterMs?: number;
  resetAfterMs?: number;
  onWarn: () => void;
  onReset: () => void;
  /** Вимкнути на екранах, де гостя ще немає (стартовий). */
  active: boolean;
}): { touch: () => void } {
  const { warnAfterMs = 45_000, resetAfterMs = 60_000, onWarn, onReset, active } = opts;
  // Колбеки — через ref: інакше кожен їхній новий примірник перезапускав би
  // таймер, і той ніколи не дійшов би до кінця.
  const warn = useRef(onWarn);
  const reset = useRef(onReset);
  warn.current = onWarn;
  reset.current = onReset;

  const [tick, setTick] = useState(0);
  const touch = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!active) return;
    const a = window.setTimeout(() => warn.current(), warnAfterMs);
    const b = window.setTimeout(() => reset.current(), resetAfterMs);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, [tick, active, warnAfterMs, resetAfterMs]);

  return { touch };
}

/**
 * Робоча смуга: кнопки живуть між `top` і `bottom` відсотками висоти ЕКРАНА.
 *
 * Екран заввишки з людину, поставлений вертикально: верх на рівні очей, низ
 * біля колін. Кнопка у верхніх 20 % — це кнопка, до якої гість не дотягнеться
 * не нахилившись, а в нижніх 10 % — та, яку натискають випадково ногою.
 * Дефолт 35–85 % приходить із сесії пристрою (`config_json.touch_band`), тож
 * готель із іншим дисплеєм міняє число, а не код.
 *
 * ── Чому `position: absolute`, а не `marginTop` ─────────────────────────
 *
 * Перша редакція давала `marginTop: 35vh` елементу, який стоїть ПІСЛЯ шапки
 * в колонці flex. Відлік ішов від низу ШАПКИ, а не від верху екрана, і смуга
 * зʼїжджала рівно на її висоту: виміряно на 1080×1920 — смуга стала на
 * 55,3 % замість 35 %, а перша кнопка почалася на y = 971, тобто ВИЩЕ
 * власної смуги, і її верх обрізало. На екрані пошуку поле «Nachname» не
 * було видно взагалі.
 *
 * Шапка різна на різних кроках (на старті два рядки, далі один), тож
 * віднімати її висоту означало б смугу, яка стрибає між кроками. Відлік від
 * екрана не залежить ні від чого над ним — а саме це й обіцяє §3.2, коли
 * каже «35–85 % ВИСОТИ».
 */
export function bandStyle(band: { top: number; bottom: number } | null): React.CSSProperties {
  if (!band) return {};
  const top = band.top;
  const height = Math.max(10, band.bottom - band.top);
  return {
    position: 'absolute',
    left: 0,
    right: 0,
    top: `${top}vh`,
    height: `${height}vh`,
  };
}
