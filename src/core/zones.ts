import zonesData from '../data/zones.json';

/** 戰區對敵人規則的獨立倍率（乘在波次縮放與敵種倍率之後） */
export interface ZoneMods {
  hpMult: number;
  speedMult: number;
  dmgMult: number;
  countMult: number;
  cashMult: number;
  coinMult: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  /** 主題色（HUD、信標、塔核心） */
  accent: string;
  /** 雷達網格線色 */
  grid: string;
  /** 場地環境光色 */
  glow: string;
  mods: ZoneMods;
}

export const ZONES = zonesData.zones as ZoneDef[];
export const ZONE_CONFIG = zonesData.config as { zoneEvery: number };

/** 波次落在第幾個戰區（0-based，循環） */
export function zoneIndexForWave(wave: number): number {
  return Math.floor((wave - 1) / ZONE_CONFIG.zoneEvery) % ZONES.length;
}

export function zoneForWave(wave: number): ZoneDef {
  return ZONES[zoneIndexForWave(wave)];
}

/** 這一波是否為戰區的第一波（進區時機，wave 1 也算） */
export function isZoneEntryWave(wave: number): boolean {
  return (wave - 1) % ZONE_CONFIG.zoneEvery === 0;
}
