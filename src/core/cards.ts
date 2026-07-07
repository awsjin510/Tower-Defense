import type { StatId, Stats } from './types';
import { ZONES } from './zones';
import { perkById } from './perks';
import cardsData from '../data/cards.json';

export type CardCategory = 'stat' | 'rule' | 'cond' | 'origin';
export type CardKind =
  | 'stat'
  | 'bounce'
  | 'slowAura'
  | 'thorns'
  | 'lifesteal'
  | 'interest'
  | 'bossDamage'
  | 'extraPerk'
  | 'zoneDamage'
  | 'startPerk'
  | 'startCash';

export interface CardEffect {
  kind: CardKind;
  /** kind='stat' 專用 */
  stat?: StatId;
  mode?: 'mult' | 'add';
  /** kind='zoneDamage' 專用 */
  zoneId?: string;
  /** kind='startPerk' 專用：開局自帶的 Perk id */
  perks?: string[];
  /** 每顆星的效果增量 */
  perStar: number;
}

/** 複合卡的附加效果：達到 atStar 星時生效（純數值卡 3★ 附帶小規則） */
export interface CardBonus {
  atStar: number;
  kind: CardKind;
  value?: number;
  stat?: StatId;
  mode?: 'mult' | 'add';
  perks?: string[];
  /** UI 顯示文字 */
  desc: string;
}

export interface CardDef {
  id: string;
  name: string;
  cat: CardCategory;
  icon: string;
  color: string;
  /** 歷史最高波次達到此值時自動解鎖（0 = 開場即有） */
  unlockWave: number;
  unlockTier?: number;
  unlockRuns?: number;
  unlockKills?: number;
  effect: CardEffect;
  /** 複合附加效果（達星生效） */
  bonus?: CardBonus;
  /** 套裝標籤：湊齊同套裝多張可觸發套裝加成 */
  set?: string;
}

export interface CardConfig {
  baseSlots: number;
  maxSlots: number;
  starMax: number;
  starUpCost: Record<string, number>;
  slotCost: Record<string, number>;
}

export const CARDS = cardsData.cards as CardDef[];
export const CARD_CONFIG = cardsData.config as CardConfig;

export function cardById(id: string): CardDef | undefined {
  return CARDS.find((c) => c.id === id);
}

/** 裝備卡片對本場模擬的所有加成（乘在升級/Perk 之後；規則效果由 sim 讀取） */
export interface RunMods {
  /** 數值卡：對屬性的乘法/加法修正 */
  statMods: Array<{ stat: StatId; mult?: number; add?: number }>;
  /** 子彈額外彈射目標數 */
  bounce: number;
  /** 射程內敵人減速比例（0..1） */
  slowAura: number;
  /** 近戰受擊反彈傷害比例 */
  thorns: number;
  /** 每次擊殺回復的血量（佔血量上限比例） */
  lifestealFrac: number;
  /** 每波按現金比例生息 */
  interest: number;
  /** 對頭目的傷害倍率（1 = 無加成） */
  bossDamageMult: number;
  /** Perk 三選一額外選項數 */
  extraPerkChoices: number;
  /** 特定戰區的額外傷害倍率加成：zoneId → 加成（0.25 = +25%） */
  zoneDamage: Record<string, number>;
  /** 開局自帶的 Perk（開局定義卡） */
  startPerks: string[];
  /** 開局起始現金（開局定義卡） */
  startCash: number;
}

export function emptyMods(): RunMods {
  return {
    statMods: [],
    bounce: 0,
    slowAura: 0,
    thorns: 0,
    lifestealFrac: 0,
    interest: 0,
    bossDamageMult: 1,
    extraPerkChoices: 0,
    zoneDamage: {},
    startPerks: [],
    startCash: 0,
  };
}

/** 套裝定義：湊齊同套裝的張數越多，加成越強（各層累加） */
export interface CardSet {
  id: string;
  name: string;
  members: string[];
  tiers: Array<{ n: number; desc: string; apply: (m: RunMods) => void }>;
}

