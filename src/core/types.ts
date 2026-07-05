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
  | 'coinBonus';

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
}

export interface Bullet {
  x: number;
  y: number;
  targetId: number;
  speed: number;
  dmg: number;
  crit: boolean;
}
