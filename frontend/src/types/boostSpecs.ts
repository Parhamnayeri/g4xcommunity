/**
 * frontend/src/types/boostSpecs.ts
 * Authoritative types and schemas for category-specific boost specifications.
 */

export type BoostCategoryKey =
  | 'mythic_plus'
  | 'leveling_campaign'
  | 'raid_run'
  | 'pvp_arena'
  | 'delves_farming'
  | 'custom_bundle';

export interface MythicPlusSpecs {
  regionFaction?: string;
  keystoneLevel?: string;
  runsCount?: number;
  dungeonSelection?: string;
  timerGuarantee?: string;
  armorStack?: string;
}

export interface LevelingSpecs {
  regionRealm?: string;
  levelRangeCurrent?: number | string;
  levelRangeTarget?: number | string;
  classSpec?: string;
  campaignUnlock?: string;
  streamingOption?: string;
}

export interface RaidSpecs {
  regionFaction?: string;
  raidName?: string;
  difficulty?: string;
  runScope?: string;
  lootMode?: string;
  scheduledTime?: string;
}

export interface PvPSpecs {
  regionFaction?: string;
  bracketMode?: string;
  ratingCurrent?: number | string;
  ratingTarget?: number | string;
  classSpec?: string;
  gearFarmOption?: string;
}

export interface DelvesSpecs {
  regionClass?: string;
  activityType?: string;
  targetQuantity?: string;
  specificDropName?: string;
}

export interface CustomSpecs {
  regionServer?: string;
  serviceScope?: string;
  estimatedTime?: string;
  boosterCount?: string;
  [key: string]: any;
}

export type BoostSpecs =
  | MythicPlusSpecs
  | LevelingSpecs
  | RaidSpecs
  | PvPSpecs
  | DelvesSpecs
  | CustomSpecs
  | Record<string, any>;

export interface CategoryTabDefinition {
  key: BoostCategoryKey;
  boostModel: string;
  label: string;
  icon: string;
  description: string;
  defaultTitle: string;
}

export const BOOST_CATEGORY_TABS: CategoryTabDefinition[] = [
  {
    key: 'mythic_plus',
    boostModel: 'Mythic+ Keystone',
    label: 'Mythic+ Keystone',
    icon: '⚡',
    description: 'Keystone keys, timed runs, dungeon bundles & armor stacks',
    defaultTitle: 'Mythic+ 10-20 Timed Bundle',
  },
  {
    key: 'leveling_campaign',
    boostModel: 'Leveling & Campaign',
    label: 'Leveling & Campaign',
    icon: '⚔️',
    description: 'Power-leveling, expansion campaigns & renown unlocks',
    defaultTitle: 'Leveling 70-80 + Main Campaign Unlock',
  },
  {
    key: 'raid_run',
    boostModel: 'Raid Run',
    label: 'Raid Run',
    icon: '🛡️',
    description: 'Normal, Heroic & Mythic raids, AOTC/CE boss kills & loot passes',
    defaultTitle: 'Heroic Raid Full Clear (VIP Loot Priority)',
  },
  {
    key: 'pvp_arena',
    boostModel: 'PvP / Arena / RBG',
    label: 'PvP / Arena / RBG',
    icon: '🏆',
    description: 'Arena 2v2/3v3, Solo Shuffle, RBG rating & honor/conquest sets',
    defaultTitle: 'Arena 3v3 0-1800 Rating Boost',
  },
  {
    key: 'delves_farming',
    boostModel: 'Delves & Farming',
    label: 'Delves & Farming',
    icon: '⛏️',
    description: 'Tier 8-11 Delves, gold, valorstones, crests & mount grinds',
    defaultTitle: '4x Tier 8 Bountiful Delves Bundle',
  },
  {
    key: 'custom_bundle',
    boostModel: 'Custom / Bundle',
    label: 'Custom / Bundle',
    icon: '📦',
    description: 'Multi-service packages, custom requests & tailored carrying',
    defaultTitle: 'Custom All-Inclusive End-Game Package',
  },
];
