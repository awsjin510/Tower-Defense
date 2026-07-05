import type { Bullet, Enemy, SimEvent, Stats } from './types';
import { computeStats, IN_RUN_UPGRADES, type Levels } from './stats';
import { upgradeCost, isMaxed } from './economy';
import { applyPerks, isPerkWave, PERK_CONFIG, rollPerkChoices } from './perks';
import { applyCardStatMods, emptyMods, type RunMods } from './cards';
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
import { zoneForWave } from './zones';

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
  /** 本場已取得的 Perk（死亡歸零，與場內升級同生命週期） */
  perks: string[];
  /** 待選擇的 Perk 三選一；非 null 時模擬暫停，等 choosePerk() */
  pendingPerks: string[] | null;
  /** 本場裝備卡片組出的加成（整場固定） */
  mods: RunMods;
  /** 本 tick 的視覺事件；step() 開頭清空，故 headless 模擬不會無限成長 */
  events: SimEvent[];
}

export function newRun(workshopLevels: Levels, seed: number, mods: RunMods = emptyMods()): SimState {
  const inRunLevels: Levels = {};
  const stats = computeStats(workshopLevels, inRunLevels);
  applyCardStatMods(stats, mods.statMods);
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
    perks: [],
    pendingPerks: null,
    mods,
    events: [],
  };
}

/** 建立敵人；不給座標時放在場邊隨機角度（Boss 召喚會指定在 Boss 腳下） */
function makeEnemy(s: SimState, typeId: string, x?: number, y?: number): Enemy {
  const def = ENEMY_TYPES.find((t) => t.id === typeId)!;
  const angle = s.rng() * Math.PI * 2;
  const hp = enemyHp(s.wave, def.hpMult);
  return {
    id: s.nextEnemyId++,
    typeId,
    x: x ?? Math.cos(angle) * ARENA_RADIUS,
    y: y ?? Math.sin(angle) * ARENA_RADIUS,
    hp,
    maxHp: hp,
    speed: enemySpeed(s.wave, def.speedMult),
    dmg: enemyDmg(s.wave, def.dmgMult),
    cashValue: enemyCash(s.wave, def.rewardMult),
    coinValue: enemyCoin(s.wave, def.rewardMult),
    radius: def.radius,
    attackTimer: 0,
    attackRange: def.attackRange ?? 0,
    summonEvery: def.summonEvery ?? 0,
    summonTimer: def.summonEvery ?? 0,
  };
}

function spawnEnemy(s: SimState, typeId: string): void {
  s.enemies.push(makeEnemy(s, typeId));
}

function killEnemy(s: SimState, e: Enemy): void {
  s.cash += e.cashValue * s.stats.cashPerKill;
  s.coinsEarned += e.coinValue * s.stats.coinBonus;
  s.kills++;
  // 吸血卡：擊殺回復血量上限的比例
  if (s.mods.lifestealFrac > 0) {
    s.towerHp = Math.min(s.towerHp + s.mods.lifestealFrac * s.stats.maxHealth, s.stats.maxHealth);
  }
  s.events.push({ type: 'kill', x: e.x, y: e.y, typeId: e.typeId });
  const i = s.enemies.indexOf(e);
  if (i >= 0) s.enemies.splice(i, 1);
}

function startNextWave(s: SimState): void {
  s.cash += s.stats.cashPerWave;
  // 利息卡：按目前現金比例生息（上限避免滾雪球失控）
  if (s.mods.interest > 0) {
    s.cash += Math.min(s.cash * s.mods.interest, s.stats.cashPerWave * 10);
  }
  s.coinsEarned += waveCoinBonus(s.wave) * s.stats.coinBonus;
  s.wave++;
  s.spawnList = waveComposition(s.wave, s.rng);
  s.spawnIdx = 0;
  s.spawnTimer = 0;
  s.events.push({ type: 'wave', wave: s.wave, boss: isBossWave(s.wave) });
  if (isPerkWave(s.wave)) {
    const choices = rollPerkChoices(s.perks, s.rng, PERK_CONFIG.choices + s.mods.extraPerkChoices);
    if (choices.length > 0) {
      s.pendingPerks = choices;
      s.events.push({ type: 'perkOffer', wave: s.wave, choices });
    }
  }
}

/** 屬性重算（升級/Perk 後呼叫）：血量上限提高時補差額，降低時夾回上限 */
function recomputeStats(s: SimState): void {
  const prevMax = s.stats.maxHealth;
  const next = computeStats(s.workshopLevels, s.inRunLevels);
  applyPerks(next, s.perks);
  applyCardStatMods(next, s.mods.statMods);
  s.stats = next;
  if (next.maxHealth > prevMax) s.towerHp += next.maxHealth - prevMax;
  s.towerHp = Math.min(s.towerHp, next.maxHealth);
}

