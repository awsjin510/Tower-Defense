import type { BossArchetype, Bullet, DamageSource, EliteAffix, Enemy, RouteId, SimEvent, Stats, TargetPriority } from './types';
import { computeStats, IN_RUN_UPGRADES, type Levels } from './stats';
import { upgradeCost, isMaxed } from './economy';
import { applyPerks, hasPerk, isPerkWave, PERK_CONFIG, rerollCost, rollPerkChoices } from './perks';
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
import { tierMods } from './tiers';

export const TICK_DT = 1 / 30;
export const ARENA_RADIUS = 330;
export const WORLD_SIZE = ARENA_RADIUS * 2 + 60;
export const TOWER_RADIUS = 22;
const ENEMY_ATTACK_INTERVAL = 1.0;
export const TARGET_PRIORITIES: TargetPriority[] = ['closest', 'farthest', 'highHp', 'lowHp', 'elite', 'ranged'];
export const ROUTES: Record<RouteId, { name: string; desc: string; hp: number; dmg: number; reward: number }> = {
  safe: { name: '穩定航道', desc: '敵人 -10% HP／傷害，獎勵 -10%', hp: 0.9, dmg: 0.9, reward: 0.9 },
  danger: { name: '危險裂隙', desc: '敵人 +25% HP、+15% 傷害，獎勵 +50%', hp: 1.25, dmg: 1.15, reward: 1.5 },
  anomaly: { name: '異常星雲', desc: '敵人 +10% HP、更多詞綴，獎勵 +25%', hp: 1.1, dmg: 1, reward: 1.25 },
};
export const ELITE_AFFIXES: EliteAffix[] = ['shielded', 'regenerating', 'enraged', 'stealth', 'volatile', 'healer', 'reflective', 'blinking'];
export const BOSS_ARCHETYPES: BossArchetype[] = ['swarm', 'bulwark', 'leech', 'chrono'];
export const bossArchetypeForWave = (wave: number): BossArchetype => BOSS_ARCHETYPES[Math.max(0, Math.floor(wave / 10) - 1) % BOSS_ARCHETYPES.length];

export interface SimState {
  wave: number;
  time: number;
  cash: number;
  coinsEarned: number;
  kills: number;
  towerHp: number;
  shieldHp: number;
  stats: Stats;
  inRunLevels: Levels;
  workshopLevels: Levels;
  researchLevels: Levels;
  /** 難度 Tier（全域敵人倍率）；T1 = 基準 */
  tier: number;
  enemies: Enemy[];
  bullets: Bullet[];
  spawnList: string[];
  spawnIdx: number;
  spawnTimer: number;
  /** 目前可見戰場的世界座標半寬／半高；敵人從矩形螢幕邊界進場。 */
  spawnHalfWidth: number;
  spawnHalfHeight: number;
  spawnRectangular: boolean;
  interWaveTimer: number;
  attackTimer: number;
  targetPriority: TargetPriority;
  activeRoute: RouteId;
  pendingRoute: boolean;
  bossSlowTimer: number;
  damageBreakdown: Record<DamageSource, number>;
  damageTaken: number;
  lastDamageSource: string;
  over: boolean;
  rng: () => number;
  nextEnemyId: number;
  /** 本場已取得的 Perk（死亡歸零，與場內升級同生命週期）；可重複代表疊層 */
  perks: string[];
  /** 待選擇的 Perk 三選一；非 null 時模擬暫停，等 choosePerk() */
  pendingPerks: string[] | null;
  /** 本次三選一已重骰次數（決定下次重骰花費），選定/跳過時歸零 */
  perkRerolls: number;
  /** 觸發式 Perk 的即時狀態 */
  shotCount: number;
  killStreak: number;
  killStreakTimer: number;
  novaTimer: number;
  shieldTimer: number;
  shieldReady: boolean;
  apexKills: number;
  /** 軌道衛星：目前繞行角度與開火倒數 */
  satAngle: number;
  satTimer: number;
  /** 本場裝備卡片組出的加成（整場固定） */
  mods: RunMods;
  /** 本場可用的終極武器（已解析等級參數） */
  ultimates: ResolvedUltimate[];
  /** 各終極武器的剩餘冷卻秒數（0 = 可施放） */
  ultCooldowns: Record<string, number>;
  ultCharge: Record<string, number>;
  ultUses: Record<string, number>;
  ultDamage: Record<string, number>;
  ultCoins: Record<string, number>;
  /** 進行中的限時終極效果（黃金塔） */
  ultActive: Array<{ id: string; remaining: number; coinMult: number; kills?: number }>;
  blackHole: { remaining: number; x: number; y: number; damage: number } | null;
  orbital: { remaining: number; pulse: number; damage: number; x: number; y: number; warning: number } | null;
  timeFreezeTimer: number;
  battleTimeline: Array<{ time: number; wave: number; text: string }>;
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
  ultimates: ResolvedUltimate[] = [],
  tier = 1
): SimState {
  const inRunLevels: Levels = {};
  const stats = computeStats(workshopLevels, inRunLevels, researchLevels);
  // 開局定義卡：自帶 Perk（規則型，無屬性影響）與起始現金
  const startPerks = [...mods.startPerks];
  applyPerks(stats, startPerks);
  applyCardStatMods(stats, mods.statMods);
  const rng = mulberry32(seed);
  return {
    wave: 1,
    time: 0,
    cash: mods.startCash,
    coinsEarned: 0,
    kills: 0,
    towerHp: stats.maxHealth,
    shieldHp: stats.energyShield,
    stats,
    inRunLevels,
    workshopLevels,
    researchLevels,
    tier,
    enemies: [],
    bullets: [],
    spawnList: waveComposition(1, rng),
    spawnIdx: 0,
    spawnTimer: 0.5,
    spawnHalfWidth: ARENA_RADIUS,
    spawnHalfHeight: ARENA_RADIUS,
    spawnRectangular: false,
    interWaveTimer: 0,
    attackTimer: 0,
    targetPriority: 'closest',
    activeRoute: 'safe',
    pendingRoute: false,
    bossSlowTimer: 0,
    damageBreakdown: { direct: 0, burn: 0, chain: 0, splash: 0, bounce: 0, thorns: 0, ultimate: 0, satellite: 0 },
    damageTaken: 0,
    lastDamageSource: '未知威脅',
    over: false,
    rng,
    nextEnemyId: 1,
    perks: startPerks,
    pendingPerks: null,
    perkRerolls: 0,
    shotCount: 0,
    killStreak: 0,
    killStreakTimer: 0,
    novaTimer: 12,
    shieldTimer: 40,
    shieldReady: false,
    apexKills: 0,
    satAngle: 0,
    satTimer: 1.1,
    mods,
    ultimates,
    ultCooldowns: Object.fromEntries(ultimates.map((u) => [u.id, 0])),
    ultCharge: Object.fromEntries(ultimates.map((u) => [u.id, Math.min(40, (researchLevels.r_ultcharge ?? 0) * 5)])),
    ultUses: Object.fromEntries(ultimates.map((u) => [u.id, 0])),
    ultDamage: Object.fromEntries(ultimates.map((u) => [u.id, 0])),
    ultCoins: Object.fromEntries(ultimates.map((u) => [u.id, 0])),
    ultActive: [],
    blackHole: null,
    orbital: null,
    timeFreezeTimer: 0,
    battleTimeline: [],
    zoneMeter: 0,
    zonePulseTimer: zoneForWave(1).mechanic.interval ?? 0,
    events: [],
  };
}

