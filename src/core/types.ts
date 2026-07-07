export type UpgradeCategory = 'attack' | 'defense' | 'economy';

export type StatId =
  | 'damage'
  | 'attackSpeed'
  | 'critChance'
  | 'critFactor'
  | 'range'
  | 'maxHealth'
  | 'healthRegen'
  | 'cashPerKill'
  | 'cashPerWave'
  | 'coinBonus'
  | 'freeUpgradeChance';

export interface UpgradeDef {
  id: string;
  name: string;
  category: UpgradeCategory;
  stat: StatId;
  baseCost: number;
  costGrowth: number;
  valuePerLevel: number;
  /** 0 = 無上限 */
  maxLevel: number;
}

export interface EnemyTypeDef {
  id: string;
  name: string;
  hpMult: number;
  speedMult: number;
  dmgMult: number;
  rewardMult: number;
  radius: number;
  color: string;
  minWave: number;
  /** 遠程敵人：走到這個距離就停下攻擊塔（0/未填 = 近戰） */
  attackRange?: number;
  /** Boss 能力：每隔幾秒召喚一批小兵（0/未填 = 不召喚） */
  summonEvery?: number;
  summonCount?: number;
  summonType?: string;
  /** 出怪權重（未填 = 1）；讓稀有單位（如護盾兵）少出 */
  weight?: number;
  /** 分裂體：死亡時分裂出幾隻子體、子體類型 */
  splitInto?: number;
  splitType?: string;
  /** 吸血菁英：攻擊塔時回復自身血量（佔自身血量上限比例） */
  lifesteal?: number;
  /** 護盾兵：每秒治療範圍內同伴（佔其血量上限比例）與範圍 */
  auraHeal?: number;
  auraRadius?: number;
}

export interface EnemyScaling {
  baseHp: number;
  hpGrowth: number;
  baseSpeed: number;
  speedPerWave: number;
  maxSpeed: number;
  baseDmg: number;
  dmgGrowth: number;
  baseCash: number;
  cashGrowth: number;
  baseCoin: number;
  coinGrowth: number;
}

export interface WaveConfig {
  baseCount: number;
  countPerWave: number;
  maxCount: number;
  spawnInterval: number;
  minSpawnInterval: number;
  interWaveDelay: number;
  bossEvery: number;
  waveCoinBase: number;
  waveCoinGrowth: number;
}

export type Stats = Record<StatId, number>;

export interface Enemy {
  id: number;
  typeId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  dmg: number;
  cashValue: number;
  coinValue: number;
  radius: number;
  attackTimer: number;
  /** 遠程敵人的攻擊距離（0 = 近戰貼塔） */
  attackRange: number;
  /** 召喚間隔（0 = 無此能力）與倒數 */
  summonEvery: number;
  summonTimer: number;
  /** 燃燒：每秒傷害、剩餘時間與層數 */
  burnDps: number;
  burnTime: number;
  burnStacks: number;
  /** 冰霜：累積層數，達門檻後凍結 */
  frostStacks: number;
  frozenTime: number;
  /** 戰區能力用狀態 */
  zoneTimer: number;
  zoneEmpower: number;
  canSplit: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  targetId: number;
  speed: number;
  dmg: number;
  crit: boolean;
  /** 穿透彈：剩餘可再貫穿的敵人數（未填 = 不貫穿） */
  pierce?: number;
  /** 已命中過的敵人 id，避免同一發重複打同一隻 */
  hitIds?: number[];
  /** 軌道砲：每次貫穿累積的傷害加成倍率（未填 = 無衰減也無加成） */
  pierceRamp?: number;
}

/**
 * 短命的視覺事件。step() 每個 tick 開頭清空、過程中推入，UI 於同一 tick 取走轉成特效。
 * 核心邏輯不保存任何視覺狀態——這些只是「這個 tick 發生了什麼」的資料，維持確定性與可移植性。
 */
export type SimEvent =
  | { type: 'hit'; id: number; x: number; y: number; dmg: number; crit: boolean }
  | { type: 'kill'; x: number; y: number; typeId: string }
  | { type: 'wave'; wave: number; boss: boolean }
  | { type: 'fire'; angle: number }
  | { type: 'towerHit'; dmg: number }
  | { type: 'enemyShot'; x: number; y: number }
  | { type: 'summon'; x: number; y: number }
  | { type: 'perkOffer'; wave: number; choices: string[] }
  | { type: 'ultNuke'; color: string }
  | { type: 'ultActivate'; id: string; color: string }
  | { type: 'chain'; x1: number; y1: number; x2: number; y2: number; crit: boolean }
  | { type: 'status'; id: number; x: number; y: number; status: 'burn' | 'frost' | 'freeze' | 'empower' }
  | { type: 'zonePulse'; zoneId: string; color: string };
