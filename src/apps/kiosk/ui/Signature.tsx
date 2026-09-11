'use client';

/**
 * Підпис пальцем під Meldeschein.
 *
 * ── Чому canvas, а не картинка з телефона ──────────────────────────────
 *
 * Meldeschein підписує заявник ТУТ і зараз — це те, заради чого він існує.
 * Відправити гостя підписувати на телефон означало б, що підписав хтось, кого
 * біля стійки може й не бути.
 *
 * ── Три речі, які тут легко зробити неправильно ────────────────────────
 *
 * 1. **`touch-action: none`** (у css) — без нього палець по полотну гортає
 *    сторінку, і замість підпису виходить смуга з одної крапки.
 * 2. **Координати від `getBoundingClientRect`, не від `offsetX`.** Полотно
 *    розтягнуте в `vh`, тобто його CSS-розмір не дорівнює піксельному, і
 *    `offsetX` малює зі зсувом, який росте до краю.
 * 3. **Порожній підпис не надсилається.** `toDataURL` на чистому полотні дає
 *    цілком дійсний PNG — тобто «підписано» без жодного руху пальцем, і
 *    сервер прийняв би його як підпис.
 */

import { useCallback, useRef, useState } from 'react';

export function Signature({
  onDone,
  doneLabel,
  clearLabel,
  hint,
}: {
  onDone: (pngDataUrl: string) => void;
  doneLabel: string;
  clearLabel: string;
  hint: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const [touched, setTouched] = useState(false);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const box = c.getBoundingClientRect();
    return {
      x: (e.clientX - box.left) * (c.width / box.width),
      y: (e.clientY - box.top) * (c.height / box.height),
    };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current;
    if (!c) return;
    c.setPointerCapture(e.pointerId);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2c2724';
    const p = at(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    drawing.current = true;
    setTouched(true);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const p = at(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const end = () => { drawing.current = false; };

  const clear = useCallback(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    setTouched(false);
  }, []);

  return (
    <>
      <p className="kiosk-note">{hint}</p>
      <canvas
        ref={ref}
        width={1000}
        height={320}
        className="kiosk-signature"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="kiosk-row">
        <button type="button" className="kiosk-slim" onClick={clear}>{clearLabel}</button>
        <button
          type="button"
          className="kiosk-big"
          data-primary="true"
          // Чисте полотно теж дає дійсний PNG — тобто «підписано» без жодного
          // руху пальцем. Кнопка мовчить, доки полотна не торкнулись.
          disabled={!touched}
          onClick={() => {
            const c = ref.current;
            if (c && touched) onDone(c.toDataURL('image/png'));
          }}
        >
          {doneLabel}
        </button>
      </div>
    </>
  );
}
