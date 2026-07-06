import type { Bullet, Enemy, SimEvent, Stats } from './types';
import { computeStats, IN_RUN_UPGRADES, type Levels } from './stats';
import { upgradeCost, isMaxed } from './economy';
import { applyPerks, hasPerk, isPerkWave, PERK_CONFIG, rollPerkChoices } from './perks';
import { applyCardStatMods, emptyMods, type RunMods } from './cards';
import type { ResolvedUltimate } from './ultimates';
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
  researchLevels: Levels;
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
  /** 本場可用的終極武器（已解析等級參數） */
  ultimates: ResolvedUltimate[];
  /** 各終極武器的剩餘冷卻秒數（0 = 可施放） */
  ultCooldowns: Record<string, number>;
  /** 進行中的限時終極效果（黃金塔） */
  ultActive: Array<{ id: string; remaining: number; coinMult: number }>;
  /** 戰區機制共用計量：寒冰侵蝕程度、週期能力倒數 */
  zoneMeter: number;
  zonePulseTimer: number;
  /** 本 tick 的視覺事件；step() 開頭清空，故 headless 模擬不會無限成長 */
  events: SimEvent[];
}

export function newRun(
  workshopLevels: Levels,
  seed: number,
  mods: RunMods = emptyMods(),
  researchLevels: Levels = {},
  ultimates: ResolvedUltimate[] = []
): SimState {
  const inRunLevels: Levels = {};
  const stats = computeStats(workshopLevels, inRunLevels, researchLevels);
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
    researchLevels,
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
    ultimates,
    ultCooldowns: Object.fromEntries(ultimates.map((u) => [u.id, 0])),
    ultActive: [],
    zoneMeter: 0,
    zonePulseTimer: zoneForWave(1).mechanic.interval ?? 0,
    events: [],
  };
}

/** 目前所有限時終極（黃金塔）疊乘出的金幣倍率 */
function coinMultiplier(s: SimState): number {
  let m = 1;
  for (const a of s.ultActive) m *= a.coinMult;
  return m;
}

/**
 * 施放終極武器；成功回傳 true。冷卻中或未持有回傳 false。
 * 由 UI 在戰鬥中呼叫（headless 模擬不會施放，故不影響平衡）。
 */
export function activateUltimate(s: SimState, id: string): boolean {
  if (s.over || s.pendingPerks) return false;
  const ult = s.ultimates.find((u) => u.id === id);
  if (!ult) return false;
  if ((s.ultCooldowns[id] ?? 0) > 0) return false;
  s.ultCooldowns[id] = ult.cooldown;
  if (ult.kind === 'coinBuff') {
    s.ultActive.push({ id, remaining: ult.duration, coinMult: ult.coinMult });
    s.events.push({ type: 'ultActivate', id, color: ult.color });
  } else {
    // 黑洞：對全場敵人造成塔傷的倍率傷害（瞬發、確定性）
    const dmg = s.stats.damage * ult.damageMult;
    for (const e of [...s.enemies]) {
      e.hp -= dmg;
      s.events.push({ type: 'hit', id: e.id, x: e.x, y: e.y, dmg, crit: true });
      if (e.hp <= 0) killEnemy(s, e);
    }
    s.events.push({ type: 'ultNuke', color: ult.color });
  }
  return true;
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
    burnDps: 0,
    burnTime: 0,
    burnStacks: 0,
    frostStacks: 0,
    frozenTime: 0,
    zoneTimer: zoneForWave(s.wave).mechanic.interval ?? 0,
    zoneEmpower: 1,
    canSplit: true,
  };
}

function spawnEnemy(s: SimState, typeId: string): void {
  s.enemies.push(makeEnemy(s, typeId));
}

