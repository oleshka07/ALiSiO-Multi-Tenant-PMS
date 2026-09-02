/**
 * Звірка Ц8: створене — ще не продане.
 *
 *   node src/modules/channels/domain/reconcile.check.ts
 *
 * Наш тариф на тому боці створено, але який OTA його побачить, вирішують
 * мапінг-айтеми ВСЕРЕДИНІ менеджера каналів — їх робить готельєр у
 * вбудованому вікні, і ми їх не пишемо (§4.3). Якщо він цього не зробить,
 * помилки не буде ні з чийого боку: у них усе правильно, у нас усе створено,
 * а тариф просто ніде не продається. Тому фініш майстра — це число, а не
 * слово «готово».
 *
 * Два роди зауважень, і вони лікуються по-різному: незмаплений тариф —
 * відкрити вікно й змапити; змаплений лише на ВИМКНЕНИЙ канал — увімкнути
 * канал. Змішати їх означало б послати людину не туди.
 */

/** Пара «наш тариф × наш тип» і її тариф на тому боці — з дзеркала. */
export interface MirrorPair {
  ratePlanId: string;
  unitTypeId: string;
  remoteId: string;
}

/** Канал обʼєкта на тому боці — доменними словами, без чужих полів. */
export interface RemoteChannel {
  id: string;
  title: string;
  isActive: boolean;
  /** Їхні тарифи, змаплені на цей канал. */
  remoteRatePlanIds: string[];
}

export interface CatalogReconciliation {
  /** Скільки пар заведено на тому боці. */
  total: number;
  /** Каналів у обʼєкта — нуль означає, що вікно ще не відкривали. */
  channels: number;
  /** Пари, яких немає на жодному каналі. */
  unmapped: MirrorPair[];
  /** Пари лише на вимкнених каналах — продаються так само нікуди. */
  onlyInactive: MirrorPair[];
  /** Хоч одна пара на увімкненому каналі. */
  sellable: boolean;
}

export function reconcileMappings(pairs: MirrorPair[], channels: RemoteChannel[]): CatalogReconciliation {
  const anywhere = new Set(channels.flatMap((c) => c.remoteRatePlanIds));
  const active = new Set(channels.filter((c) => c.isActive).flatMap((c) => c.remoteRatePlanIds));
  const unmapped = pairs.filter((p) => !anywhere.has(p.remoteId));
  const onlyInactive = pairs.filter((p) => anywhere.has(p.remoteId) && !active.has(p.remoteId));
  return {
    total: pairs.length,
    channels: channels.length,
    unmapped,
    onlyInactive,
    sellable: pairs.some((p) => active.has(p.remoteId)),
  };
}