export function step(s: SimState, dt: number): void {
  if (s.over) return;
  s.events.length = 0;
  // Perk 選擇中：模擬暫停（確定性不受 UI 思考時間影響）
  if (s.pendingPerks) return;
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

  // 敵人移動與攻擊（遠程敵人走到 attackRange 就停下開火；近戰貼塔）
  const summoned: Enemy[] = [];
  for (const e of s.enemies) {
    const dist = Math.hypot(e.x, e.y);
    const contact = TOWER_RADIUS + e.radius;
    const standoff = Math.max(contact, e.attackRange);
    if (dist > standoff) {
      // 慢速靈氣卡：射程內的敵人減速
      const slow = s.mods.slowAura > 0 && dist <= s.stats.range ? 1 - s.mods.slowAura : 1;
      const move = Math.min(e.speed * slow * dt, dist - standoff);
      e.x -= (e.x / dist) * move;
      e.y -= (e.y / dist) * move;
      e.attackTimer = 0;
    } else {
      e.attackTimer -= dt;
      if (e.attackTimer <= 0) {
        s.towerHp -= e.dmg;
        s.events.push({ type: 'towerHit', dmg: e.dmg });
        if (e.attackRange > 0) s.events.push({ type: 'enemyShot', x: e.x, y: e.y });
        // 荊棘反傷卡：近戰攻擊者受到一部分傷害反彈
        if (s.mods.thorns > 0 && e.attackRange === 0) {
          e.hp -= e.dmg * s.mods.thorns;
          s.events.push({ type: 'hit', id: e.id, x: e.x, y: e.y, dmg: e.dmg * s.mods.thorns, crit: false });
          if (e.hp <= 0) killEnemy(s, e);
        }
        e.attackTimer += ENEMY_ATTACK_INTERVAL;
      }
    }
    // Boss 召喚：在自己腳下叫出小兵
    if (e.summonEvery > 0) {
      e.summonTimer -= dt;
      if (e.summonTimer <= 0) {
        e.summonTimer += e.summonEvery;
        const def = ENEMY_TYPES.find((t) => t.id === e.typeId)!;
        const count = def.summonCount ?? 1;
        const typeId = def.summonType ?? 'normal';
        for (let i = 0; i < count; i++) {
          const a = s.rng() * Math.PI * 2;
          summoned.push(makeEnemy(s, typeId, e.x + Math.cos(a) * (e.radius + 12), e.y + Math.sin(a) * (e.radius + 12)));
        }
        s.events.push({ type: 'summon', x: e.x, y: e.y });
      }
    }
  }
  s.enemies.push(...summoned);

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
      // 命中傷害套用條件卡：頭目剋星、戰區傷害
      let dmg = b.dmg;
      if (target.typeId === 'boss' && s.mods.bossDamageMult > 1) dmg *= s.mods.bossDamageMult;
      const zoneBonus = s.mods.zoneDamage[zoneForWave(s.wave).id] ?? 0;
      if (zoneBonus > 0) dmg *= 1 + zoneBonus;
      target.hp -= dmg;
      s.events.push({ type: 'hit', id: target.id, x: target.x, y: target.y, dmg, crit: b.crit });
      s.bullets.splice(i, 1);
      const hx = target.x;
      const hy = target.y;
      if (target.hp <= 0) killEnemy(s, target);
      // 彈射卡：對最近的其他敵人造成 60% 傷害（確定性：依距離、id 排序）
      if (s.mods.bounce > 0) {
        const bounceDmg = dmg * 0.6;
        const cands = s.enemies
          .filter((e) => e.id !== b.targetId)
          .map((e) => ({ e, d: (e.x - hx) * (e.x - hx) + (e.y - hy) * (e.y - hy) }))
          .sort((a, c) => a.d - c.d || a.e.id - c.e.id)
          .slice(0, s.mods.bounce);
        for (const { e } of cands) {
          e.hp -= bounceDmg;
          s.events.push({ type: 'hit', id: e.id, x: e.x, y: e.y, dmg: bounceDmg, crit: false });
          if (e.hp <= 0) killEnemy(s, e);
        }
      }
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
  recomputeStats(s);
  return true;
}

/** 從待選 Perk 中選一個；成功時回傳 true 並恢復模擬 */
export function choosePerk(s: SimState, perkId: string): boolean {
  if (!s.pendingPerks || !s.pendingPerks.includes(perkId)) return false;
  s.perks.push(perkId);
  s.pendingPerks = null;
  recomputeStats(s);
  return true;
}