/** 目前所有限時終極（黃金塔）疊乘出的金幣倍率 */
function coinMultiplier(s: SimState): number {
  let m = 1;
  for (const a of s.ultActive) m *= a.coinMult + Math.floor((a.kills ?? 0) / 10) * .25;
  return m;
}

/** 觸發式 Perk 疊到攻速上的倍率（殺意連鎖） */
function momentumMult(s: SimState): number {
  if (!hasPerk(s.perks, 'momentum')) return 1;
  return 1 + Math.min(s.killStreak * 0.03, 0.36);
}

/** 觸發式 Perk 疊到傷害上的即時倍率（腎上腺素、殲滅協議疊層） */
function combatDamageMult(s: SimState): number {
  let m = 1;
  if (hasPerk(s.perks, 'adrenaline') && s.towerHp <= s.stats.maxHealth * 0.3) m *= 1.55;
  if (hasPerk(s.perks, 'apex')) m *= 1 + s.apexKills * 0.005;
  return m;
}

const SAT_ORBIT = TOWER_RADIUS + 46;
const SAT_FIRE_CD = 1.1;

/** 穿透彈可再貫穿的敵人數（軌道砲大幅提升） */
function pierceCount(s: SimState): number {
  if (!hasPerk(s.perks, 'pierce')) return 0;
  return (hasPerk(s.perks, 'railgun') ? 5 : 2) + (s.timeFreezeTimer > 0 ? 3 : 0);
}

/** 多重射擊的額外目標數（多重射擊 +1、齊射再 +1） */
function multishotExtra(s: SimState): number {
  return (hasPerk(s.perks, 'multishot') ? 1 : 0) + (hasPerk(s.perks, 'volley') ? 1 : 0);
}

/** 產生一發追蹤子彈：套用精準節拍（每 4 發必爆）、即時傷害倍率與穿透設定 */
function fireBullet(s: SimState, target: Enemy, ox = 0, oy = 0): void {
  s.shotCount++;
  const forced = hasPerk(s.perks, 'precision') && s.shotCount % 4 === 0;
  const crit = forced || s.rng() < s.stats.critChance;
  const pierce = pierceCount(s);
  s.bullets.push({
    x: ox,
    y: oy,
    targetId: target.id,
    speed: s.stats.projectileSpeed,
    dmg: s.stats.damage * combatDamageMult(s) * (crit ? s.stats.critFactor : 1),
    crit,
    ...(pierce > 0 ? { pierce, hitIds: [], pierceRamp: hasPerk(s.perks, 'railgun') ? 0.15 : 0 } : {}),
  });
}

function damageEnemy(s: SimState, e: Enemy, raw: number, source: DamageSource, crit = false): number {
  let dmg = Math.max(0, raw);
  const absorbed = Math.min(e.affixShield ?? 0, dmg);
  e.affixShield = (e.affixShield ?? 0) - absorbed;
  dmg -= absorbed;
  const dealt = Math.min(e.hp, dmg);
  e.hp -= dmg;
  s.damageBreakdown[source] += dealt;
  if (raw > 0) s.events.push({ type: 'hit', id: e.id, x: e.x, y: e.y, dmg: dealt, crit });
  return dealt;
}

function damageTower(s: SimState, raw: number, source: string): number {
  const mitigated = Math.max(1, raw - s.stats.armor) * (1 - s.stats.damageReduction);
  const absorbed = Math.min(s.shieldHp, mitigated);
  s.shieldHp -= absorbed;
  const dealt = mitigated - absorbed;
  s.towerHp -= dealt;
  s.damageTaken += dealt;
  s.lastDamageSource = source;
  s.events.push({ type: 'towerHit', dmg: dealt });
  if (dealt > 0) chargeUltimates(s, Math.min(8, dealt / s.stats.maxHealth * 35));
  return dealt;
}

function chargeUltimates(s: SimState, amount: number): void {
  for (const u of s.ultimates) s.ultCharge[u.id] = Math.min(100, (s.ultCharge[u.id] ?? 0) + amount);
}

/**
 * 施放終極武器；成功回傳 true。冷卻中或未持有回傳 false。
 * 由 UI 在戰鬥中呼叫（headless 模擬不會施放，故不影響平衡）。
 */
