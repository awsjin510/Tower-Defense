import type { EnemyScaling, EnemyTypeDef, WaveConfig } from './types';
import enemiesData from '../data/enemies.json';

export const ENEMY_TYPES = enemiesData.types as EnemyTypeDef[];
export const SCALING = enemiesData.scaling as EnemyScaling;
export const WAVE_CONFIG = enemiesData.waves as WaveConfig;

export function enemyHp(wave: number, typeMult: number): number {
  return SCALING.baseHp * Math.pow(SCALING.hpGrowth, wave - 1) * typeMult;
}

export function enemySpeed(wave: number, typeMult: number): number {
  return Math.min(SCALING.baseSpeed + SCALING.speedPerWave * (wave - 1), SCALING.maxSpeed) * typeMult;
}

export function enemyDmg(wave: number, typeMult: number): number {
  return SCALING.baseDmg * Math.pow(SCALING.dmgGrowth, wave - 1) * typeMult;
}

export function enemyCash(wave: number, typeMult: number): number {
  return SCALING.baseCash * Math.pow(SCALING.cashGrowth, wave - 1) * typeMult;
}

export function enemyCoin(wave: number, typeMult: number): number {
  return SCALING.baseCoin * Math.pow(SCALING.coinGrowth, wave - 1) * typeMult;
}

export function enemyCountForWave(wave: number): number {
  return Math.min(
    Math.floor(WAVE_CONFIG.baseCount + WAVE_CONFIG.countPerWave * (wave - 1)),
    WAVE_CONFIG.maxCount
  );
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

/** 本波敵人組成：一般敵人依權重隨機，Boss 波額外加一隻頭目 */
export function waveComposition(wave: number, rng: () => number): string[] {
  const available = ENEMY_TYPES.filter((t) => t.id !== 'boss' && wave >= t.minWave);
  const result: string[] = [];
  const count = enemyCountForWave(wave);
  for (let i = 0; i < count; i++) {
    result.push(available[Math.floor(rng() * available.length)].id);
  }
  if (isBossWave(wave)) result.push('boss');
  return result;
}
