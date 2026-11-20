import React, { useMemo, useState } from 'react';
import { BoostCategoryKey } from '../../types/boostSpecs';
import { CategoryBoostSpecsTabs } from './CategoryBoostSpecsTabs';
import { ServiceFormField } from '../admin/DynamicServiceFormAndTemplateBuilder';

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

  // Parse custom dynamic fields from selected service schema if available
  const dynamicFields = useMemo<ServiceFormField[]>(() => {
    if (!selectedService?.formSchemaJson) return [];
    try {
      const parsed = JSON.parse(selectedService.formSchemaJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [selectedService?.formSchemaJson]);

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
            <label style={{ fontSize: '0.8rem', color: 'var(--text-muted, #94a3b8)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span>📋</span> Service Custom Specifications: <strong style={{ color: 'var(--text-primary, #fff)' }}>{selectedService?.displayName}</strong>
            </label>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #64748b)' }}>
              ({dynamicFields.length} custom field{dynamicFields.length > 1 ? 's' : ''} defined for this service)
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
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '0.85rem',
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
                      style={{ cursor: 'pointer' }}
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
                    style={{ width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', boxSizing: 'border-box' }}
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
                  style={{ width: '100%', padding: '0.5rem 0.65rem', fontSize: '0.85rem', boxSizing: 'border-box' }}
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
            ← Back to Custom Service Form ({selectedService?.displayName})
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