export function activateUltimate(s: SimState, id: string, x = 0, y = 0): boolean {
  if (s.over || s.pendingPerks) return false;
  const ult = s.ultimates.find((u) => u.id === id);
  if (!ult) return false;
  if ((s.ultCooldowns[id] ?? 0) > 0 || (s.ultCharge[id] ?? 0) < 100) return false;
  s.ultCooldowns[id] = ult.cooldown;
  s.ultCharge[id] = 0;
  s.ultUses[id] = (s.ultUses[id] ?? 0) + 1;
  s.battleTimeline.push({ time: s.time, wave: s.wave, text: `施放 ${id}` });
  if (ult.kind === 'coinBuff') {
    s.ultActive.push({ id, remaining: ult.duration, coinMult: ult.coinMult, kills: 0 });
    s.events.push({ type: 'ultActivate', id, color: ult.color });
  } else if (ult.kind === 'blackhole') {
    const anchor = [...s.enemies].sort((a,b) => b.maxHp-a.maxHp)[0];
    s.blackHole = { remaining: ult.duration, x: anchor?.x ?? 0, y: anchor?.y ?? 0, damage: s.stats.damage * ult.damageMult };
    s.events.push({ type: 'ultActivate', id, color: ult.color });
  } else if (ult.kind === 'orbital') {
    s.orbital = { remaining: ult.duration, pulse: 0, damage: s.stats.damage * ult.damageMult, x, y, warning: 1.5 };
    s.events.push({ type: 'ultActivate', id, color: ult.color });
  } else {
    s.timeFreezeTimer = ult.duration + (s.towerHp < s.stats.maxHealth * .25 ? 2 : 0);
    s.events.push({ type: 'ultActivate', id, color: ult.color });
  }
  return true;
}

/** 依 Canvas 長寬更新可見世界邊界；只影響新敵人的出生位置。 */
export function setSpawnViewport(s: SimState, width: number, height: number): void {
  if (width <= 0 || height <= 0) return;
  const scale = Math.min(width, height) / WORLD_SIZE;
  s.spawnHalfWidth = Math.max(ARENA_RADIUS, width / (2 * scale));
  s.spawnHalfHeight = Math.max(ARENA_RADIUS, height / (2 * scale));
  s.spawnRectangular = true;
}

/** 在整個矩形畫面邊界均勻取一個出生點，而非固定圓周。 */
function randomScreenEdge(s: SimState, inset: number, roll: number): { x: number; y: number } {
  const halfW = Math.max(inset, s.spawnHalfWidth - inset);
  const halfH = Math.max(inset, s.spawnHalfHeight - inset);
  const width = halfW * 2;
  const height = halfH * 2;
  let p = roll * (width + height) * 2;
  if (p < width) return { x: -halfW + p, y: -halfH };
  p -= width;
  if (p < height) return { x: halfW, y: -halfH + p };
  p -= height;
  if (p < width) return { x: halfW - p, y: halfH };
  return { x: -halfW, y: halfH - (p - width) };
}

/** 建立敵人；不給座標時從螢幕矩形邊界進場（Boss 召喚會指定在 Boss 腳下）。 */
function makeEnemy(s: SimState, typeId: string, x?: number, y?: number): Enemy {
  const def = ENEMY_TYPES.find((t) => t.id === typeId)!;
  // 即使是 Boss 召喚（已有座標）也維持消耗一次 RNG，避免改變既有戰鬥隨機序列。
  const positionRoll = s.rng();
  const spawn = x === undefined || y === undefined
    ? s.spawnRectangular
      ? randomScreenEdge(s, def.radius * 0.5, positionRoll)
      : { x: Math.cos(positionRoll * Math.PI * 2) * ARENA_RADIUS, y: Math.sin(positionRoll * Math.PI * 2) * ARENA_RADIUS }
    : null;
  const tm = tierMods(s.tier); // 全域難度倍率
  const route = ROUTES[s.activeRoute];
  let hp = enemyHp(s.wave, def.hpMult) * tm.hp * route.hp;
  const bossArchetype = typeId === 'boss' ? bossArchetypeForWave(s.wave) : undefined;
  if (bossArchetype === 'bulwark') hp *= 1.25;
  const eliteAffix = typeId !== 'boss' && !['normal', 'fast'].includes(typeId) && s.wave >= 12 && s.rng() < (s.activeRoute === 'anomaly' ? .7 : .38)
    ? ELITE_AFFIXES[Math.floor(s.rng() * ELITE_AFFIXES.length)] : undefined;
  return {
    id: s.nextEnemyId++,
    typeId,
    x: x ?? spawn!.x,
    y: y ?? spawn!.y,
    hp,
    maxHp: hp,
    speed: enemySpeed(s.wave, def.speedMult),
    dmg: enemyDmg(s.wave, def.dmgMult) * tm.dmg * route.dmg,
    cashValue: enemyCash(s.wave, def.rewardMult) * tm.reward * route.reward,
    coinValue: enemyCoin(s.wave, def.rewardMult) * tm.reward * route.reward,
    radius: def.radius,
    attackTimer: 0,
    attackRange: def.attackRange ?? 0,
    summonEvery: bossArchetype === 'swarm' ? 4 : (def.summonEvery ?? 0),
    summonTimer: bossArchetype === 'swarm' ? 4 : (def.summonEvery ?? 0),
    burnDps: 0,
    burnTime: 0,
    burnStacks: 0,
    frostStacks: 0,
    frozenTime: 0,
    zoneTimer: zoneForWave(s.wave).mechanic.interval ?? 0,
    zoneEmpower: 1,
    canSplit: true,
    eliteAffix,
    affixTimer: 4,
    affixShield: eliteAffix === 'shielded' ? hp * .3 : bossArchetype === 'bulwark' ? hp * .35 : 0,
    affixTriggered: false,
    bossArchetype,
    bossPhase: 3,
  };
}

function spawnEnemy(s: SimState, typeId: string): void {
  s.enemies.push(makeEnemy(s, typeId));
}

