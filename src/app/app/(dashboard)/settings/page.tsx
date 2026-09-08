'use client';

/**
 * Налаштування — групами за Hoteliera (MASTER-PLAN §1.2), не плоским списком.
 *
 * Обʼєкт · Ціни · Продаж · Модулі. Під назвою кожного екрана — один рядок,
 * що він робить. У групі лише те, що ввімкнено: картка вимкненого модуля не
 * показується — той самий ключ `organization_features`, який читають
 * маршрути. Право теж фільтрує: пункт, що закінчиться 403, не пропонується.
 * Групи Commerce і API & WebHooks з Hoteliera — відкладені свідомо (П20) і в
 * меню не показуються взагалі.
 */
import { useT } from '@core/i18n/client';
import { useCurrentUser } from '@/ui/hooks/useCurrentUser';
import { hasPermission, type Permission } from '@core/auth/permissions';
import Link from 'next/link';
import {
  Building2, BedDouble, Users, Settings as SettingsIcon, ChevronRight, Globe, LinkIcon, UserCheck,
  Code2, Sparkles, Receipt, Users2, Coffee, CreditCard, Tag, Palette, Layers, CalendarRange, Baby, Percent, Coins } from 'lucide-react';

interface SettingsLink {
  title: string;
  desc: string;
  icon: React.ReactNode;
  href: string;
  color: string;
  permission?: Permission;
  /** Ключ з core/features.ts: картка вимкненого модуля не показується. */
  feature?: string;
}

