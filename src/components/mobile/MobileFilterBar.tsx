'use client';

/**
 * MobileFilterBar — horizontal scrollable status tabs + filter chips.
 *
 * On desktop: hidden (parent page uses its own desktop filter UI).
 * On mobile:  a row of scrollable tab-buttons at the top of the list.
 *
 * Usage:
 *   <MobileFilterBar
 *     tabs={[
 *       { key: '', label: 'Всі' },
 *       { key: 'confirmed', label: 'Підтверджено' },
 *     ]}
 *     activeTab={statusFilter}
 *     onTabChange={setStatusFilter}
 *     chips={[
 *       { key: 'time', label: 'Час' },
 *       { key: 'unit', label: 'Юніт' },
 *     ]}
 *     activeChips={activeChips}
 *     onChipToggle={handleChipToggle}
 *   />
 */

interface Tab {
  key: string;
  label: string;
}

interface Chip {
  key: string;
  label: string;
}

interface MobileFilterBarProps {
  tabs?: Tab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  chips?: Chip[];
  activeChips?: string[];
  onChipToggle?: (key: string) => void;
}

export default function MobileFilterBar({
  tabs,
  activeTab = '',
  onTabChange,
  chips,
  activeChips = [],
  onChipToggle,
}: MobileFilterBarProps) {
  return (
    <div className="mobile-only mobile-filter-bar">
      {/* Status tabs — underlined horizontal scroll */}
      {tabs && tabs.length > 0 && (
        <div className="mobile-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`mobile-tab ${activeTab === tab.key ? 'active' : ''}`}
              onClick={() => onTabChange?.(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Filter chips row */}
      {chips && chips.length > 0 && (
        <div className="filter-chips" style={{ marginTop: tabs ? 8 : 0 }}>
          {chips.map((chip) => (
            <button
              key={chip.key}
              className={`filter-chip ${activeChips.includes(chip.key) ? 'active' : ''}`}
              onClick={() => onChipToggle?.(chip.key)}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