function killEnemy(s: SimState, e: Enemy): void {
  const coinMult = coinMultiplier(s); // 黃金塔啟用時倍增
  const elite = !['normal', 'fast'].includes(e.typeId);
  const bounty = elite ? s.stats.eliteBounty * (e.typeId === 'boss' && (s.inRunLevels.eliteBounty ?? 0) >= 10 ? 1.25 : 1) : 1;
  const baseCoins = e.coinValue * s.stats.coinBonus * bounty;
  s.cash += e.cashValue * s.stats.cashPerKill * coinMult * bounty;
  s.coinsEarned += e.coinValue * s.stats.coinBonus * coinMult * bounty;
  if (coinMult > 1) s.ultCoins.golden = (s.ultCoins.golden ?? 0) + baseCoins * (coinMult - 1);
  s.kills++;
  if (s.stats.killHeal > 0) {
    const heal = s.stats.maxHealth * s.stats.killHeal * (elite && (s.inRunLevels.killHeal ?? 0) >= 10 ? 2 : 1);
    s.towerHp = Math.min(s.stats.maxHealth, s.towerHp + heal);
  }
  for (const a of s.ultActive) if (a.id === 'golden') a.kills = (a.kills ?? 0) + 1;
  chargeUltimates(s, e.typeId === 'boss' ? 25 : e.eliteAffix ? 5 : 1.6);
  // 觸發式 Perk：賞金爆裂（機率暴賞）、殲滅協議（永久傷害疊層）、殺意連鎖（連殺攻速）
  if (hasPerk(s.perks, 'bountyBurst') && s.rng() < 0.12) {
    s.cash += e.cashValue * s.stats.cashPerKill * coinMult * 3;
    s.events.push({ type: 'kill', x: e.x, y: e.y, typeId: 'coin' });
  }
  if (!e.golden && hasPerk(s.perks,'bountyBurst') && s.ultActive.some((a)=>a.id==='golden') && s.rng()<.08) {
    const golden=makeEnemy(s,'normal',e.x,e.y); golden.golden=true; golden.hp*=2; golden.maxHp=golden.hp; golden.coinValue*=8; golden.cashValue*=3; s.enemies.push(golden);
    s.events.push({type:'summon',x:e.x,y:e.y});
  }
  if (hasPerk(s.perks, 'apex')) s.apexKills++;
  if (hasPerk(s.perks, 'momentum')) {
    s.killStreak = Math.min(s.killStreak + 1, 12);
    s.killStreakTimer = 2;
  }
  const zone = zoneForWave(s.wave);
  if (zone.mechanic.kind === 'frost') s.zoneMeter = Math.max(0, s.zoneMeter - 0.055);
  // 吸血卡：擊殺回復血量上限的比例
  if (s.mods.lifestealFrac > 0) {
    s.towerHp = Math.min(s.towerHp + s.mods.lifestealFrac * s.stats.maxHealth, s.stats.maxHealth);
  }
  s.events.push({ type: 'kill', x: e.x, y: e.y, typeId: e.typeId });
  const i = s.enemies.indexOf(e);
  if (i >= 0) s.enemies.splice(i, 1);
  if (e.eliteAffix === 'volatile') damageTower(s, s.stats.maxHealth * .035, '爆裂菁英');

  // 燃燒流：死亡時把現有燃燒傳給附近三名敵人。
  if (hasPerk(s.perks, 'wildfire') && e.burnTime > 0) {
    const nearby = nearestEnemies(s, e.x, e.y, 3, e.id);
    for (const n of nearby) applyBurn(s, n, Math.max(e.burnDps * 0.7, s.stats.damage * 0.12), Math.max(1, e.burnStacks - 1));
  }
  // 冰凍流：凍結中的敵人死亡會引發碎冰範圍傷害。
  if (hasPerk(s.perks, 'shatter') && e.frozenTime > 0) {
    for (const n of nearestEnemies(s, e.x, e.y, 4, e.id).filter((n) => Math.hypot(n.x - e.x, n.y - e.y) <= 100)) {
      const dmg = s.stats.damage * 0.8;
      damageEnemy(s, n, dmg, 'splash');
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

  // 分裂體：死亡時分裂出數隻子體（子體為非分裂類型，不會無限分裂）
  const deadDef = ENEMY_TYPES.find((t) => t.id === e.typeId);
  if (deadDef?.splitInto && deadDef.splitInto > 0) {
    const childType = deadDef.splitType ?? 'fast';
    for (let k = 0; k < deadDef.splitInto; k++) {
      const a = (k / deadDef.splitInto) * Math.PI * 2 + s.rng();
      const child = makeEnemy(s, childType, e.x + Math.cos(a) * (e.radius + 6), e.y + Math.sin(a) * (e.radius + 6));
      child.hp *= 0.5;
      child.maxHp = child.hp;
      child.cashValue *= 0.35;
      child.coinValue *= 0.35;
      s.enemies.push(child);
    }
    s.events.push({ type: 'summon', x: e.x, y: e.y });
  }
}

/** 連鎖閃電：從命中點電弧跳附近敵人（超導體時弧數更多、對凍結敵人加倍） */
function chainLightning(s: SimState, sourceId: number, hx: number, hy: number): void {
  const arcs = hasPerk(s.perks, 'superconductor') ? 5 : 3;
  let px = hx;
  let py = hy;
  for (const e of nearestEnemies(s, hx, hy, arcs, sourceId)) {
    let d = s.stats.damage * 0.6;
    if (hasPerk(s.perks, 'superconductor') && e.frozenTime > 0) d *= 2;
    s.events.push({ type: 'chain', x1: px, y1: py, x2: e.x, y2: e.y, crit: true });
    px = e.x;
    py = e.y;
    damageEnemy(s, e, d, 'chain');
    if (e.hp <= 0) killEnemy(s, e);
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
  const interest = s.mods.interest + s.stats.interestRate;
  if (interest > 0) {
    const bossBoost = isBossWave(s.wave + 1) && (s.inRunLevels.interestRate ?? 0) >= 10 ? 2 : 1;
    s.cash += Math.min(s.cash * interest * bossBoost, s.stats.cashPerWave * 12);
  }
  s.coinsEarned += waveCoinBonus(s.wave) * s.stats.coinBonus * coinMultiplier(s) * tierMods(s.tier).reward;
  s.wave++;
  const shieldMilestone = (s.inRunLevels.maxHealth ?? 0) >= 20 ? s.stats.maxHealth * 0.1 : 0;
  s.shieldHp = Math.max(s.shieldHp, s.stats.energyShield + shieldMilestone);
  if (isZoneEntryWaveCompat(s.wave)) {
    s.zoneMeter = 0;
    s.zonePulseTimer = zoneForWave(s.wave).mechanic.interval ?? 0;
  }
  s.spawnList = waveComposition(s.wave, s.rng);
  s.spawnIdx = 0;
  s.spawnTimer = 0;
  s.events.push({ type: 'wave', wave: s.wave, boss: isBossWave(s.wave) });
  s.battleTimeline.push({time:s.time,wave:s.wave,text:isBossWave(s.wave)?'Boss 波開始':'新波次'});
  if (s.wave > 1 && (s.wave - 1) % 10 === 0) {
    s.pendingRoute = true;
    s.events.push({ type: 'routeOffer', wave: s.wave });
  }
  if (isPerkWave(s.wave)) {
    const choices = rollPerkChoices(s.perks, s.rng, PERK_CONFIG.choices + s.mods.extraPerkChoices, s.wave);
    if (choices.length > 0) {
      s.pendingPerks = choices;
      s.perkRerolls = 0;
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
  const prevShieldMax = s.stats.energyShield;
  const next = computeStats(s.workshopLevels, s.inRunLevels, s.researchLevels);
  applyPerks(next, s.perks);
  applyCardStatMods(next, s.mods.statMods);
  s.stats = next;
  if (next.maxHealth > prevMax) s.towerHp += next.maxHealth - prevMax;
  if (next.energyShield > prevShieldMax) s.shieldHp += next.energyShield - prevShieldMax;
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

  const regen = s.stats.healthRegen * dt;
  if (s.towerHp < s.stats.maxHealth) s.towerHp = Math.min(s.towerHp + regen, s.stats.maxHealth);
  else if ((s.inRunLevels.healthRegen ?? 0) >= 20) s.shieldHp = Math.min(s.shieldHp + regen * 0.5, s.stats.energyShield + s.stats.maxHealth * 0.15);

  // 觸發式 Perk 的計時效果
  if (hasPerk(s.perks, 'momentum') && s.killStreakTimer > 0) {
    s.killStreakTimer -= dt;
    if (s.killStreakTimer <= 0) s.killStreak = 0;
  }
  if (hasPerk(s.perks, 'frostNova')) {
    s.novaTimer -= dt;
    if (s.novaTimer <= 0) {
      s.novaTimer += 12;
      for (const e of s.enemies) {
        e.frozenTime = Math.max(e.frozenTime, 1.2);
        s.events.push({ type: 'status', id: e.id, x: e.x, y: e.y, status: 'frost' });
      }
    }
  }
  if (hasPerk(s.perks, 'lastStand') && !s.shieldReady) {
    s.shieldTimer -= dt;
    if (s.shieldTimer <= 0) {
      s.shieldTimer += 40;
      s.shieldReady = true;
    }
  }

  const zone = zoneForWave(s.wave);
  if (zone.mechanic.kind === 'frost') s.zoneMeter = Math.min(zone.mechanic.value, s.zoneMeter + dt * 0.006);
  if (zone.mechanic.kind === 'magma') {
    s.zonePulseTimer -= dt;
    if (s.zonePulseTimer <= 0) {
      s.zonePulseTimer += zone.mechanic.interval ?? 8;
      const towerDmg = s.stats.maxHealth * zone.mechanic.value;
      damageTower(s, towerDmg, '熔岩脈衝');
      s.events.push({ type: 'zonePulse', zoneId: zone.id, color: zone.accent });
      for (const e of [...s.enemies]) applyBurn(s, e, s.stats.damage * 0.16, 1);
    }
  }

  // 持續狀態傷害與凍結倒數。
  for (const e of [...s.enemies]) {
    if (e.burnTime > 0) {
      const burn = e.burnDps * dt;
      damageEnemy(s, e, burn, 'burn');
      e.burnTime -= dt;
      if (e.burnTime <= 0) { e.burnDps = 0; e.burnStacks = 0; }
      if (e.hp <= 0) killEnemy(s, e);
    }
    if (e.frozenTime > 0) e.frozenTime = Math.max(0, e.frozenTime - dt);
  }

  if (s.bossSlowTimer > 0) s.bossSlowTimer = Math.max(0, s.bossSlowTimer - dt);
  if (s.timeFreezeTimer > 0) s.timeFreezeTimer = Math.max(0, s.timeFreezeTimer - dt);
  if (s.blackHole) {
    s.blackHole.remaining -= dt;
    for (const e of s.enemies) {
      const dx=s.blackHole.x-e.x, dy=s.blackHole.y-e.y, d=Math.hypot(dx,dy)||1;
      const pull=Math.min(90*dt,d); e.x+=dx/d*pull; e.y+=dy/d*pull;
    }
    if (s.blackHole.remaining <= 0) {
      for (const e of [...s.enemies]) {
        let dmg=s.blackHole.damage;
        if (e.burnTime>0) { dmg += e.burnDps*e.burnTime; e.burnTime=0; }
        const dealt=damageEnemy(s,e,dmg,'ultimate',true); s.ultDamage.blackhole=(s.ultDamage.blackhole??0)+dealt;
        if(e.hp<=0) killEnemy(s,e);
      }
      s.events.push({type:'ultNuke',color:'#b878ff'}); s.blackHole=null;
    }
  }
  if (s.orbital) {
    s.orbital.warning-=dt;
    if(s.orbital.warning>0) { /* 雷射預警期間不落彈 */ }
    else { s.orbital.remaining -= dt; s.orbital.pulse -= dt; }
    if (s.orbital.warning<=0 && s.orbital.pulse<=0) {
      s.orbital.pulse += .35;
      const target=[...s.enemies].filter((e)=>(e.x-s.orbital!.x)**2+(e.y-s.orbital!.y)**2<150**2).sort((a,b)=>(Number(isElite(b))-Number(isElite(a)))||b.hp-a.hp)[0];
      if(target){let dealt=damageEnemy(s,target,s.orbital.damage,'ultimate',true);s.ultDamage.orbital=(s.ultDamage.orbital??0)+dealt;if(hasPerk(s.perks,'satellite')){dealt=damageEnemy(s,target,s.stats.damage*.8,'satellite');s.ultDamage.orbital+=dealt;}if(target.hp<=0)killEnemy(s,target);s.events.push({type:'ultNuke',color:'#ff7043'});}
    }
    if(s.orbital.remaining<=0)s.orbital=null;
  }
  for (const e of s.enemies) {
    if (e.eliteAffix === 'regenerating') e.hp = Math.min(e.maxHp, e.hp + e.maxHp * .008 * dt);
    if (e.eliteAffix === 'enraged' && !e.affixTriggered && e.hp < e.maxHp * .4) {
      e.affixTriggered = true; e.speed *= 1.35; e.dmg *= 1.35;
      s.events.push({ type: 'status', id: e.id, x: e.x, y: e.y, status: 'empower' });
    }
    if (e.eliteAffix === 'healer') for (const n of s.enemies) {
      if (n !== e && (n.x - e.x) ** 2 + (n.y - e.y) ** 2 < 120 ** 2) n.hp = Math.min(n.maxHp, n.hp + n.maxHp * .006 * dt);
    }
    if (e.eliteAffix === 'blinking') {
      e.affixTimer -= dt;
      if (e.affixTimer <= 0) { e.affixTimer += 4; const d = Math.hypot(e.x, e.y) || 1; e.x -= e.x / d * 28; e.y -= e.y / d * 28; }
    }
    if (e.bossArchetype) {
      const phase = e.hp / e.maxHp > .7 ? 3 : e.hp / e.maxHp > .35 ? 2 : 1;
      if (phase < e.bossPhase) {
        e.bossPhase = phase; e.speed *= 1.12; e.dmg *= 1.12;
        s.battleTimeline.push({time:s.time,wave:s.wave,text:`Boss 進入階段 ${phase}`});
        if (e.bossArchetype === 'bulwark') e.affixShield += e.maxHp * .15;
        s.events.push({ type: 'status', id: e.id, x: e.x, y: e.y, status: 'empower' });
      }
      if (e.bossArchetype === 'chrono') {
        e.affixTimer -= dt;
        if (e.affixTimer <= 0) { e.affixTimer += 5; s.bossSlowTimer = 2.5; }
      }
    }
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

  // 護盾兵光環：治療範圍內的同伴，強迫玩家優先擊殺護盾兵
  const protectors = s.enemies.filter((e) => {
    const d = ENEMY_TYPES.find((t) => t.id === e.typeId);
    return d?.auraHeal && d.auraHeal > 0;
  });
  for (const p of protectors) {
    const d = ENEMY_TYPES.find((t) => t.id === p.typeId)!;
    const radSq = (d.auraRadius ?? 120) ** 2;
    const heal = (d.auraHeal ?? 0) * dt;
    for (const e of s.enemies) {
      if (e === p || e.hp >= e.maxHp) continue;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 <= radSq) {
        e.hp = Math.min(e.maxHp, e.hp + heal * e.maxHp);
      }
    }
  }

  // 敵人移動與攻擊（遠程敵人走到 attackRange 就停下開火；近戰貼塔）
  const summoned: Enemy[] = [];
  for (const e of s.enemies) {
    const dist = Math.hypot(e.x, e.y);
    const contact = TOWER_RADIUS + e.radius;
    const standoff = Math.max(contact, e.attackRange);
    if (dist > standoff) {
      // 慢速靈氣卡：射程內的敵人減速
      const milestoneSlow = (s.inRunLevels.range ?? 0) >= 10 ? 0.08 : 0;
      const slow = dist <= s.stats.range ? 1 - Math.min(s.mods.slowAura + milestoneSlow, 0.7) : 1;
      const frostSlow = e.frostStacks > 0 ? Math.max(0.55, 1 - e.frostStacks * 0.12) : 1;
      const frozen = e.frozenTime > 0 || s.timeFreezeTimer > 0 ? 0 : 1;
      const greedSpeed = s.ultActive.some((a)=>a.id==='golden') ? 1.15 : 1;
      const move = Math.min(e.speed * slow * frostSlow * frozen * greedSpeed * dt, dist - standoff);
      e.x -= (e.x / dist) * move;
      e.y -= (e.y / dist) * move;
      e.attackTimer = 0;
    } else if (s.timeFreezeTimer <= 0) {
      e.attackTimer -= dt;
      if (e.attackTimer <= 0) {
        damageTower(s, e.dmg, e.bossArchetype ? `${e.bossArchetype} Boss` : (e.eliteAffix ? `${e.eliteAffix} 菁英` : e.typeId));
        if (e.attackRange > 0) s.events.push({ type: 'enemyShot', x: e.x, y: e.y });
        // 吸血菁英：攻擊塔時回復自身血量
        const eDef = ENEMY_TYPES.find((t) => t.id === e.typeId);
        if (eDef?.lifesteal && e.hp < e.maxHp) {
          e.hp = Math.min(e.maxHp, e.hp + eDef.lifesteal * e.maxHp);
          s.events.push({ type: 'status', id: e.id, x: e.x, y: e.y, status: 'empower' });
        }
        if (e.bossArchetype === 'leech') e.hp = Math.min(e.maxHp, e.hp + e.maxHp * .08);
        // 荊棘反傷卡：近戰攻擊者受到一部分傷害反彈
        const thorns = s.mods.thorns + s.stats.thorns;
        const canReflect = e.attackRange === 0 || (s.inRunLevels.thorns ?? 0) >= 10;
        if (thorns > 0 && canReflect) {
          damageEnemy(s, e, e.dmg * thorns, 'thorns');
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
  const cooldown = 1 / (s.stats.attackSpeed * momentumMult(s) * (1 - s.zoneMeter) * (s.bossSlowTimer > 0 ? .6 : 1));
  s.attackTimer -= dt;
  while (s.attackTimer <= 0) {
    const target = selectTarget(s, s.enemies.filter((e) => e.x * e.x + e.y * e.y <= s.stats.range * s.stats.range && (e.eliteAffix !== 'stealth' || Math.hypot(e.x, e.y) <= s.stats.range * .62)));
    if (!target) {
      s.attackTimer = 0;
      break;
    }
    fireBullet(s, target);
    // 攻速里程碑：每第 5 發免費追加一發。
    if ((s.inRunLevels.attackSpeed ?? 0) >= 20 && s.shotCount % 5 === 0) fireBullet(s, target);
    // 多重射擊：同時攻擊其餘最近的敵人
    const extra = multishotExtra(s);
    if (extra > 0) {
      for (const e of nearestEnemies(s, 0, 0, extra, target.id)) fireBullet(s, e);
    }
    // 雙重射擊：機率立刻追加一發（不佔冷卻）
    if (hasPerk(s.perks, 'doubleTap') && s.rng() < 0.14) fireBullet(s, target);
    s.events.push({ type: 'fire', angle: Math.atan2(target.y, target.x) });
    s.attackTimer += cooldown;
  }

  // 軌道衛星：繞塔飛行、週期自動對最近敵人開火
  if (hasPerk(s.perks, 'satellite')) {
    s.satAngle += dt * 1.7;
    s.satTimer -= dt;
    if (s.satTimer <= 0) {
      const sx = Math.cos(s.satAngle) * SAT_ORBIT;
      const sy = Math.sin(s.satAngle) * SAT_ORBIT;
      let tgt: Enemy | null = null;
      let best = Infinity;
      for (const e of s.enemies) {
        const d = (e.x - sx) ** 2 + (e.y - sy) ** 2;
        if (d < best) { best = d; tgt = e; }
      }
      if (tgt) {
        s.satTimer += SAT_FIRE_CD;
        s.bullets.push({ x: sx, y: sy, targetId: tgt.id, speed: s.stats.projectileSpeed, dmg: s.stats.damage * 0.7, crit: false, source: 'satellite' });
        s.events.push({ type: 'fire', angle: Math.atan2(tgt.y - sy, tgt.x - sx) });
      } else {
        s.satTimer = 0;
      }
    }
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
      // 命中傷害套用條件卡與觸發式 Perk：破甲、巨獸殺手、頭目剋星、脆化、戰區傷害
      let dmg = b.dmg;
      const armored = target.typeId === 'tank' || target.typeId === 'protector' || target.typeId === 'boss';
      if (armored) dmg *= 1 + s.stats.armorPen * 0.6;
      const elite = !['normal', 'fast'].includes(target.typeId);
      if (elite) dmg *= s.stats.eliteDamage;
      if (hasPerk(s.perks, 'armorBreak') && target.hp >= target.maxHp) dmg *= 1.45;
      if (hasPerk(s.perks, 'giantSlayer') && (target.typeId === 'boss' || target.summonEvery > 0)) dmg *= 1.5;
      if (target.frozenTime > 0 && hasPerk(s.perks, 'brittle')) dmg *= 1.5;
      if (target.typeId === 'boss' && s.mods.bossDamageMult > 1) dmg *= s.mods.bossDamageMult;
      const zoneBonus = s.mods.zoneDamage[zoneForWave(s.wave).id] ?? 0;
      if (zoneBonus > 0) dmg *= 1 + zoneBonus;
      damageEnemy(s, target, dmg, b.source ?? 'direct', b.crit);
      if (target.eliteAffix === 'reflective') damageTower(s, Math.min(dmg * .08, s.stats.maxHealth * .025), '反射菁英');
      // 處決者：血量落入門檻直接了結（頭目門檻較低）
      if (target.hp > 0 && hasPerk(s.perks, 'execute')) {
        const thr = target.typeId === 'boss' ? 0.04 : 0.12;
        if (target.hp <= target.maxHp * thr) target.hp = 0;
      }
      if (hasPerk(s.perks, 'incendiary')) {
        const stacks = b.crit && hasPerk(s.perks, 'volatileFuel') ? 2 : 1;
        const burnDps = dmg * 0.18 * s.stats.elementalPower * (hasPerk(s.perks, 'volatileFuel') && b.crit ? s.stats.critFactor : 1);
        applyBurn(s, target, burnDps, stacks);
      }
      if (hasPerk(s.perks, 'cryoRounds')) applyFrost(s, target);
      if (s.stats.knockback > 0 && target.typeId !== 'boss') {
        const d = Math.hypot(target.x, target.y) || 1;
        const force = s.stats.knockback * ((s.inRunLevels.knockback ?? 0) >= 10 ? 1.5 : 1);
        target.x += (target.x / d) * force;
        target.y += (target.y / d) * force;
      }
      const hx = target.x;
      const hy = target.y;
      // 連鎖閃電：暴擊時電弧跳附近敵人
      if (b.crit && hasPerk(s.perks, 'chainLightning')) chainLightning(s, target.id, hx, hy);
      if (b.crit) chargeUltimates(s, .35);
      // 穿透彈：還能貫穿就續飛下一名（軌道砲每穿一名加成傷害），否則移除
      let removed = false;
      if (b.pierce && b.pierce > 0) {
        b.pierce--;
        (b.hitIds ??= []).push(target.id);
        if (b.pierceRamp) b.dmg *= 1 + b.pierceRamp;
        const next = s.enemies
          .filter((e) => e.id !== target.id && !b.hitIds!.includes(e.id))
          .map((e) => ({ e, d: (e.x - hx) ** 2 + (e.y - hy) ** 2 }))
          .sort((a, c) => a.d - c.d || a.e.id - c.e.id)[0];
        if (next) {
          b.x = hx;
          b.y = hy;
          b.targetId = next.e.id;
        } else {
          s.bullets.splice(i, 1);
          removed = true;
        }
      } else {
        s.bullets.splice(i, 1);
        removed = true;
      }
      if (target.hp <= 0) killEnemy(s, target);
      // 傷害里程碑：Lv.20 命中造成鄰近 35% 爆炸傷害。
      if ((s.inRunLevels.damage ?? 0) >= 20) {
        for (const n of nearestEnemies(s, hx, hy, 3, target.id).filter((n) => (n.x - hx) ** 2 + (n.y - hy) ** 2 <= 70 ** 2)) {
          const splash = s.stats.damage * 0.35;
          damageEnemy(s, n, splash, 'splash');
          if (n.hp <= 0) killEnemy(s, n);
        }
      }
      // 爆破彈藥：機率造成範圍傷害；Lv.10 專精提高半徑與倍率。
      if (s.stats.splashChance > 0 && s.rng() < s.stats.splashChance) {
        const specialized = (s.inRunLevels.splashChance ?? 0) >= 10;
        const radius = specialized ? 105 : 72;
        const splash = dmg * (specialized ? 0.5 : 0.32);
        for (const n of s.enemies.filter((n) => n.id !== target.id && (n.x - hx) ** 2 + (n.y - hy) ** 2 <= radius ** 2)) {
          damageEnemy(s, n, splash, 'splash');
          if (n.hp <= 0) killEnemy(s, n);
        }
      }
      // 彈射卡：子彈鏈跳到最近的其他敵人（穿透中只在最後一擊觸發，避免過度疊加）
      if (removed && s.mods.bounce > 0) {
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
          damageEnemy(s, e, bounceDmg, 'bounce');
          if (e.hp <= 0) killEnemy(s, e);
        }
      }
    } else {
      b.x += (dx / dist) * travel;
      b.y += (dy / dist) * travel;
    }
  }

  // 背水結界：致命傷害到來時消耗護盾，回到 25% 血量並重新充能
  if (s.towerHp <= 0 && s.shieldReady) {
    s.shieldReady = false;
    s.shieldTimer = 40;
    s.towerHp = s.stats.maxHealth * 0.25;
    s.events.push({ type: 'towerHit', dmg: 0 });
  }
  if (s.towerHp <= 0) {
    s.towerHp = 0;
    s.over = true;
    s.battleTimeline.push({time:s.time,wave:s.wave,text:`防線被 ${s.lastDamageSource} 擊破`});
  }
}

function isElite(e: Enemy): boolean {
  return !['normal', 'fast'].includes(e.typeId);
}

export function selectTarget(s: Pick<SimState, 'targetPriority'>, candidates: Enemy[]): Enemy | null {
  if (!candidates.length) return null;
  const dist = (e: Enemy) => e.x * e.x + e.y * e.y;
  const sorted = [...candidates].sort((a, b) => {
    switch (s.targetPriority) {
      case 'farthest': return dist(b) - dist(a) || a.id - b.id;
      case 'highHp': return b.hp - a.hp || dist(a) - dist(b) || a.id - b.id;
      case 'lowHp': return a.hp - b.hp || dist(a) - dist(b) || a.id - b.id;
      case 'elite': return Number(isElite(b)) - Number(isElite(a)) || dist(a) - dist(b) || a.id - b.id;
      case 'ranged': return Number(b.attackRange > 0) - Number(a.attackRange > 0) || dist(a) - dist(b) || a.id - b.id;
      default: return dist(a) - dist(b) || a.id - b.id;
    }
  });
  return sorted[0];
}

export function cycleTargetPriority(s: SimState): TargetPriority {
  const i = TARGET_PRIORITIES.indexOf(s.targetPriority);
  s.targetPriority = TARGET_PRIORITIES[(i + 1) % TARGET_PRIORITIES.length];
  return s.targetPriority;
}

export function chooseRoute(s: SimState, route: RouteId): boolean {
  if (!s.pendingRoute || !ROUTES[route]) return false;
  s.activeRoute = route;
  s.pendingRoute = false;
  return true;
}

/** 場內升級購買；成功時回傳 true。買血量上限會同步補血。 */
export function buyInRunUpgrade(s: SimState, upgradeId: string): boolean {
  const def = IN_RUN_UPGRADES.find((u) => u.id === upgradeId);
  if (!def || s.over) return false;
  const level = s.inRunLevels[upgradeId] ?? 0;
  if (isMaxed(def, level)) return false;
  const cost = inRunUpgradeCost(s, def, level);
  if (s.cash < cost) return false;
  // 免費升級機率：擲骰命中則不扣現金（chance=0 時不動用 RNG，保持既有確定性）
  const free = s.stats.freeUpgradeChance > 0 && s.rng() < s.stats.freeUpgradeChance;
  if (!free) s.cash -= cost;
  s.inRunLevels[upgradeId] = level + 1;
  recomputeStats(s);
  return true;
}

export function inRunUpgradeCost(s: Pick<SimState, 'stats'>, def: (typeof IN_RUN_UPGRADES)[number], level: number): number {
  return Math.max(1, Math.ceil(upgradeCost(def, level) * (1 - s.stats.upgradeDiscount)));
}

/** 從待選 Perk 中選一個；成功時回傳 true 並恢復模擬 */
export function choosePerk(s: SimState, perkId: string): boolean {
  if (!s.pendingPerks || !s.pendingPerks.includes(perkId)) return false;
  s.perks.push(perkId);
  s.pendingPerks = null;
  s.perkRerolls = 0;
  recomputeStats(s);
  return true;
}

/** 本次三選一的重骰花費（場內現金）；無待選時為 0 */
export function currentRerollCost(s: SimState): number {
  return s.pendingPerks ? rerollCost(s.perkRerolls) : 0;
}

/** 花現金重骰三選一；成功回傳 true。模擬維持暫停。 */
export function rerollPerks(s: SimState): boolean {
  if (!s.pendingPerks) return false;
  const cost = rerollCost(s.perkRerolls);
  if (s.cash < cost) return false;
  s.cash -= cost;
  s.perkRerolls++;
  s.pendingPerks = rollPerkChoices(s.perks, s.rng, PERK_CONFIG.choices + s.mods.extraPerkChoices, s.wave);
  return true;
}

/** 跳過三選一，改領一小筆現金（銀行利息式，帶上限）；成功回傳 true 並恢復模擬。 */
export function skipPerks(s: SimState): number {
  if (!s.pendingPerks) return 0;
  const reward = Math.min(Math.round(s.cash * PERK_CONFIG.skipRewardFrac), Math.round(s.stats.cashPerWave * 5));
  s.cash += reward;
  s.pendingPerks = null;
  s.perkRerolls = 0;
  return reward;
}
