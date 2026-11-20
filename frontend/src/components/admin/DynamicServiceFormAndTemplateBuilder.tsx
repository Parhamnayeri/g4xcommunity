import React, { useState } from 'react';

export interface ServiceFormField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'checkbox';
  options?: string;
  placeholder?: string;
  required?: boolean;
}

export const WOW_PRESETS: Record<string, { label: string; icon: string; fields: ServiceFormField[]; defaultTemplate: string }> = {
  mythic_plus: {
    label: 'Mythic+ Keystone',
    icon: '🗝️',
    fields: [
      { key: 'regionFaction', label: 'Region & Faction', type: 'select', options: 'EU - Alliance, EU - Horde, US - Alliance, US - Horde', required: true },
      { key: 'keystoneLevel', label: 'Keystone Level', type: 'select', options: '+2 to +5, +6 to +9, +10 Weekly, +11 to +14, +15 or higher', required: true },
      { key: 'runsCount', label: 'Number of Runs', type: 'number', placeholder: 'e.g. 1, 4, 8', required: true },
      { key: 'dungeonSelection', label: 'Specific Dungeon', type: 'select', options: 'Any / Random, Specific Dungeon (specify in notes)' },
      { key: 'timerGuarantee', label: 'Timer Guarantee', type: 'select', options: 'Timed Guaranteed (+1 to +3), Completion Only' },
      { key: 'armorStack', label: 'Armor / Loot Stack', type: 'select', options: 'No Loot Traders, 1 Loot Trader (+15%), 2 Loot Traders (+30%), 3 Loot Traders (+50%)' },
    ],
    defaultTemplate: `Hello {booster_mention}! You are assigned to **{order_title}** (Order #{order_id}).
**Boost Model:** {boost_type}
**Security:** {vpn_requirement}
**Specifications:** {specs}
**Notes:** {notes}

Please assemble the dungeon group, verify keystone level, and complete within timer if specified.`,
  },
  leveling: {
    label: 'Leveling & Campaign',
    icon: '⚡',
    fields: [
      { key: 'regionRealm', label: 'Region & Realm', type: 'text', placeholder: 'e.g. EU - Silvermoon', required: true },
      { key: 'levelRangeCurrent', label: 'Current Level', type: 'number', placeholder: 'e.g. 70', required: true },
      { key: 'levelRangeTarget', label: 'Target Level', type: 'number', placeholder: 'e.g. 80', required: true },
      { key: 'classSpec', label: 'Class & Specialization', type: 'text', placeholder: 'e.g. Havoc Demon Hunter', required: true },
      { key: 'campaignUnlock', label: 'Campaign Progression', type: 'select', options: 'Standard Leveling Only, The War Within Main Campaign, Full World Quests + Campaign' },
      { key: 'streamingOption', label: 'Discord Stream', type: 'select', options: 'No Stream, Private Discord Stream Required' },
    ],
    defaultTemplate: `Hello {booster_mention}! Leveling order #{order_id} assigned (**{order_title}**).
**Mode:** {boost_type}
**VPN:** {vpn_requirement}
**Service Specs:** {specs}
**Notes:** {notes}

Ensure strict adherence to customer VPN country and do not spend customer currencies.`,
  },
  raid: {
    label: 'Raid Run',
    icon: '⚔️',
    fields: [
      { key: 'regionFaction', label: 'Region & Faction', type: 'select', options: 'EU - Alliance, EU - Horde, US - Alliance, US - Horde', required: true },
      { key: 'raidName', label: 'Raid Instance', type: 'select', options: 'Nerub-ar Palace, Liberation of Undermine, Current Raid Tier', required: true },
      { key: 'difficulty', label: 'Raid Difficulty', type: 'select', options: 'Normal, Heroic, Mythic', required: true },
      { key: 'runScope', label: 'Run Scope', type: 'select', options: 'Full 8/8 Clear, Last Boss Only (AOTC), Specific Bosses (see notes)' },
      { key: 'lootMode', label: 'Loot Priority', type: 'select', options: 'Group Loot, Armor + Tier Token Priority, VIP Exclusive Full Priority' },
      { key: 'scheduledTime', label: 'Scheduled Raid Slot', type: 'text', placeholder: 'e.g. Tonight 20:00 CET or Flexible' },
    ],
    defaultTemplate: `Attention {booster_mention}! Raid Order #{order_id} (**{order_title}**).
**Service Details:** {specs}
**Mode:** {boost_type} | **VPN:** {vpn_requirement}
**Notes:** {notes}

Please be in voice/discord lobby 15 minutes before scheduled pull.`,
  },
  pvp: {
    label: 'PvP / Arena',
    icon: '🏆',
    fields: [
      { key: 'regionFaction', label: 'Region & Faction', type: 'select', options: 'EU - Alliance, EU - Horde, US - Alliance, US - Horde', required: true },
      { key: 'bracketMode', label: 'PvP Bracket', type: 'select', options: '2v2 Arena, 3v3 Arena, Rated Solo Shuffle, Rated Battlegrounds (RBG), Honor & Conquest Farm', required: true },
      { key: 'ratingCurrent', label: 'Starting Rating', type: 'number', placeholder: 'e.g. 0', required: true },
      { key: 'ratingTarget', label: 'Target Rating', type: 'number', placeholder: 'e.g. 1800, 2100, 2400', required: true },
      { key: 'classSpec', label: 'Class & Spec', type: 'text', placeholder: 'e.g. Subtlety Rogue', required: true },
      { key: 'gearFarmOption', label: 'Gearing Package', type: 'select', options: 'Full Honor Gear, Full Conquest Gear, BiS PvP Weapon Farm, Rating Only' },
    ],
    defaultTemplate: `Hello {booster_mention}! PvP Order #{order_id} (**{order_title}**).
**Specs:** {specs}
**Mode:** {boost_type} | **VPN:** {vpn_requirement}
**Notes:** {notes}

Do not whisper or interact with enemies/friends in-game. Submit victory scorecard proof.`,
  },
  delves: {
    label: 'Delves & Farming',
    icon: '⛏️',
    fields: [
      { key: 'regionClass', label: 'Region & Class', type: 'text', placeholder: 'e.g. EU - Retribution Paladin', required: true },
      { key: 'activityType', label: 'Activity Type', type: 'select', options: 'Tier 8 Delve Farm (Bountiful), Tier 11 Delve Solo Achievement, Radiant Echoes / Timewalking, Renown & Rep Farm, Mount / Transmog Farm', required: true },
      { key: 'targetQuantity', label: 'Target Quantity / Runs', type: 'text', placeholder: 'e.g. 4 Bountiful Delves or Full Rep', required: true },
      { key: 'specificDropName', label: 'Specific Target Item / Goal', type: 'text', placeholder: 'Specific drop or cosmetic name if applicable' },
    ],
    defaultTemplate: `Hello {booster_mention}! Farming Order #{order_id} (**{order_title}**).
**Specs:** {specs}
**Mode:** {boost_type} | **VPN:** {vpn_requirement}
**Notes:** {notes}

Provide screenshots of end-of-run reward chests / completion screens.`,
  },
};

