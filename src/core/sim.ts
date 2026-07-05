import type { Bullet, Enemy, SimEvent, Stats } from './types';
import { computeStats, IN_RUN_UPGRADES, type Levels } from './stats';
import { upgradeCost, isMaxed } from './economy';
import { mulberry32 } from './rng';
import {
  ENEMY_TYPES,
  WAVE_CONFIG,
  enemyCash,
  enemyCoin,
  enemyDmg,
  enemyHp,
  enemySpeed,
  isBossWave,
  spawnIntervalForWave,
  waveCoinBonus,
  waveComposition,
} from './waves';

export const TICK_DT = 1 / 30;
export const ARENA_RADIUS = 330;
export const TOWER_RADIUS = 22;
const BULLET_SPEED = 460;
const ENEMY_ATTACK_INTERVAL = 1.0;

export interface SimState {
  wave: number;
  time: number;
  cash: number;
  coinsEarned: number;
  kills: number;
  towerHp: number;
  stats: Stats;
  inRunLevels: Levels;
  workshopLevels: Levels;
  enemies: Enemy[];
  bullets: Bullet[];
  spawnList: string[];
  spawnIdx: number;
  spawnTimer: number;
  interWaveTimer: number;
  attackTimer: number;
  over: boolean;
  rng: () => number;
  nextEnemyId: number;
  /** 本 tick 的視覺事件；step() 開頭清空，故 headless 模擬不會無限成長 */
  events: SimEvent[];
}

export function newRun(workshopLevels: Levels, seed: number): SimState {
  const inRunLevels: Levels = {};
  const stats = computeStats(workshopLevels, inRunLevels);
  const rng = mulberry32(seed);
  return {
    wave: 1,
    time: 0,
    cash: 0,
    coinsEarned: 0,
    kills: 0,
    towerHp: stats.maxHealth,
    stats,
    inRunLevels,
    workshopLevels,
    enemies: [],
    bullets: [],
    spawnList: waveComposition(1, rng),
    spawnIdx: 0,
    spawnTimer: 0.5,
    interWaveTimer: 0,
    attackTimer: 0,
    over: false,
    rng,
    nextEnemyId: 1,
    events: [],
  };
}

function spawnEnemy(s: SimState, typeId: string): void {
  const def = ENEMY_TYPES.find((t) => t.id === typeId)!;
  const angle = s.rng() * Math.PI * 2;
  const hp = enemyHp(s.wave, def.hpMult);
  s.enemies.push({
    id: s.nextEnemyId++,
    typeId,
    x: Math.cos(angle) * ARENA_RADIUS,
    y: Math.sin(angle) * ARENA_RADIUS,
    hp,
    maxHp: hp,
    speed: enemySpeed(s.wave, def.speedMult),
    dmg: enemyDmg(s.wave, def.dmgMult),
    cashValue: enemyCash(s.wave, def.rewardMult),
    coinValue: enemyCoin(s.wave, def.rewardMult),
    radius: def.radius,
    attackTimer: 0,
  });
}

function killEnemy(s: SimState, e: Enemy): void {
  s.cash += e.cashValue * s.stats.cashPerKill;
  s.coinsEarned += e.coinValue * s.stats.coinBonus;
  s.kills++;
  s.events.push({ type: 'kill', x: e.x, y: e.y, typeId: e.typeId });
  const i = s.enemies.indexOf(e);
  if (i >= 0) s.enemies.splice(i, 1);
}

function startNextWave(s: SimState): void {
  s.cash += s.stats.cashPerWave;
  s.coinsEarned += waveCoinBonus(s.wave) * s.stats.coinBonus;
  s.wave++;
  s.spawnList = waveComposition(s.wave, s.rng);
  s.spawnIdx = 0;
  s.spawnTimer = 0;
  s.events.push({ type: 'wave', wave: s.wave, boss: isBossWave(s.wave) });
}