function killEnemy(s: SimState, e: Enemy): void {
  const coinMult = coinMultiplier(s); // 黃金塔啟用時倍增
  s.cash += e.cashValue * s.stats.cashPerKill * coinMult;
  s.coinsEarned += e.coinValue * s.stats.coinBonus * coinMult;
  s.kills++;
  const zone = zoneForWave(s.wave);
  if (zone.mechanic.kind === 'frost') s.zoneMeter = Math.max(0, s.zoneMeter - 0.055);
  // 吸血卡：擊殺回復血量上限的比例
  if (s.mods.lifestealFrac > 0) {
    s.towerHp = Math.min(s.towerHp + s.mods.lifestealFrac * s.stats.maxHealth, s.stats.maxHealth);
  }
  s.events.push({ type: 'kill', x: e.x, y: e.y, typeId: e.typeId });
  const i = s.enemies.indexOf(e);
  if (i >= 0) s.enemies.splice(i, 1);

  // 燃燒流：死亡時把現有燃燒傳給附近三名敵人。
  if (hasPerk(s.perks, 'wildfire') && e.burnTime > 0) {
    const nearby = nearestEnemies(s, e.x, e.y, 3, e.id);
    for (const n of nearby) applyBurn(s, n, Math.max(e.burnDps * 0.7, s.stats.damage * 0.12), Math.max(1, e.burnStacks - 1));
  }
  // 冰凍流：凍結中的敵人死亡會引發碎冰範圍傷害。
  if (hasPerk(s.perks, 'shatter') && e.frozenTime > 0) {
    for (const n of nearestEnemies(s, e.x, e.y, 4, e.id).filter((n) => Math.hypot(n.x - e.x, n.y - e.y) <= 100)) {
      const dmg = s.stats.damage * 0.8;
      n.hp -= dmg;
      s.events.push({ type: 'hit', id: n.id, x: n.x, y: n.y, dmg, crit: false });
      if (n.hp <= 0) killEnemy(s, n);
    }
  }
  // 戰區規則：翠綠分裂、虛空死亡強化附近同伴。
  if (zone.mechanic.kind === 'split' && s.wave >= 6 && e.canSplit && e.typeId !== 'boss' && s.rng() < zone.mechanic.value) {
    for (const side of [-1, 1]) {
      const child = makeEnemy(s, 'fast', e.x + side * 8, e.y - side * 8);
      child.hp *= 0.18;
      child.maxHp = child.hp;
      child.radius *= 0.72;
      child.dmg *= 0.25;
      child.cashValue *= 0.25;
      child.coinValue *= 0.25;
      child.canSplit = false;
      s.enemies.push(child);
    }
    s.events.push({ type: 'summon', x: e.x, y: e.y });
  } else if (zone.mechanic.kind === 'void') {
    for (const n of nearestEnemies(s, e.x, e.y, 3, e.id).filter((n) => Math.hypot(n.x - e.x, n.y - e.y) <= 120)) {
      n.zoneEmpower *= 1 + zone.mechanic.value;
      n.speed *= 1 + zone.mechanic.value * 0.5;
      n.dmg *= 1 + zone.mechanic.value;
      s.events.push({ type: 'status', id: n.id, x: n.x, y: n.y, status: 'empower' });
    }
  }
}

function nearestEnemies(s: SimState, x: number, y: number, count: number, excludeId = -1): Enemy[] {
  return s.enemies
    .filter((n) => n.id !== excludeId)
    .map((n) => ({ n, d: (n.x - x) ** 2 + (n.y - y) ** 2 }))
    .sort((a, b) => a.d - b.d || a.n.id - b.n.id)
    .slice(0, count)
    .map(({ n }) => n);
}

function applyBurn(s: SimState, e: Enemy, dps: number, stacks = 1): void {
  const wasBurning = e.burnTime > 0;
  const add = Math.min(stacks, 5 - e.burnStacks);
  if (add <= 0) return;
  e.burnStacks += add;
  e.burnDps += dps * add;
  e.burnTime = 3;
  if (!wasBurning) s.events.push({ type: 'status', id: e.id, x: e.x, y: e.y, status: 'burn' });
}

function applyFrost(s: SimState, e: Enemy): void {
  e.frostStacks++;
  if (e.frostStacks >= 3) {
    e.frostStacks = 0;
    e.frozenTime = 1.2;
    s.events.push({ type: 'status', id: e.id, x: e.x, y: e.y, status: 'freeze' });
  } else if (e.frostStacks === 1) {
    s.events.push({ type: 'status', id: e.id, x: e.x, y: e.y, status: 'frost' });
  }
}