const GROUPS: { title: string; desc: string; items: SettingsLink[] }[] = [
  {
    title: 'Обʼєкт',
    desc: 'Хто ви і що здаєте: реквізити, обʼєкти, номерний фонд, персонал',
    items: [
      { title: 'Загальні налаштування', desc: 'Організація, реквізити, часова зона, валюта, контакти', icon: <SettingsIcon size={22} />, href: '/app/settings/general', color: 'purple' },
      { title: "Обʼєкти", desc: 'Адреса, час заїзду та виїзду, туристичний збір кожного обʼєкта', icon: <Building2 size={22} />, href: '/app/settings/properties', color: 'blue' },
      { title: 'Типи номерів і номери', desc: 'Місткість, базова заселеність, номери й їхній стан', icon: <BedDouble size={22} />, href: '/app/settings/units', color: 'blue' },
      { title: 'Валюти', desc: 'У чому ведеться облік і в чому ще показуються суми — з курсом, який фіксує готель', icon: <Coins size={22} />, href: '/app/settings/currencies', color: 'green' },
      { title: 'Зручності', desc: 'Що є в готелі і що є в номерах — один словник на сайт, гостьову сторінку і канали', icon: <Sparkles size={22} />, href: '/app/settings/amenities', color: 'blue' },
      { title: 'Послуги', desc: 'Сніданок, паркінг, трансфер — ціни та доступність', icon: <Sparkles size={22} />, href: '/app/settings/services', color: 'orange' },
      { title: 'Оплати', desc: 'Способи оплати на рецепції та шлюз онлайн-оплати', icon: <CreditCard size={22} />, href: '/app/settings/payments', color: 'green' },
      { title: 'Фактурування', desc: 'Ставки ПДВ, серії нумерації, бланк документа', icon: <Receipt size={22} />, href: '/app/settings/invoicing', color: 'orange', feature: 'invoicing' },
      { title: 'Користувачі та ролі', desc: 'Хто має доступ і що кому дозволено', icon: <Users size={22} />, href: '/app/settings/users', color: 'purple', permission: 'manage_users' },
    ],
  },
  {
    title: 'Ціни',
    desc: 'Що коштує ніч: тарифи, надбавки за заселеність, позначення',
    items: [
      { title: 'Сезони', desc: 'Періоди року з ціною на кожен тип і тариф — розгортаються в календар', icon: <CalendarRange size={22} />, href: '/app/settings/seasons', color: 'green', permission: 'nav:pricing' },
      { title: 'Тарифи', desc: 'BAR, B&B — назва, код, валюта, режим ціни; ціни на дати — у календарі', icon: <Tag size={22} />, href: '/app/settings/rate-plans', color: 'green', permission: 'nav:pricing' },
      { title: 'Правила цін і промо', desc: 'Знижка за тривалість, надбавка на вихідні, раннє бронювання, промокоди — поверх ціни ночі', icon: <Percent size={22} />, href: '/app/settings/price-rules', color: 'green', permission: 'nav:pricing' },
      { title: 'Надбавки за заселеність', desc: 'Дорослий понад базу, дитина за віковою вилкою — проживання і харчування, відсотком або сумою', icon: <Baby size={22} />, href: '/app/settings/extra-occupancy', color: 'green', permission: 'nav:pricing' },
      { title: 'Ціни за заселеністю', desc: 'Скільки коштує ніч на одного, двох, трьох — і знижки за довше проживання', icon: <Users2 size={22} />, href: '/app/settings/pricing-matrix', color: 'green', permission: 'nav:pricing' },
      { title: 'Легенда', desc: 'Що означають кольори й статуси броні, оплати, прибирання', icon: <Palette size={22} />, href: '/app/settings/legend', color: 'blue' },
    ],
  },
  {
    title: 'Продаж',
    desc: 'Звідки приходять броні: канали, форма бронювання, гостьова сторінка',
    items: [
      { title: 'Канал-менеджер', desc: 'Підключення до менеджера каналів, черга відправлень, звірка, iCal', icon: <Globe size={22} />, href: '/app/settings/channel-manager', color: 'blue' },
      { title: 'Ціни каналів', desc: 'З чого складається сума каналу: сніданок, ПДВ, націнка', icon: <Coffee size={22} />, href: '/app/settings/channel-rules', color: 'orange', permission: 'nav:pricing', feature: 'invoicing' },
      { title: 'Джерела бронювань', desc: 'Booking.com, Airbnb, Direct — комісії та турзбір у ціні', icon: <LinkIcon size={22} />, href: '/app/settings/booking-sources', color: 'green' },
      { title: 'Форма бронювання', desc: 'Код для вставки форми на ваш сайт і попередній перегляд', icon: <Code2 size={22} />, href: '/app/settings/booking-widget', color: 'green', feature: 'booking_engine' },
      { title: 'Сайти-вітрини', desc: 'Сторінки бронювання зі своєю адресою, тарифами й послугами', icon: <Layers size={22} />, href: '/app/sites', color: 'green', permission: 'nav:sites', feature: 'sites' },
      { title: 'Гостьова сторінка', desc: 'Самореєстрація, WiFi, правила, послуги для гостя за посиланням', icon: <UserCheck size={22} />, href: '/app/settings/guest-page', color: 'blue', feature: 'guest_page' },
    ],
  },
  {
    title: 'Модулі',
    desc: 'Що ввімкнено у вашому готелі',
    items: [
      { title: 'Модулі та інтеграції', desc: 'Задачі, аналітика, аркуші дня, канали, фіскалізація — і ключі інтеграцій', icon: <SettingsIcon size={22} />, href: '/app/settings/features', color: 'orange' },
    ],
  },
];

export default function SettingsPage() {
  const t = useT();
  const { user, features } = useCurrentUser();
  const visible = GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((item) => {
        if (item.permission && user && !hasPermission(user.permissions, item.permission)) return false;
        if (item.feature && !features[item.feature]) return false;
        return true;
      }),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      <div className="app-content">
        <div className="page-header">
          <div>
            <h2 className="page-title">{t('Налаштування')}</h2>
            <div className="page-subtitle">{t('Обʼєкт, ціни, продаж і модулі — усе, що готель налаштовує сам')}</div>
          </div>
        </div>

        {visible.map((group) => (
          <section key={group.title} style={{ marginBottom: 28 }}>
            <div style={{ marginBottom: 10 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{t(group.title)}</h3>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{t(group.desc)}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
              {group.items.map((item) => (
                <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
                  <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
                    <div className={`stat-icon ${item.color}`}>{item.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t(item.title)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{t(item.desc)}</div>
                    </div>
                    <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