export const CARD_SETS: CardSet[] = [
  {
    id: 'econ',
    name: '財閥',
    members: ['coin', 'interest', 'warchest'],
    tiers: [
      { n: 2, desc: '每波生息 +2%', apply: (m) => { m.interest += 0.02; } },
      { n: 3, desc: '金幣 +12%', apply: (m) => { m.statMods.push({ stat: 'coinBonus', mult: 1.12 }); } },
    ],
  },
  {
    id: 'slayer',
    name: '殺戮',
    members: ['crit', 'bossbane', 'lifesteal'],
    tiers: [
      { n: 2, desc: '傷害 +8%', apply: (m) => { m.statMods.push({ stat: 'damage', mult: 1.08 }); } },
      { n: 3, desc: '傷害再 +8%', apply: (m) => { m.statMods.push({ stat: 'damage', mult: 1.08 }); } },
    ],
  },
  {
    id: 'flame', name: '烈焰', members: ['emberstart', 'thermalcore', 'elemental'],
    tiers: [
      { n: 2, desc: '元素傷害 +18%', apply: (m) => { m.statMods.push({ stat: 'elementalPower', add: 0.18 }); } },
      { n: 3, desc: '傷害 +12%', apply: (m) => { m.statMods.push({ stat: 'damage', mult: 1.12 }); } },
    ],
  },
  {
    id: 'frost', name: '永凍', members: ['frostcore', 'glacialcore', 'slowaura'],
    tiers: [
      { n: 2, desc: '減速靈氣 +10%', apply: (m) => { m.slowAura += 0.1; } },
      { n: 3, desc: '元素傷害 +15%', apply: (m) => { m.statMods.push({ stat: 'elementalPower', add: 0.15 }); } },
    ],
  },
  {
    id: 'fortress', name: '堡壘', members: ['hp', 'armorplate', 'barrier'],
    tiers: [
      { n: 2, desc: '減傷 +8%', apply: (m) => { m.statMods.push({ stat: 'damageReduction', add: 0.08 }); } },
      { n: 3, desc: '護盾 +20%', apply: (m) => { m.statMods.push({ stat: 'energyShield', mult: 1.2 }); } },
    ],
  },
  {
    id: 'rail', name: '動能', members: ['penetrator', 'repulsor', 'range'],
    tiers: [
      { n: 2, desc: '彈速 +15%', apply: (m) => { m.statMods.push({ stat: 'projectileSpeed', mult: 1.15 }); } },
      { n: 3, desc: '精英傷害 +18%', apply: (m) => { m.statMods.push({ stat: 'eliteDamage', add: 0.18 }); } },
    ],
  },
  {
    id: 'tactician', name: '戰術', members: ['strategist', 'elitehunter', 'salvage'],
    tiers: [
      { n: 2, desc: '每殺金額 +12%', apply: (m) => { m.statMods.push({ stat: 'cashPerKill', mult: 1.12 }); } },
      { n: 3, desc: 'Perk 選項 +1', apply: (m) => { m.extraPerkChoices += 1; } },
    ],
  },
  { id: 'fusion', name: '熱電融合', members: ['thermalshock', 'stormcoil', 'thermalcore'], tiers: [
    { n: 2, desc: '元素傷害 +20%', apply: (m) => { m.statMods.push({ stat: 'elementalPower', add: .2 }); } },
    { n: 3, desc: '開局獲得超導體', apply: (m) => { m.startPerks.push('superconductor'); } },
  ] },
  { id: 'storm', name: '風暴網路', members: ['stormcoil', 'supercap', 'crit'], tiers: [
    { n: 2, desc: '暴擊率 +5%', apply: (m) => { m.statMods.push({ stat: 'critChance', add: .05 }); } },
    { n: 3, desc: '傷害 +15%', apply: (m) => { m.statMods.push({ stat: 'damage', mult: 1.15 }); } },
  ] },
  { id: 'orbit', name: '軌道艦隊', members: ['orbitaldock', 'twinorbit', 'voidanchor'], tiers: [
    { n: 2, desc: '彈速 +20%', apply: (m) => { m.statMods.push({ stat: 'projectileSpeed', mult: 1.2 }); } },
    { n: 3, desc: '開局獲得齊射', apply: (m) => { m.startPerks.push('volley'); } },
  ] },
];

/** 卡片在某星級的效果數值 */
export function cardValue(def: CardDef, star: number): number {
  return def.effect.perStar * star;
}

/** 把單一效果（主效果或附加效果）疊進 RunMods */
function applyEffect(
  mods: RunMods,
  e: { kind: CardKind; stat?: StatId; mode?: 'mult' | 'add'; zoneId?: string; perks?: string[] },
  value: number
): void {
  switch (e.kind) {
    case 'stat':
      if (e.stat) mods.statMods.push(e.mode === 'add' ? { stat: e.stat, add: value } : { stat: e.stat, mult: 1 + value });
      break;
    case 'bounce':
      mods.bounce += Math.round(value);
      break;
    case 'slowAura':
      mods.slowAura = Math.min(mods.slowAura + value, 0.6);
      break;
    case 'thorns':
      mods.thorns += value;
      break;
    case 'lifesteal':
      mods.lifestealFrac += value;
      break;
    case 'interest':
      mods.interest += value;
      break;
    case 'bossDamage':
      mods.bossDamageMult += value;
      break;
    case 'extraPerk':
      mods.extraPerkChoices += Math.round(value);
      break;
    case 'zoneDamage':
      if (e.zoneId) mods.zoneDamage[e.zoneId] = (mods.zoneDamage[e.zoneId] ?? 0) + value;
      break;
    case 'startPerk':
      if (e.perks) for (const p of e.perks) if (!mods.startPerks.includes(p)) mods.startPerks.push(p);
      break;
    case 'startCash':
      mods.startCash += value;
      break;
  }
}