export function step(s: SimState, dt: number): void {
  if (s.over) return;
  s.events.length = 0;
  s.time += dt;

  s.towerHp = Math.min(s.towerHp + s.stats.healthRegen * dt, s.stats.maxHealth);

  // 波次與生成
  if (s.interWaveTimer > 0) {
    s.interWaveTimer -= dt;
    if (s.interWaveTimer <= 0) startNextWave(s);
  } else if (s.spawnIdx < s.spawnList.length) {
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      spawnEnemy(s, s.spawnList[s.spawnIdx++]);
      s.spawnTimer += spawnIntervalForWave(s.wave);
    }
  } else if (s.enemies.length === 0) {
    s.interWaveTimer = WAVE_CONFIG.interWaveDelay;
  }

  // 敵人移動與攻擊
  for (const e of s.enemies) {
    const dist = Math.hypot(e.x, e.y);
    const contact = TOWER_RADIUS + e.radius;
    if (dist > contact) {
      const move = Math.min(e.speed * dt, dist - contact);
      e.x -= (e.x / dist) * move;
      e.y -= (e.y / dist) * move;
      e.attackTimer = 0;
    } else {
      e.attackTimer -= dt;
      if (e.attackTimer <= 0) {
        s.towerHp -= e.dmg;
        s.events.push({ type: 'towerHit', dmg: e.dmg });
        e.attackTimer += ENEMY_ATTACK_INTERVAL;
      }
    }
  }

  // 塔索敵開火（用距離平方比較，冷卻可在單 tick 內多次觸發以支援高攻速）
  const cooldown = 1 / s.stats.attackSpeed;
  s.attackTimer -= dt;
  while (s.attackTimer <= 0) {
    const rangeSq = s.stats.range * s.stats.range;
    let target: Enemy | null = null;
    let bestSq = Infinity;
    for (const e of s.enemies) {
      const dSq = e.x * e.x + e.y * e.y;
      if (dSq <= rangeSq && dSq < bestSq) {
        bestSq = dSq;
        target = e;
      }
    }
    if (!target) {
      s.attackTimer = 0;
      break;
    }
    const crit = s.rng() < s.stats.critChance;
    s.bullets.push({
      x: 0,
      y: 0,
      targetId: target.id,
      speed: BULLET_SPEED,
      dmg: s.stats.damage * (crit ? s.stats.critFactor : 1),
      crit,
    });
    s.events.push({ type: 'fire', angle: Math.atan2(target.y, target.x) });
    s.attackTimer += cooldown;
  }

  // 子彈追蹤與命中
  for (let i = s.bullets.length - 1; i >= 0; i--) {
    const b = s.bullets[i];
    const target = s.enemies.find((e) => e.id === b.targetId);
    if (!target) {
      s.bullets.splice(i, 1);
      continue;
    }
    const dx = target.x - b.x;
    const dy = target.y - b.y;
    const dist = Math.hypot(dx, dy);
    const travel = b.speed * dt;
    if (dist <= travel + target.radius) {
      target.hp -= b.dmg;
      s.events.push({ type: 'hit', id: target.id, x: target.x, y: target.y, dmg: b.dmg, crit: b.crit });
      s.bullets.splice(i, 1);
      if (target.hp <= 0) killEnemy(s, target);
    } else {
      b.x += (dx / dist) * travel;
      b.y += (dy / dist) * travel;
    }
  }

  if (s.towerHp <= 0) {
    s.towerHp = 0;
    s.over = true;
  }
}

/** 場內升級購買；成功時回傳 true。買血量上限會同步補血。 */
export function buyInRunUpgrade(s: SimState, upgradeId: string): boolean {
  const def = IN_RUN_UPGRADES.find((u) => u.id === upgradeId);
  if (!def || s.over) return false;
  const level = s.inRunLevels[upgradeId] ?? 0;
  if (isMaxed(def, level)) return false;
  const cost = upgradeCost(def, level);
  if (s.cash < cost) return false;
  s.cash -= cost;
  s.inRunLevels[upgradeId] = level + 1;
  const prevMax = s.stats.maxHealth;
  s.stats = computeStats(s.workshopLevels, s.inRunLevels);
  if (s.stats.maxHealth > prevMax) s.towerHp += s.stats.maxHealth - prevMax;
  return true;
}
