import React, { useMemo, useState } from 'react';
import { BoostCategoryKey } from '../../types/boostSpecs';
import { CategoryBoostSpecsTabs } from './CategoryBoostSpecsTabs';
import { ServiceFormField, WOW_PRESETS } from '../admin/DynamicServiceFormAndTemplateBuilder';

interface ServiceLike {
  id?: number;
  displayName?: string;
  serviceKey?: string;
  formSchemaJson?: string | null;
}

interface DynamicServiceFormRendererProps {
  selectedService?: ServiceLike | null;
  activeCategory: BoostCategoryKey;
  onSelectCategory: (key: BoostCategoryKey, boostModel: string, defaultTitle: string) => void;
  specs: Record<string, any>;
  onUpdateSpecs: (newSpecs: Record<string, any>) => void;
}

export const DynamicServiceFormRenderer: React.FC<DynamicServiceFormRendererProps> = ({
  selectedService,
  activeCategory,
  onSelectCategory,
  specs,
  onUpdateSpecs,
}) => {
  const [preferStandardTabs, setPreferStandardTabs] = useState(false);

  // Parse custom dynamic fields from selected service schema, or auto-match preset
  const dynamicFields = useMemo<ServiceFormField[]>(() => {
    if (selectedService?.formSchemaJson) {
      try {
        const parsed = JSON.parse(selectedService.formSchemaJson);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {
        // fallback to auto-detection
      }
    }

    if (selectedService) {
      const key = (selectedService.serviceKey || '').toLowerCase();
      const name = (selectedService.displayName || '').toLowerCase();

      if (key.includes('mythic') || key.includes('keystone') || name.includes('mythic') || name.includes('keystone')) {
        return WOW_PRESETS.mythic_plus.fields;
      }
      if (key.includes('raid') || name.includes('raid')) {
        return WOW_PRESETS.raid.fields;
      }
      if (key.includes('level') || name.includes('level')) {
        return WOW_PRESETS.leveling.fields;
      }
      if (key.includes('pvp') || key.includes('arena') || name.includes('pvp') || name.includes('arena')) {
        return WOW_PRESETS.pvp.fields;
      }
      if (key.includes('delve') || key.includes('farm') || name.includes('delve') || name.includes('farm')) {
        return WOW_PRESETS.delves.fields;
      }

      // Default fallback based on activeCategory
      if (WOW_PRESETS[activeCategory]) {
        return WOW_PRESETS[activeCategory].fields;
      }
      return key.includes('pilot') ? WOW_PRESETS.leveling.fields : WOW_PRESETS.mythic_plus.fields;
    }

    return WOW_PRESETS[activeCategory]?.fields || [];
  }, [selectedService, activeCategory]);

  const handleFieldChange = (key: string, value: any) => {
    onUpdateSpecs({
      ...specs,
      [key]: value,
    });
  };

  // If service has dynamic custom fields and user hasn't explicitly toggled to standard tabs
  if (dynamicFields.length > 0 && !preferStandardTabs) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <label style={{ fontSize: '0.82rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>⚡</span> Dynamic Service Specifications: <strong style={{ color: 'var(--accent-lime, #a3e635)' }}>{selectedService?.displayName || 'Active Service'}</strong>
            </label>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #64748b)' }}>
              ({dynamicFields.length} dynamic field{dynamicFields.length > 1 ? 's' : ''} active for this service)
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPreferStandardTabs(true)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-lime, #a3e635)',
              fontSize: '0.74rem',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            Switch to Standard Category Presets
          </button>
        </div>

        <div
          style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid rgba(168, 85, 247, 0.25)',
            borderRadius: '10px',
            padding: '14px 16px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '0.95rem',
          }}
        >
          {dynamicFields.map((field) => {
            const val = specs[field.key] !== undefined ? specs[field.key] : '';

            if (field.type === 'checkbox') {
              return (
                <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minHeight: '38px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.82rem', color: 'var(--text-primary, #f1f5f9)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(val)}
                      onChange={(e) => handleFieldChange(field.key, e.target.checked)}
                      style={{ cursor: 'pointer', accentColor: '#a855f7' }}
                    />
                    <span>{field.label}</span>
                    {field.required && <span style={{ color: '#ef4444' }}>*</span>}
                  </label>
                </div>
              );
            }

            if (field.type === 'select') {
              const options = (field.options || '')
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean);

              return (
                <div key={field.key}>
                  <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', marginBottom: '0.25rem', fontWeight: 600 }}>
                    {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
                  </label>
                  <select
                    className="input select"
                    style={{
                      width: '100%',
                      padding: '0.55rem 0.65rem',
                      fontSize: '0.85rem',
                      boxSizing: 'border-box',
                      backgroundColor: 'rgba(13, 11, 18, 0.8)',
                      borderColor: 'rgba(124, 58, 237, 0.3)',
                    }}
                    value={val}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    required={field.required}
                  >
                    <option value="">— Select {field.label} —</option>
                    {options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }

            return (
              <div key={field.key}>
                <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-muted, #94a3b8)', marginBottom: '0.25rem', fontWeight: 600 }}>
                  {field.label} {field.required && <span style={{ color: '#ef4444' }}>*</span>}
                </label>
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  className="input"
                  style={{
                    width: '100%',
                    padding: '0.55rem 0.65rem',
                    fontSize: '0.85rem',
                    boxSizing: 'border-box',
                    backgroundColor: 'rgba(13, 11, 18, 0.8)',
                    borderColor: 'rgba(124, 58, 237, 0.3)',
                  }}
                  placeholder={field.placeholder || `Enter ${field.label}`}
                  value={val}
                  onChange={(e) => handleFieldChange(field.key, field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
                  required={field.required}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Fallback to CategoryBoostSpecsTabs
  return (
    <div>
      {dynamicFields.length > 0 && preferStandardTabs && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.4rem' }}>
          <button
            type="button"
            onClick={() => setPreferStandardTabs(false)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent-lime, #a3e635)',
              fontSize: '0.74rem',
              cursor: 'pointer',
              textDecoration: 'underline',
              padding: 0,
            }}
          >
            ← Back to Dynamic Service Form ({selectedService?.displayName})
          </button>
        </div>
      )}
      <CategoryBoostSpecsTabs
        activeCategory={activeCategory}
        onSelectCategory={onSelectCategory}
        specs={specs}
        onUpdateSpecs={onUpdateSpecs}
      />
    </div>
  );
};
