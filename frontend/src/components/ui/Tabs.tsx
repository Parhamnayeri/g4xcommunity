import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  count?: number | string | null;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  accent?: 'lime' | 'purple';
  className?: string;
  ariaLabel?: string;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  accent = 'lime',
  className = '',
  ariaLabel = 'Navigation Tabs',
}) => {
  return (
    <nav className={`portal-tabs-container ${className}`.trim()} aria-label={ariaLabel}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const activeClass = isActive
          ? (accent === 'purple' ? 'tab-active-purple' : 'tab-active')
          : '';

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={tab.disabled}
            className={`portal-tab-btn ${activeClass}`.trim()}
            onClick={() => onChange(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count !== null && (
              <span className="portal-tab-badge">{tab.count}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
