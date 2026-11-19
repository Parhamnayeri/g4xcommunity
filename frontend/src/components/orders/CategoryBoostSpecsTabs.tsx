import React from 'react';
import {
  BoostCategoryKey,
  BOOST_CATEGORY_TABS,
  MythicPlusSpecs,
  LevelingSpecs,
  RaidSpecs,
  PvPSpecs,
  DelvesSpecs,
  CustomSpecs,
} from '../../types/boostSpecs';

interface CategoryBoostSpecsTabsProps {
  activeCategory: BoostCategoryKey;
  onSelectCategory: (key: BoostCategoryKey, boostModel: string, defaultTitle: string) => void;
  specs: Record<string, any>;
  onUpdateSpecs: (newSpecs: Record<string, any>) => void;
}

export const CategoryBoostSpecsTabs: React.FC<CategoryBoostSpecsTabsProps> = ({
  activeCategory,
  onSelectCategory,
  specs,
  onUpdateSpecs,
}) => {
  const handleFieldChange = (field: string, value: any) => {
    onUpdateSpecs({
      ...specs,
      [field]: value,
    });
  };

  const mythicSpecs = specs as MythicPlusSpecs;
  const levelingSpecs = specs as LevelingSpecs;
  const raidSpecs = specs as RaidSpecs;
  const pvpSpecs = specs as PvPSpecs;
  const delvesSpecs = specs as DelvesSpecs;
  const customSpecs = specs as CustomSpecs;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      {/* Category Selection Tabs / Pills */}
      <div>
        <label style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '0.35rem' }}>
          Boost Category Specification (Select Boost Type)
        </label>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '6px',
            background: 'rgba(0, 0, 0, 0.4)',
            padding: '6px',
            borderRadius: '10px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {BOOST_CATEGORY_TABS.map((tab) => {
            const isActive = activeCategory === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onSelectCategory(tab.key, tab.boostModel, tab.defaultTitle)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  padding: '7px 10px',
                  borderRadius: '7px',
                  fontSize: '0.78rem',
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                  border: isActive ? '1px solid rgba(250, 204, 21, 0.6)' : '1px solid transparent',
                  background: isActive ? 'rgba(250, 204, 21, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                  color: isActive ? '#facc15' : '#94a3b8',
                  transition: 'all 0.15s ease',
                  textAlign: 'center',
                }}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Category Specific Fields Card */}
      <div
        style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          borderRadius: '10px',
          padding: '12px 14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.06)', paddingBottom: '6px' }}>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#facc15', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>📋</span> Category Specifications: {BOOST_CATEGORY_TABS.find((t) => t.key === activeCategory)?.label}
          </span>
          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
            {BOOST_CATEGORY_TABS.find((t) => t.key === activeCategory)?.description}
          </span>
        </div>

        {/* TAB 1: Mythic+ Keystone */}
        {activeCategory === 'mythic_plus' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem' }}>
            <label style={{ fontSize: '0.78rem' }}>
              Region &amp; Faction
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={mythicSpecs.regionFaction || 'EU - Cross-Faction'}
                onChange={(e) => handleFieldChange('regionFaction', e.target.value)}
              >
                <option value="EU - Cross-Faction">EU - Cross-Faction</option>
                <option value="US - Cross-Faction">US - Cross-Faction</option>
                <option value="EU - Alliance">EU - Alliance</option>
                <option value="EU - Horde">EU - Horde</option>
                <option value="US - Alliance">US - Alliance</option>
                <option value="US - Horde">US - Horde</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Keystone Level
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. +10, +12, 10-20"
                value={mythicSpecs.keystoneLevel || ''}
                onChange={(e) => handleFieldChange('keystoneLevel', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Number of Runs
              <input
                type="number"
                min="1"
                max="50"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={mythicSpecs.runsCount || 1}
                onChange={(e) => handleFieldChange('runsCount', parseInt(e.target.value, 10) || 1)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Dungeon Selection
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="Any / Random, Ara-Kara, Dawnbreaker..."
                value={mythicSpecs.dungeonSelection || ''}
                onChange={(e) => handleFieldChange('dungeonSelection', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Timer Guarantee
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={mythicSpecs.timerGuarantee || 'Timed (In-Time)'}
                onChange={(e) => handleFieldChange('timerGuarantee', e.target.value)}
              >
                <option value="Timed (In-Time)">Timed (In-Time Guarantee)</option>
                <option value="Completion Only">Completion Only (No Timer Guarantee)</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Armor Stack / Loot Traders
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={mythicSpecs.armorStack || 'No Loot Traders'}
                onChange={(e) => handleFieldChange('armorStack', e.target.value)}
              >
                <option value="No Loot Traders">No Loot Traders</option>
                <option value="1 Trader (Same Armor)">1 Trader (Same Armor)</option>
                <option value="2 Traders (Same Armor)">2 Traders (Same Armor)</option>
                <option value="Full Armor Stack (3-4 Traders)">Full Armor Stack (3-4 Traders)</option>
              </select>
            </label>
          </div>
        )}

        {/* TAB 2: Leveling & Campaign */}
        {activeCategory === 'leveling_campaign' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem' }}>
            <label style={{ fontSize: '0.78rem' }}>
              Region &amp; Realm
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. EU - Tarren Mill / US - Area 52"
                value={levelingSpecs.regionRealm || ''}
                onChange={(e) => handleFieldChange('regionRealm', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Current Level
              <input
                type="number"
                min="1"
                max="80"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. 70"
                value={levelingSpecs.levelRangeCurrent || ''}
                onChange={(e) => handleFieldChange('levelRangeCurrent', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Target Level
              <input
                type="number"
                min="1"
                max="80"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. 80"
                value={levelingSpecs.levelRangeTarget || ''}
                onChange={(e) => handleFieldChange('levelRangeTarget', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Character Class &amp; Spec
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. Paladin - Retribution / Any"
                value={levelingSpecs.classSpec || ''}
                onChange={(e) => handleFieldChange('classSpec', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Campaign / Questline Unlock
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={levelingSpecs.campaignUnlock || 'Leveling Only'}
                onChange={(e) => handleFieldChange('campaignUnlock', e.target.value)}
              >
                <option value="Leveling Only">Leveling Only</option>
                <option value="Main Campaign Included">Main Campaign Included</option>
                <option value="World Quests & Renown Unlock">World Quests &amp; Renown Unlock</option>
                <option value="Full Campaign + Endgame Ready">Full Campaign + Endgame Ready</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Streaming Option
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={levelingSpecs.streamingOption || 'No Stream'}
                onChange={(e) => handleFieldChange('streamingOption', e.target.value)}
              >
                <option value="No Stream">No Stream Required</option>
                <option value="Private Discord Stream Required">Private Discord Stream Required</option>
              </select>
            </label>
          </div>
        )}

        {/* TAB 3: Raid Run */}
        {activeCategory === 'raid_run' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem' }}>
            <label style={{ fontSize: '0.78rem' }}>
              Region &amp; Faction
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={raidSpecs.regionFaction || 'EU - Cross-Faction'}
                onChange={(e) => handleFieldChange('regionFaction', e.target.value)}
              >
                <option value="EU - Cross-Faction">EU - Cross-Faction</option>
                <option value="US - Cross-Faction">US - Cross-Faction</option>
                <option value="EU - Alliance">EU - Alliance</option>
                <option value="EU - Horde">EU - Horde</option>
                <option value="US - Alliance">US - Alliance</option>
                <option value="US - Horde">US - Horde</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Raid Name
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. Nerub-ar Palace, Undermine"
                value={raidSpecs.raidName || ''}
                onChange={(e) => handleFieldChange('raidName', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Difficulty
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={raidSpecs.difficulty || 'Heroic'}
                onChange={(e) => handleFieldChange('difficulty', e.target.value)}
              >
                <option value="Normal">Normal</option>
                <option value="Heroic">Heroic</option>
                <option value="Mythic">Mythic</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Run Scope
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={raidSpecs.runScope || 'Full Clear (All Bosses)'}
                onChange={(e) => handleFieldChange('runScope', e.target.value)}
              >
                <option value="Full Clear (All Bosses)">Full Clear (All Bosses)</option>
                <option value="Last Boss Only (AOTC / CE)">Last Boss Only (AOTC / CE)</option>
                <option value="Specific Bosses">Specific Bosses (Custom)</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Loot Mode
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={raidSpecs.lootMode || 'Group Loot'}
                onChange={(e) => handleFieldChange('lootMode', e.target.value)}
              >
                <option value="Group Loot">Group Loot</option>
                <option value="Saved Run">Saved Run</option>
                <option value="VIP Unsaved / Armor & Token Priority">VIP Unsaved / Armor &amp; Token Priority</option>
                <option value="Full Loot Pass">Full Exclusive Loot Pass</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Scheduled Raid Time (UTC)
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. Today 20:00 UTC / Flexible"
                value={raidSpecs.scheduledTime || ''}
                onChange={(e) => handleFieldChange('scheduledTime', e.target.value)}
              />
            </label>
          </div>
        )}

        {/* TAB 4: PvP / Arena / RBG */}
        {activeCategory === 'pvp_arena' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem' }}>
            <label style={{ fontSize: '0.78rem' }}>
              Region &amp; Faction
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={pvpSpecs.regionFaction || 'EU - Cross-Faction'}
                onChange={(e) => handleFieldChange('regionFaction', e.target.value)}
              >
                <option value="EU - Cross-Faction">EU - Cross-Faction</option>
                <option value="US - Cross-Faction">US - Cross-Faction</option>
                <option value="EU - Alliance">EU - Alliance</option>
                <option value="EU - Horde">EU - Horde</option>
                <option value="US - Alliance">US - Alliance</option>
                <option value="US - Horde">US - Horde</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Bracket / Mode
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={pvpSpecs.bracketMode || '3v3 Arena'}
                onChange={(e) => handleFieldChange('bracketMode', e.target.value)}
              >
                <option value="2v2 Arena">2v2 Arena</option>
                <option value="3v3 Arena">3v3 Arena</option>
                <option value="Solo Shuffle">Solo Shuffle</option>
                <option value="Rated Battleground (RBG)">Rated Battleground (RBG)</option>
                <option value="Battleground Blitz">Battleground Blitz</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Current CR
              <input
                type="number"
                min="0"
                max="3500"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. 0 or 1400"
                value={pvpSpecs.ratingCurrent || ''}
                onChange={(e) => handleFieldChange('ratingCurrent', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Target CR Goal
              <input
                type="number"
                min="0"
                max="3500"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. 1800, 2100, 2400"
                value={pvpSpecs.ratingTarget || ''}
                onChange={(e) => handleFieldChange('ratingTarget', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Character Class &amp; Spec
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. Rogue - Subtlety / Priest"
                value={pvpSpecs.classSpec || ''}
                onChange={(e) => handleFieldChange('classSpec', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Gear Farm Option
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={pvpSpecs.gearFarmOption || 'Rating Only'}
                onChange={(e) => handleFieldChange('gearFarmOption', e.target.value)}
              >
                <option value="Rating Only">Rating Only</option>
                <option value="Full Honor Set">Full Honor Set Included</option>
                <option value="Full Conquest Set">Full Conquest Set Included</option>
                <option value="BiS PvP Gear Optimization">BiS PvP Gear Optimization</option>
              </select>
            </label>
          </div>
        )}

        {/* TAB 5: Delves & Farming */}
        {activeCategory === 'delves_farming' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem' }}>
            <label style={{ fontSize: '0.78rem' }}>
              Region &amp; Character Class
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. EU - Death Knight / Any"
                value={delvesSpecs.regionClass || ''}
                onChange={(e) => handleFieldChange('regionClass', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Activity Type
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={delvesSpecs.activityType || 'Tier 8-11 Delves'}
                onChange={(e) => handleFieldChange('activityType', e.target.value)}
              >
                <option value="Tier 8-11 Delves">Tier 8-11 Delves</option>
                <option value="Gold & Material Farm">Gold &amp; Material Farm</option>
                <option value="Crests & Valorstones Farm">Crests &amp; Valorstones Farm</option>
                <option value="Mount / Achievement Farm">Mount / Achievement Farm</option>
                <option value="Reputation & Renown Farm">Reputation &amp; Renown Farm</option>
              </select>
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Target Quantity / Runs
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. 4x Tier 8 Delves, 500k Gold"
                value={delvesSpecs.targetQuantity || ''}
                onChange={(e) => handleFieldChange('targetQuantity', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Specific Drop / Target Name
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. Delver's Dirigible, Brann 60, Crests"
                value={delvesSpecs.specificDropName || ''}
                onChange={(e) => handleFieldChange('specificDropName', e.target.value)}
              />
            </label>
          </div>
        )}

        {/* TAB 6: Custom / Bundle */}
        {activeCategory === 'custom_bundle' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.65rem' }}>
            <label style={{ fontSize: '0.78rem' }}>
              Region &amp; Server
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. EU - Draenor / Global"
                value={customSpecs.regionServer || ''}
                onChange={(e) => handleFieldChange('regionServer', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Service Scope Summary
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. Full Mythic Tour + Leveling + Tier Set"
                value={customSpecs.serviceScope || ''}
                onChange={(e) => handleFieldChange('serviceScope', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Estimated Completion Time
              <input
                type="text"
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                placeholder="e.g. Within 2 Hours, Same Day (4-6h)"
                value={customSpecs.estimatedTime || ''}
                onChange={(e) => handleFieldChange('estimatedTime', e.target.value)}
              />
            </label>

            <label style={{ fontSize: '0.78rem' }}>
              Required Booster Count
              <select
                className="input"
                style={{ width: '100%', marginTop: '0.2rem' }}
                value={customSpecs.boosterCount || '1 Booster'}
                onChange={(e) => handleFieldChange('boosterCount', e.target.value)}
              >
                <option value="1 Booster">1 Booster (Solo / Pilot Carry)</option>
                <option value="2-3 Boosters">2-3 Boosters</option>
                <option value="4-Man Premade Group">4-Man Premade Group (Mythic+)</option>
                <option value="Full Raid Team">Full Raid Team (10-20 Boosters)</option>
              </select>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
export default CategoryBoostSpecsTabs;
