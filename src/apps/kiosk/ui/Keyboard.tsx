'use client';

/**
 * Своя екранна клавіатура — бо системної на цьому екрані немає.
 *
 * Термінал — 86-дюймовий дисплей у холі під Chrome у kiosk-режимі на Windows.
 * Системна екранна клавіатура там або не зʼявляється зовсім, або зʼявляється
 * поверх усього і не ховається — і гість лишається перед полем, у яке нічим
 * друкувати. Тому клавіатура своя, у потоці сторінки, і зникає разом із
 * полем.
 *
 * ── Дві розкладки, і чому саме дві ──────────────────────────────────────
 *
 *   `text`    — QWERTZ з умлаутами (ÄÖÜß): гість пише СВОЄ прізвище, і
 *               Müller без «ü» — це інше прізвище, якого пошук не знайде;
 *   `digits`  — цифри: номер підтвердження і дата. Окрема розкладка, а не
 *               цифровий ряд згори: пальцем на такому екрані промазують, і
 *               велика цифра — це менше промахів, а не косметика.
 *
 * Англійська й німецька ділять ОДНУ розкладку: QWERTZ з умлаутами приймає
 * англійські імена без утрат, а друга розкладка означала б, що гість, який
 * перемкнув мову екрана, раптом не знаходить «Z» там, де щойно його бачив.
 */

import { useState } from 'react';

export type KeyboardMode = 'text' | 'digits';

const ROWS_TEXT = [
  ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü'],
  ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'],
  ['Y', 'X', 'C', 'V', 'B', 'N', 'M', 'ß', '-', "'"],
];
const ROWS_DIGITS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '-'],
];

export function Keyboard({
  mode,
  onKey,
  onBackspace,
  onDone,
  doneLabel,
}: {
  mode: KeyboardMode;
  onKey: (ch: string) => void;
  onBackspace: () => void;
  onDone: () => void;
  doneLabel: string;
}) {
  // Верхній/нижній регістр — стан самої клавіатури: гість друкує прізвище, і
  // «MÜLLER» капслоком виглядає як крик, а пошук однаково нечутливий до
  // регістру (`LOWER(...) = LOWER(?)`).
  const [upper, setUpper] = useState(true);
  const rows = mode === 'digits' ? ROWS_DIGITS : ROWS_TEXT;

  return (
    <div className="kiosk-keyboard" data-mode={mode}>
      {rows.map((row, i) => (
        <div className="kiosk-keyboard-row" key={i}>
          {row.map((ch) => (
            <button
              type="button"
              key={ch}
              className="kiosk-key"
              onClick={() => onKey(upper ? ch : ch.toLowerCase())}
            >
              {upper ? ch : ch.toLowerCase()}
            </button>
          ))}
        </div>
      ))}
      <div className="kiosk-keyboard-row">
        {mode === 'text' && (
          <button type="button" className="kiosk-key kiosk-key-wide" onClick={() => setUpper((v) => !v)}>
            ⇧
          </button>
        )}
        {mode === 'text' && (
          <button type="button" className="kiosk-key kiosk-key-space" onClick={() => onKey(' ')}>
            ␣
          </button>
        )}
        <button type="button" className="kiosk-key kiosk-key-wide" onClick={onBackspace}>
          ⌫
        </button>
        <button type="button" className="kiosk-key kiosk-key-done" onClick={onDone}>
          {doneLabel}
        </button>
      </div>
    </div>
  );
}
