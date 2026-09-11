/**
 * Передача заселення на ТЕЛЕФОН гостя: термінал малює QR, далі не він.
 *
 * Чисті функції плюс `seal`/`unseal`. Сцени — `kiosk.check.ts`, 26.
 *
 * ── Чому не «камера зчитує QR із листа» ────────────────────────────────
 *
 * Бо камери в холі немає (рішення власника 11.09.2026: 86" дисплей на стіні,
 * не планшет). Тому напрямок зворотний: QR малює ЕКРАН, а сканує гість своїм
 * телефоном — і далі заселяється в себе в браузері, де в нього є і клавіатура
 * рідною мовою, і камера для документа.
 *
 * ── Що лежить у QR і чому саме це ──────────────────────────────────────
 *
 * Рівно три речі: організація, БУДИНОК і строк. Ні гостя, ні броні — на цьому
 * кроці термінал іще не знає, хто підійшов.
 *
 * Будинок обовʼязковий і не «для порядку»: сторінка на телефоні шукає бронь
 * тим самим запитом, що термінал, і без осі будинку термінал у холі корпусу 1
 * відчиняв би пошук по корпусу 2 (INC-029). Той самий інваріант, лише інший
 * пристрій на іншому кінці.
 *
 * Строк — тому що QR у холі фотографують. Без нього знімок екрана,
 * зроблений один раз, лишався б робочим ключем до пошуку цього готелю
 * назавжди; з ним вікно шириною в пів години, і за межами його треба
 * підійти до термінала ще раз.
 *
 * ── Чому `isSealed` перевіряється ОКРЕМО ───────────────────────────────
 *
 * `unseal()` за побудовою пропускає НЕзапечатане наскрізь: рядок без префікса
 * `enc1:` він повертає як є — це навмисна сумісність із рядками, записаними
 * до шифрування. Тут це була б діра завширшки з ворота: хто завгодно надіслав
 * би `{"o":"чужа-організація","p":"чужий-корпус","e":9999999999999}` відкритим
 * текстом, і читач акуратно розібрав би його як дійсний токен.
 *
 * Тому спершу питається `isSealed`, і лише потім `unseal`. Сцена 26 ламає
 * саме це.
 */
import { isSealed, seal, unseal } from '@core/integration-credentials';

/** Скільки живе намальований QR. Пів години: гість іде до крісла й сідає. */
export const HANDOFF_TTL_MINUTES = 30;

interface HandoffPayload {
  /** Організація. */
  o: string;
  /** Будинок — вісь, без якої термінал корпусу 1 відчиняв би корпус 2. */
  p: string;
  /** Строк, мілісекунди епохи. */
  e: number;
}

export interface Handoff {
  organizationId: string;
  propertyId: string;
  expiresAt: number;
}

/**
 * Токен для QR. Адресо-безпечний: `seal` віддає base64 зі знаками `+/=`, які
 * в шляху означають інше, тож усе разом перекодовується в base64url.
 */
export function buildHandoff(input: {
  organizationId: string;
  propertyId: string;
  now?: number;
}): string {
  const payload: HandoffPayload = {
    o: input.organizationId,
    p: input.propertyId,
    e: (input.now ?? Date.now()) + HANDOFF_TTL_MINUTES * 60_000,
  };
  const sealed = seal(JSON.stringify(payload));
  if (!sealed) throw new Error('handoff: seal returned nothing');
  return Buffer.from(sealed, 'utf8').toString('base64url');
}

/**
 * Прочитати токен із адреси. Будь-яка причина недовіри — `null`, і причини
 * між собою НЕ розрізняються назовні: «строк вийшов» і «підроблено» — це та
 * сама відповідь гостю, інакше перша з них стає підказкою для другої.
 */
export function readHandoff(raw: unknown, now: number = Date.now()): Handoff | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let sealed: string;
  try {
    sealed = Buffer.from(raw.trim(), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  // Спершу «чи це взагалі печатка», і лише потім «відкрий»: `unseal` пропускає
  // незапечатане наскрізь (див. шапку).
  if (!isSealed(sealed)) return null;
  const plain = unseal(sealed);
  if (!plain) return null;
  let p: HandoffPayload;
  try {
    p = JSON.parse(plain) as HandoffPayload;
  } catch {
    return null;
  }
  const o = typeof p?.o === 'string' ? p.o.trim() : '';
  const prop = typeof p?.p === 'string' ? p.p.trim() : '';
  const e = typeof p?.e === 'number' && Number.isFinite(p.e) ? p.e : 0;
  if (!o || !prop) return null;
  if (e <= now) return null;
  return { organizationId: o, propertyId: prop, expiresAt: e };
}