/** 目前裝備觸發的套裝與各層加成（供 UI 顯示） */
export function activeSets(equipped: string[], starOf: (id: string) => number): Array<{ set: CardSet; count: number; tiers: string[] }> {
  const owned = equipped.filter((id) => starOf(id) > 0);
  const out: Array<{ set: CardSet; count: number; tiers: string[] }> = [];
  for (const set of CARD_SETS) {
    const count = set.members.filter((id) => owned.includes(id)).length;
    if (count < 2) continue;
    const tiers = set.tiers.filter((t) => count >= t.n).map((t) => t.desc);
    out.push({ set, count, tiers });
  }
  return out;
}

/** 由「已裝備卡片 + 各卡星級」組出本場加成。starOf 回傳 0 代表未裝備/未擁有。 */
export function buildRunMods(equipped: string[], starOf: (id: string) => number): RunMods {
  const mods = emptyMods();
  for (const id of equipped) {
    const def = cardById(id);
    const star = starOf(id);
    if (!def || star <= 0) continue;
    applyEffect(mods, def.effect, cardValue(def, star));
    // 複合附加效果：達星生效（純數值卡 3★ 的小規則、開局卡的代價）
    if (def.bonus && star >= def.bonus.atStar) {
      applyEffect(mods, def.bonus, def.bonus.value ?? 0);
    }
  }
  // 套裝加成：湊齊同套裝多張時觸發
  for (const { set, count } of activeSets(equipped, starOf)) {
    for (const t of set.tiers) if (count >= t.n) t.apply(mods);
  }
  return mods;
}

/** 把數值卡的屬性修正套到屬性上（在升級與 Perk 之後） */
export function applyCardStatMods(stats: Stats, statMods: RunMods['statMods']): void {
  for (const m of statMods) {
    if (m.add) stats[m.stat] += m.add;
    if (m.mult) stats[m.stat] *= m.mult;
  }
  stats.critChance = Math.min(stats.critChance, 0.8);
  stats.damageReduction = Math.min(stats.damageReduction, 0.65);
  stats.armorPen = Math.min(stats.armorPen, 0.8);
}

function perkNames(ids: string[] = []): string {
  return ids.map((id) => perkById(id)?.name ?? id).join('、');
}

/** 卡片在某星級的效果文字（0 星時顯示 1 星預覽） */
export function describeCard(def: CardDef, star: number): string {
  const s = Math.max(star, 1);
  const v = cardValue(def, s);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  switch (def.effect.kind) {
    case 'stat':
      if (['armor', 'energyShield', 'knockback', 'projectileSpeed'].includes(def.effect.stat ?? '')) return `${def.name} +${Math.round(v)}`;
      return `${def.name} +${pct(v)}`;
    case 'bounce':
      return `子彈彈射 +${Math.round(v)} 目標`;
    case 'slowAura':
      return `射程內敵人減速 ${pct(Math.min(v, 0.6))}`;
    case 'thorns':
      return `近戰反彈 ${pct(v)} 傷害`;
    case 'lifesteal':
      return `擊殺回復 ${pct(v)} 血量上限`;
    case 'interest':
      return `每波生息 +${pct(v)} 現金`;
    case 'bossDamage':
      return `對頭目傷害 +${pct(v)}`;
    case 'extraPerk':
      return `Perk 選項 +${Math.round(v)}`;
    case 'zoneDamage': {
      const zone = ZONES.find((z) => z.id === def.effect.zoneId);
      return `${zone?.name ?? '特定戰區'}傷害 +${pct(v)}`;
    }
    case 'startPerk':
      return `開局自帶：${perkNames(def.effect.perks)}`;
    case 'startCash':
      return `開局 +${Math.round(v)} 現金`;
  }
}

/** 複合附加效果的顯示文字（無則回傳 null） */
export function describeBonus(def: CardDef): string | null {
  if (!def.bonus) return null;
  return `${def.bonus.atStar}★：${def.bonus.desc}`;
}