function startNextWave(s: SimState): void {
  s.cash += s.stats.cashPerWave;
  // 利息卡：按目前現金比例生息（上限避免滾雪球失控）
  if (s.mods.interest > 0) {
    s.cash += Math.min(s.cash * s.mods.interest, s.stats.cashPerWave * 10);
  }
  s.coinsEarned += waveCoinBonus(s.wave) * s.stats.coinBonus * coinMultiplier(s);
  s.wave++;
  if (isZoneEntryWaveCompat(s.wave)) {
    s.zoneMeter = 0;
    s.zonePulseTimer = zoneForWave(s.wave).mechanic.interval ?? 0;
  }
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

function isZoneEntryWaveCompat(wave: number): boolean {
  return zoneForWave(wave).id !== zoneForWave(Math.max(1, wave - 1)).id;
}

/** 屬性重算（升級/Perk 後呼叫）：血量上限提高時補差額，降低時夾回上限 */
function recomputeStats(s: SimState): void {
  const prevMax = s.stats.maxHealth;
  const next = computeStats(s.workshopLevels, s.inRunLevels, s.researchLevels);
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

  // 終極武器冷卻與限時效果
  for (const id in s.ultCooldowns) {
    if (s.ultCooldowns[id] > 0) s.ultCooldowns[id] = Math.max(0, s.ultCooldowns[id] - dt);
  }
  for (let i = s.ultActive.length - 1; i >= 0; i--) {
    s.ultActive[i].remaining -= dt;
    if (s.ultActive[i].remaining <= 0) s.ultActive.splice(i, 1);
  }

  s.towerHp = Math.min(s.towerHp + s.stats.healthRegen * dt, s.stats.maxHealth);

  const zone = zoneForWave(s.wave);
  if (zone.mechanic.kind === 'frost') s.zoneMeter = Math.min(zone.mechanic.value, s.zoneMeter + dt * 0.006);
  if (zone.mechanic.kind === 'magma') {
    s.zonePulseTimer -= dt;
    if (s.zonePulseTimer <= 0) {
      s.zonePulseTimer += zone.mechanic.interval ?? 8;
      const towerDmg = s.stats.maxHealth * zone.mechanic.value;
      s.towerHp -= towerDmg;
      s.events.push({ type: 'towerHit', dmg: towerDmg });
      s.events.push({ type: 'zonePulse', zoneId: zone.id, color: zone.accent });
      for (const e of [...s.enemies]) applyBurn(s, e, s.stats.damage * 0.16, 1);
    }
  }

  // 持續狀態傷害與凍結倒數。
  for (const e of [...s.enemies]) {
    if (e.burnTime > 0) {
      const burn = e.burnDps * dt;
      e.hp -= burn;
      e.burnTime -= dt;
      if (e.burnTime <= 0) { e.burnDps = 0; e.burnStacks = 0; }
      if (e.hp <= 0) killEnemy(s, e);
    }
    if (e.frozenTime > 0) e.frozenTime = Math.max(0, e.frozenTime - dt);
  }

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
      const frostSlow = e.frostStacks > 0 ? Math.max(0.55, 1 - e.frostStacks * 0.12) : 1;
      const frozen = e.frozenTime > 0 ? 0 : 1;
      const move = Math.min(e.speed * slow * frostSlow * frozen * dt, dist - standoff);
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
    if (zone.mechanic.kind === 'void') {
      e.zoneTimer -= dt;
      if (e.zoneTimer <= 0) {
        e.zoneTimer += zone.mechanic.interval ?? 4;
        const d = Math.hypot(e.x, e.y) || 1;
        const blink = Math.min(34, Math.max(0, d - standoff));
        e.x -= (e.x / d) * blink;
        e.y -= (e.y / d) * blink;
        s.events.push({ type: 'status', id: e.id, x: e.x, y: e.y, status: 'empower' });
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
  const cooldown = 1 / (s.stats.attackSpeed * (1 - s.zoneMeter));
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
      if (target.frozenTime > 0 && hasPerk(s.perks, 'brittle')) dmg *= 1.5;
      if (target.typeId === 'boss' && s.mods.bossDamageMult > 1) dmg *= s.mods.bossDamageMult;
      const zoneBonus = s.mods.zoneDamage[zoneForWave(s.wave).id] ?? 0;
      if (zoneBonus > 0) dmg *= 1 + zoneBonus;
      target.hp -= dmg;
      if (hasPerk(s.perks, 'incendiary')) {
        const stacks = b.crit && hasPerk(s.perks, 'volatileFuel') ? 2 : 1;
        const burnDps = dmg * 0.18 * (hasPerk(s.perks, 'volatileFuel') && b.crit ? s.stats.critFactor : 1);
        applyBurn(s, target, burnDps, stacks);
      }
      if (hasPerk(s.perks, 'cryoRounds')) applyFrost(s, target);
      s.events.push({ type: 'hit', id: target.id, x: target.x, y: target.y, dmg, crit: b.crit });
      s.bullets.splice(i, 1);
      const hx = target.x;
      const hy = target.y;
      if (target.hp <= 0) killEnemy(s, target);
      // 彈射卡：多重射擊——子彈鏈跳到最近的其他敵人（確定性：依距離、id 排序）
      if (s.mods.bounce > 0) {
        const bounceDmg = dmg * 0.6;
        const cands = s.enemies
          .filter((e) => e.id !== b.targetId)
          .map((e) => ({ e, d: (e.x - hx) * (e.x - hx) + (e.y - hy) * (e.y - hy) }))
          .sort((a, c) => a.d - c.d || a.e.id - c.e.id)
          .slice(0, s.mods.bounce);
        let px = hx;
        let py = hy;
        for (const { e } of cands) {
          // 鏈狀彈射動畫：從上一命中點連到這隻敵人
          s.events.push({ type: 'chain', x1: px, y1: py, x2: e.x, y2: e.y, crit: b.crit });
          px = e.x;
          py = e.y;
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
