import React from 'react';
import { BOOST_CATEGORY_TABS } from '../../types/boostSpecs';

interface BoostSpecsBadgeGridProps {
  boostModel?: string | null;
  boostSpecs?: Record<string, any> | null;
  boostSpecsJson?: string | null;
  className?: string;
  style?: React.CSSProperties;
}

export const BoostSpecsBadgeGrid: React.FC<BoostSpecsBadgeGridProps> = ({
  boostModel,
  boostSpecs,
  boostSpecsJson,
  style,
}) => {
  let specsObj: Record<string, any> | null = null;
  if (boostSpecs && typeof boostSpecs === 'object') {
    specsObj = boostSpecs;
  } else if (boostSpecsJson && typeof boostSpecsJson === 'string') {
    try {
      specsObj = JSON.parse(boostSpecsJson);
    } catch {
      specsObj = null;
    }
  }

  if (!specsObj || Object.keys(specsObj).length === 0) {
    return null;
  }

  const modelLower = (boostModel || '').toLowerCase();
  const matchingTab = BOOST_CATEGORY_TABS.find(
    (t) => t.boostModel.toLowerCase() === modelLower || modelLower.includes(t.key.split('_')[0])
  );

  const entries: Array<{ label: string; value: string; icon?: string }> = [];

  if (modelLower.includes('mythic')) {
    if (specsObj.regionFaction) entries.push({ label: 'Region & Faction', value: specsObj.regionFaction, icon: '🌍' });
    if (specsObj.keystoneLevel) entries.push({ label: 'Keystone Level', value: specsObj.keystoneLevel, icon: '🗝️' });
    if (specsObj.runsCount) entries.push({ label: 'Number of Runs', value: String(specsObj.runsCount), icon: '🔢' });
    if (specsObj.dungeonSelection) entries.push({ label: 'Dungeon', value: specsObj.dungeonSelection, icon: '🏰' });
    if (specsObj.timerGuarantee) entries.push({ label: 'Timer Guarantee', value: specsObj.timerGuarantee, icon: '⏱️' });
    if (specsObj.armorStack) entries.push({ label: 'Armor / Traders', value: specsObj.armorStack, icon: '🛡️' });
  } else if (modelLower.includes('leveling') || modelLower.includes('campaign')) {
    if (specsObj.regionRealm) entries.push({ label: 'Region & Realm', value: specsObj.regionRealm, icon: '🌍' });
    if (specsObj.levelRangeCurrent || specsObj.levelRangeTarget) {
      entries.push({
        label: 'Level Range',
        value: `${specsObj.levelRangeCurrent || '?'} → ${specsObj.levelRangeTarget || '?'}`,
        icon: '📈',
      });
    }
    if (specsObj.classSpec) entries.push({ label: 'Class & Spec', value: specsObj.classSpec, icon: '🧙' });
    if (specsObj.campaignUnlock) entries.push({ label: 'Campaign / Unlock', value: specsObj.campaignUnlock, icon: '📜' });
    if (specsObj.streamingOption) entries.push({ label: 'Streaming', value: specsObj.streamingOption, icon: '📹' });
  } else if (modelLower.includes('raid')) {
    if (specsObj.regionFaction) entries.push({ label: 'Region & Faction', value: specsObj.regionFaction, icon: '🌍' });
    if (specsObj.raidName) entries.push({ label: 'Raid Name', value: specsObj.raidName, icon: '👑' });
    if (specsObj.difficulty) entries.push({ label: 'Difficulty', value: specsObj.difficulty, icon: '🔥' });
    if (specsObj.runScope) entries.push({ label: 'Run Scope', value: specsObj.runScope, icon: '🎯' });
    if (specsObj.lootMode) entries.push({ label: 'Loot Mode', value: specsObj.lootMode, icon: '💎' });
    if (specsObj.scheduledTime) entries.push({ label: 'Scheduled (UTC)', value: specsObj.scheduledTime, icon: '📅' });
  } else if (modelLower.includes('pvp') || modelLower.includes('arena') || modelLower.includes('rbg')) {
    if (specsObj.regionFaction) entries.push({ label: 'Region & Faction', value: specsObj.regionFaction, icon: '🌍' });
    if (specsObj.bracketMode) entries.push({ label: 'Bracket / Mode', value: specsObj.bracketMode, icon: '⚔️' });
    if (specsObj.ratingCurrent || specsObj.ratingTarget) {
      entries.push({
        label: 'Rating Goal',
        value: `${specsObj.ratingCurrent || '0'} → ${specsObj.ratingTarget || '?'}`,
        icon: '🏆',
      });
    }
    if (specsObj.classSpec) entries.push({ label: 'Class & Spec', value: specsObj.classSpec, icon: '🤺' });
    if (specsObj.gearFarmOption) entries.push({ label: 'Gear Farm', value: specsObj.gearFarmOption, icon: '🛡️' });
  } else if (modelLower.includes('delve') || modelLower.includes('farm')) {
    if (specsObj.regionClass) entries.push({ label: 'Region & Class', value: specsObj.regionClass, icon: '🌍' });
    if (specsObj.activityType) entries.push({ label: 'Activity Type', value: specsObj.activityType, icon: '⛏️' });
    if (specsObj.targetQuantity) entries.push({ label: 'Target Runs/Qty', value: specsObj.targetQuantity, icon: '📦' });
    if (specsObj.specificDropName) entries.push({ label: 'Specific Drop', value: specsObj.specificDropName, icon: '✨' });
  } else {
    // Custom / Bundle / Generic
    if (specsObj.regionServer) entries.push({ label: 'Region & Server', value: specsObj.regionServer, icon: '🌍' });
    if (specsObj.serviceScope) entries.push({ label: 'Service Scope', value: specsObj.serviceScope, icon: '📋' });
    if (specsObj.estimatedTime) entries.push({ label: 'Est. Completion', value: specsObj.estimatedTime, icon: '⏱️' });
    if (specsObj.boosterCount) entries.push({ label: 'Booster Team', value: specsObj.boosterCount, icon: '👥' });
    for (const [k, v] of Object.entries(specsObj)) {
      if (!['regionServer', 'serviceScope', 'estimatedTime', 'boosterCount'].includes(k) && v) {
        entries.push({ label: k.replace(/([A-Z])/g, ' $1').replace(/^./, (str) => str.toUpperCase()), value: String(v) });
      }
    }
  }

  const validEntries = entries.filter((e) => Boolean(e.value && e.value.trim()));
  if (validEntries.length === 0) return null;

  return (
    <div
      style={{
        background: 'rgba(255, 255, 255, 0.02)',
        border: '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: '10px',
        padding: '12px 14px',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <span style={{ fontSize: '0.95rem' }}>{matchingTab?.icon || '📋'}</span>
        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#facc15', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          Service Specifications ({matchingTab?.label || boostModel || 'General'})
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: '8px',
        }}
      >
        {validEntries.map((item, idx) => (
          <div
            key={idx}
            style={{
              background: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              borderRadius: '6px',
              padding: '6px 10px',
            }}
          >
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '4px' }}>
              {item.icon && <span>{item.icon}</span>}
              <span>{item.label}</span>
            </div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f8fafc', marginTop: '2px', wordBreak: 'break-word' }}>
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
export default BoostSpecsBadgeGrid;
