'use client';

import { useT } from '@core/i18n/client';
import Header from '@/components/layout/Header';
import { useMobileMenu } from '@/ui/MobileMenuContext';
import Link from 'next/link';
import {
  Building2,
  BedDouble,
  Users,
  Settings as SettingsIcon,
  ChevronRight,
  Globe,
  Bell,
  LinkIcon,
  UserCheck,
  Code2,
  Sparkles,
  Brain,
  Receipt,
  Users2,
} from 'lucide-react';

const settingsItems = [
  {
    title: "Об'єкти (Properties)",
    desc: 'Керування об\'єктами розміщення',
    icon: <Building2 size={22} />,
    href: '/app/settings/properties',
    color: 'blue',
  },
  {
    title: 'Номери / Юніти',
    desc: 'Управління номерами, типами юнітів та будівлями',
    icon: <BedDouble size={22} />,
    href: '/app/settings/units',
    color: 'blue',
  },
  {
    title: 'Користувачі та ролі',
    desc: 'Адміни, менеджери, оператори',
    icon: <Users size={22} />,
    href: '/app/settings/users',
    color: 'purple',
  },
  {
    title: 'Ціни за заселеністю',
    desc: 'Скільки коштує ніч на одного, двох, трьох — і знижки за довше проживання',
    icon: <Users2 size={22} />,
    href: '/app/settings/pricing-matrix',
    color: 'green',
  },
  {
    title: 'Фактурування',
    desc: 'Ставки ПДВ і серії нумерації фактур',
    icon: <Receipt size={22} />,
    href: '/app/settings/invoicing',
    color: 'orange',
  },
  {
    title: 'Джерела бронювань',
    desc: 'Booking.com, Airbnb, Direct та інші канали',
    icon: <LinkIcon size={22} />,
    href: '/app/settings/booking-sources',
    color: 'green',
  },
  {
    title: 'Гостьова сторінка',
    desc: 'Контент для гостей: зручності, FAQ, правила, WiFi',
    icon: <UserCheck size={22} />,
    href: '/app/settings/guest-page',
    color: 'blue',
  },
  {
    title: 'Послуги для гостей',
    desc: 'Сніданки, сауна, велосипеди, чан — ціни та статуси',
    icon: <Sparkles size={22} />,
    href: '/app/settings/services',
    color: 'orange',
  },
  {
    title: 'AI База знань',
    desc: 'Навчання AI-рецепціоніста: знання, правила, відповіді',
    icon: <Brain size={22} />,
    href: '/app/settings/ai-knowledge',
    color: 'purple',
  },
  {
    title: 'Канал-менеджер',
    desc: 'iCal синхронізація з VRBO, Airbnb та іншими OTA',
    icon: <Globe size={22} />,
    href: '/app/settings/channel-manager',
    color: 'blue',
  },
  {
    title: 'Віджет бронювання',
    desc: 'Код для вставки на зовнішні сайти',
    icon: <Code2 size={22} />,
    href: '/app/settings/booking-widget',
    color: 'green',
  },
  {
    title: 'Сповіщення',
    desc: 'Telegram-бот і вибір подій',
    icon: <Bell size={22} />,
    href: '/app/settings/notifications',
    color: 'yellow',
  },
  {
    title: 'Модулі та інтеграції',
    desc: 'Що куплено: Teya, Hostex, PriceLabs, Telegram, віджет',
    icon: <SettingsIcon size={22} />,
    href: '/app/settings/features',
    color: 'orange',
  },
  {
    title: 'Загальні налаштування',
    desc: 'Організація, часова зона, валюта, контакти',
    icon: <SettingsIcon size={22} />,
    href: '/app/settings/general',
    color: 'purple',
  },
];

export default function SettingsPage() {
  const t = useT();
  const onMenuClick = useMobileMenu();
  return (
    <>
      <Header title={t('Налаштування')} onMenuClick={onMenuClick} />
      <div className="app-content">
        <div className="page-header">
          <div>
            <h2 className="page-title">{t('Налаштування системи')}</h2>
            <div className="page-subtitle">{t('Керування об\'єктами, юнітами, користувачами та інтеграціями')}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {settingsItems.map((item) => (
            <Link key={item.href} href={item.href} style={{ textDecoration: 'none' }}>
              <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}>
                <div className={`stat-icon ${item.color}`}>{item.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{t(item.title)}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{t(item.desc)}</div>
                </div>
                <ChevronRight size={18} style={{ color: 'var(--text-tertiary)' }} />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
