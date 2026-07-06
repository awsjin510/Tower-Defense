import type { EnemyScaling, EnemyTypeDef, WaveConfig } from './types';
import enemiesData from '../data/enemies.json';
import { zoneForWave } from './zones';

export const ENEMY_TYPES = enemiesData.types as EnemyTypeDef[];
export const SCALING = enemiesData.scaling as EnemyScaling;
export const WAVE_CONFIG = enemiesData.waves as WaveConfig;

// 敵人數值 = 波次縮放 × 敵種倍率 × 戰區倍率（三層皆資料驅動）

export function enemyHp(wave: number, typeMult: number): number {
  return SCALING.baseHp * Math.pow(SCALING.hpGrowth, wave - 1) * typeMult * zoneForWave(wave).mods.hpMult;
}

export function enemySpeed(wave: number, typeMult: number): number {
  const base = Math.min(SCALING.baseSpeed + SCALING.speedPerWave * (wave - 1), SCALING.maxSpeed);
  return base * typeMult * zoneForWave(wave).mods.speedMult;
}

export function enemyDmg(wave: number, typeMult: number): number {
  return SCALING.baseDmg * Math.pow(SCALING.dmgGrowth, wave - 1) * typeMult * zoneForWave(wave).mods.dmgMult;
}

export function enemyCash(wave: number, typeMult: number): number {
  return SCALING.baseCash * Math.pow(SCALING.cashGrowth, wave - 1) * typeMult * zoneForWave(wave).mods.cashMult;
}

export function enemyCoin(wave: number, typeMult: number): number {
  return SCALING.baseCoin * Math.pow(SCALING.coinGrowth, wave - 1) * typeMult * zoneForWave(wave).mods.coinMult;
}

export function enemyCountForWave(wave: number): number {
  const base = WAVE_CONFIG.baseCount + WAVE_CONFIG.countPerWave * (wave - 1);
  return Math.min(Math.floor(base * zoneForWave(wave).mods.countMult), WAVE_CONFIG.maxCount);
}

export function spawnIntervalForWave(wave: number): number {
  const t = WAVE_CONFIG.spawnInterval - wave * 0.008;
  return Math.max(t, WAVE_CONFIG.minSpawnInterval);
}

export function isBossWave(wave: number): boolean {
  return wave % WAVE_CONFIG.bossEvery === 0;
}

export function waveCoinBonus(wave: number): number {
  return WAVE_CONFIG.waveCoinBase * Math.pow(WAVE_CONFIG.waveCoinGrowth, wave - 1);
}

/** 本波敵人組成：一般敵人依權重隨機（稀有單位權重低），Boss 波額外加一隻頭目 */
export function waveComposition(wave: number, rng: () => number): string[] {
  const available = ENEMY_TYPES.filter((t) => t.id !== 'boss' && wave >= t.minWave);
  const total = available.reduce((sum, t) => sum + (t.weight ?? 1), 0);
  const result: string[] = [];
  const count = enemyCountForWave(wave);
  for (let i = 0; i < count; i++) {
    let r = rng() * total;
    let pick = available[available.length - 1].id;
    for (const t of available) {
      r -= t.weight ?? 1;
      if (r <= 0) {
        pick = t.id;
        break;
      }
    }
    result.push(pick);
  }
  if (isBossWave(wave)) result.push('boss');
  return result;
}