interface Props {
  formSchemaJson: string | null;
  tempChannelTemplate: string | null;
  onChangeFormSchemaJson: (val: string | null) => void;
  onChangeTempChannelTemplate: (val: string | null) => void;
}

export const DynamicServiceFormAndTemplateBuilder: React.FC<Props> = ({
  formSchemaJson,
  tempChannelTemplate,
  onChangeFormSchemaJson,
  onChangeTempChannelTemplate,
}) => {
  const [fields, setFields] = useState<ServiceFormField[]>(() => {
    if (!formSchemaJson) return [];
    try {
      const parsed = JSON.parse(formSchemaJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  const [newField, setNewField] = useState<Partial<ServiceFormField>>({
    key: '',
    label: '',
    type: 'text',
    options: '',
    placeholder: '',
    required: false,
  });

  const [activeTab, setActiveTab] = useState<'form' | 'discord'>('form');

  // Sync back to parent when fields change
  const updateFields = (next: ServiceFormField[]) => {
    setFields(next);
    onChangeFormSchemaJson(next.length > 0 ? JSON.stringify(next) : null);
  };

  const handleAddField = () => {
    if (!newField.label?.trim()) return;
    const key = (newField.key?.trim() || newField.label.toLowerCase().replace(/[^a-z0-9]/g, '')) || `field_${Date.now()}`;
    const field: ServiceFormField = {
      key,
      label: newField.label.trim(),
      type: (newField.type || 'text') as any,
      options: newField.type === 'select' ? newField.options?.trim() : undefined,
      placeholder: newField.placeholder?.trim() || undefined,
      required: Boolean(newField.required),
    };

    updateFields([...fields, field]);
    setNewField({
      key: '',
      label: '',
      type: 'text',
      options: '',
      placeholder: '',
      required: false,
    });
  };

  const handleRemoveField = (index: number) => {
    const next = [...fields];
    next.splice(index, 1);
    updateFields(next);
  };

  const handleMoveField = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === fields.length - 1) return;
    const target = direction === 'up' ? index - 1 : index + 1;
    const next = [...fields];
    const temp = next[index];
    next[index] = next[target];
    next[target] = temp;
    updateFields(next);
  };

  const handleApplyPreset = (presetKey: string) => {
    const preset = WOW_PRESETS[presetKey];
    if (!preset) return;
    if (fields.length > 0) {
      if (!window.confirm(`Load preset "${preset.label}"? This will replace your current custom form fields.`)) {
        return;
      }
    }
    updateFields(preset.fields);
    if (!tempChannelTemplate || tempChannelTemplate.trim().length === 0) {
      onChangeTempChannelTemplate(preset.defaultTemplate);
    }
  };

  const handleInsertChip = (chip: string) => {
    const current = tempChannelTemplate || '';
    onChangeTempChannelTemplate(current + (current.endsWith(' ') || current === '' ? '' : ' ') + chip);
  };

  return (
    <div style={{
      gridColumn: '1 / -1',
      marginTop: '1rem',
      padding: '1.25rem',
      borderRadius: 'var(--radius-md)',
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid var(--border-subtle)'
    }}>
      {/* Sub-tab navigation */}
      <div style={{ display: 'flex', gap: '0.75rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
        <button
          type="button"
          onClick={() => setActiveTab('form')}
          style={{
            background: activeTab === 'form' ? 'var(--primary-color, #4f46e5)' : 'transparent',
            color: activeTab === 'form' ? '#fff' : 'var(--text-muted)',
            border: 'none',
            padding: '0.45rem 1rem',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}
        >
          <span>📋</span> Dynamic Order Form Builder ({fields.length} fields)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('discord')}
          style={{
            background: activeTab === 'discord' ? 'var(--primary-color, #4f46e5)' : 'transparent',
            color: activeTab === 'discord' ? '#fff' : 'var(--text-muted)',
            border: 'none',
            padding: '0.45rem 1rem',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem'
          }}
        >
          <span>💬</span> Temp Channel Message Template
        </button>
      </div>

      {activeTab === 'form' && (
        <div>
          {/* Preset buttons */}
          <div style={{ marginBottom: '1.25rem' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.4rem', fontWeight: 600 }}>
              ⚡ QUICK LOAD PRESETS:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {Object.entries(WOW_PRESETS).map(([k, p]) => (
                <button
                  key={k}
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => handleApplyPreset(k)}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <span>{p.icon}</span> {p.label}
                </button>
              ))}
              {fields.length > 0 && (
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  style={{ color: 'var(--status-danger)' }}
                  onClick={() => {
                    if (window.confirm('Clear all custom fields for this service?')) {
                      updateFields([]);
                    }
                  }}
                >
                  🗑️ Clear All
                </button>
              )}
            </div>
          </div>

          {/* Existing field list */}
          <div style={{ marginBottom: '1.25rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.5rem' }}>
              Configured Service Fields:
            </span>
            {fields.length === 0 ? (
              <div style={{ padding: '1rem', border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-sm)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                No custom fields defined for this service. Click a preset above or add fields below.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {fields.map((f, idx) => (
                  <div
                    key={`${f.key}_${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.55rem 0.85rem',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.84rem'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <span style={{ color: 'var(--text-muted)', fontWeight: 600, minWidth: '20px' }}>#{idx + 1}</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{f.label}</span>
                      <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)', fontSize: '0.75rem' }}>({f.key})</span>
                      <span className="badge badge-purple" style={{ textTransform: 'uppercase', fontSize: '0.68rem' }}>{f.type}</span>
                      {f.required && <span className="badge badge-danger" style={{ fontSize: '0.68rem' }}>Required</span>}
                      {f.options && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }} title={f.options}>
                          Options: {f.options.slice(0, 35)}{f.options.length > 35 ? '...' : ''}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        disabled={idx === 0}
                        onClick={() => handleMoveField(idx, 'up')}
                        title="Move Up"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        disabled={idx === fields.length - 1}
                        onClick={() => handleMoveField(idx, 'down')}
                        title="Move Down"
                      >
                        ▼
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-xs"
                        onClick={() => handleRemoveField(idx)}
                        title="Remove Field"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add field builder row */}
          <div style={{
            padding: '1rem',
            background: 'rgba(255, 255, 255, 0.03)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)'
          }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.75rem' }}>
              + Add Custom Form Field
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0.75rem', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Field Label *</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}
                  placeholder="e.g. Keystone Level"
                  value={newField.label || ''}
                  onChange={(e) => {
                    const label = e.target.value;
                    const autoKey = label.toLowerCase().replace(/[^a-z0-9]/g, '');
                    setNewField({ ...newField, label, key: newField.key ? newField.key : autoKey });
                  }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Identifier Key (slug)</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.82rem', fontFamily: 'monospace' }}
                  placeholder="e.g. keystoneLevel"
                  value={newField.key || ''}
                  onChange={(e) => setNewField({ ...newField, key: e.target.value })}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Field Type</label>
                <select
                  className="select"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}
                  value={newField.type || 'text'}
                  onChange={(e) => setNewField({ ...newField, type: e.target.value as any })}
                >
                  <option value="text">Text Input</option>
                  <option value="number">Numeric</option>
                  <option value="select">Dropdown Select</option>
                  <option value="checkbox">Checkbox (Yes/No)</option>
                </select>
              </div>
              {newField.type === 'select' && (
                <div style={{ gridColumn: 'span 2' }}>
                  <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                    Select Choices (comma-separated) *
                  </label>
                  <input
                    type="text"
                    className="input"
                    style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}
                    placeholder="e.g. EU - Alliance, EU - Horde, US - Alliance, US - Horde"
                    value={newField.options || ''}
                    onChange={(e) => setNewField({ ...newField, options: e.target.value })}
                  />
                </div>
              )}
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Placeholder / Helper</label>
                <input
                  type="text"
                  className="input"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.82rem' }}
                  placeholder="Optional hint text"
                  value={newField.placeholder || ''}
                  onChange={(e) => setNewField({ ...newField, placeholder: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.4rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.8rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(newField.required)}
                    onChange={(e) => setNewField({ ...newField, required: e.target.checked })}
                  />
                  Required Field
                </label>
              </div>
              <div>
                <button
                  type="button"
                  className="btn btn-cta btn-sm"
                  style={{ width: '100%' }}
                  disabled={!newField.label?.trim()}
                  onClick={handleAddField}
                >
                  + Add Field
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'discord' && (
        <div>
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: '0.25rem' }}>
              Service Welcome & Coordination Instructions
            </span>
            <p style={{ fontSize: '0.76rem', color: 'var(--text-muted)', margin: 0 }}>
              This custom template is posted into the private temporary Discord channel when boosters are assigned. Fixed global community rules are prepended automatically.
            </p>
          </div>

          {/* Dynamic Chip Pills */}
          <div style={{ marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'block', marginBottom: '0.35rem', fontWeight: 600 }}>
              CLICK CHIP TO INSERT VARIABLE:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {[
                { chip: '{order_id}', desc: 'Order ID' },
                { chip: '{order_title}', desc: 'Title' },
                { chip: '{booster_mention}', desc: '@Booster' },
                { chip: '{boost_type}', desc: 'Model' },
                { chip: '{vpn_requirement}', desc: 'VPN' },
                { chip: '{specs}', desc: 'Form Specs' },
                { chip: '{notes}', desc: 'Notes' },
              ].map(({ chip, desc }) => (
                <button
                  key={chip}
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={() => handleInsertChip(chip)}
                  style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                  title={desc}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          <textarea
            className="input"
            rows={6}
            style={{
              width: '100%',
              padding: '0.65rem',
              fontSize: '0.85rem',
              fontFamily: 'monospace',
              lineHeight: 1.45,
              borderRadius: 'var(--radius-sm)',
              boxSizing: 'border-box'
            }}
            placeholder={`Hello {booster_mention}!\nYou are assigned to {order_title} (Order #{order_id}).\nSpecifications: {specs}\nNotes: {notes}`}
            value={tempChannelTemplate || ''}
            onChange={(e) => onChangeTempChannelTemplate(e.target.value)}
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              onClick={() => {
                onChangeTempChannelTemplate(
                  `Hello {booster_mention}! You are assigned to **{order_title}** (Order #{order_id}).\n**Boost Mode:** {boost_type}\n**VPN Requirement:** {vpn_requirement}\n**Specifications:** {specs}\n**Notes:** {notes}\n\nPlease review requirements and coordinate start timing here.`
                );
              }}
            >
              ↺ Reset to Standard Template
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
