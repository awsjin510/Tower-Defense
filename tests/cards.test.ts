import { describe, expect, it } from 'vitest';
import { newRun, step, TICK_DT, type SimState } from '../src/core/sim';
import {
  CARDS,
  CARD_CONFIG,
  buildRunMods,
  cardById,
  cardValue,
  describeCard,
  emptyMods,
} from '../src/core/cards';
import { defaultSave, migrate, SAVE_VERSION } from '../src/meta/save';
import {
  buySlot,
  buyStarUp,
  cardStar,
  pruneEquipped,
  slotUnlockCost,
  starUpCost,
  syncCardUnlocks,
  toggleEquip,
} from '../src/meta/cards';

/** 打 seconds 秒（給滿血、不出 Perk 干擾），回傳終態 */
function runFor(s: SimState, seconds: number): void {
  const ticks = Math.floor(seconds / TICK_DT);
  for (let i = 0; i < ticks && !s.over; i++) {
    step(s, TICK_DT);
    if (s.pendingPerks) {
      s.perks.push(s.pendingPerks[0]);
      s.pendingPerks = null;
    }
  }
}

describe('cards data', () => {
  it('資料健全：id 不重複、圖示/顏色齊全、三類都有、效果數值為正', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    expect(CARDS.some((c) => c.cat === 'stat')).toBe(true);
    expect(CARDS.some((c) => c.cat === 'rule')).toBe(true);
    expect(CARDS.some((c) => c.cat === 'cond')).toBe(true);
    for (const c of CARDS) {
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(c.effect.perStar).toBeGreaterThan(0);
      expect(describeCard(c, 1).length).toBeGreaterThan(0);
    }
  });

  it('star 值線性、buildRunMods 正確歸類', () => {
    const as = cardById('as')!;
    expect(cardValue(as, 2)).toBeCloseTo(as.effect.perStar * 2);
    const mods = buildRunMods(['as', 'bounce', 'crit'], (id) => ({ as: 2, bounce: 3, crit: 1 } as Record<string, number>)[id] ?? 0);
    expect(mods.statMods.some((m) => m.stat === 'attackSpeed' && m.mult === 1 + as.effect.perStar * 2)).toBe(true);
    expect(mods.statMods.some((m) => m.stat === 'critChance' && m.add)).toBe(true);
    expect(mods.bounce).toBe(3);
  });
});

describe('cards save/meta', () => {
  it('存檔升到 v5：cards/equipped/cardSlots 補齊', () => {
    const old = { version: 4, coins: 10, workshopLevels: {}, bestWave: 3, totalRuns: 1, totalKills: 5, updatedAt: 1, coinRate: 0, lastSeenAt: 0, playerId: 'X' };
    const m = migrate(old);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.cards).toEqual({});
    expect(m.equipped).toEqual([]);
    expect(m.cardSlots).toBe(CARD_CONFIG.baseSlots);
  });

  it('里程碑解鎖：bestWave 達門檻自動給 1 星，不覆寫既有星級', () => {
    const save = defaultSave();
    save.bestWave = 0;
    const first = syncCardUnlocks(save);
    // unlockWave 0 的卡開場即解鎖
    const zeroCards = CARDS.filter((c) => c.unlockWave === 0).map((c) => c.id);
    for (const id of zeroCards) expect(cardStar(save, id)).toBe(1);
    expect(first).toEqual(expect.arrayContaining(zeroCards));
    // 已升星的卡不會被降回 1
    save.cards[zeroCards[0]] = 3;
    save.bestWave = 999;
    syncCardUnlocks(save);
    expect(cardStar(save, zeroCards[0])).toBe(3);
  });

  it('升星花金幣、達上限後不能再升', () => {
    const save = defaultSave();
    save.bestWave = 999;
    syncCardUnlocks(save);
    const id = CARDS[0].id;
    save.coins = 0;
    expect(buyStarUp(save, id)).toBe(false); // 沒錢
    save.coins = 1e9;
    expect(buyStarUp(save, id)).toBe(true); // 1→2
    expect(cardStar(save, id)).toBe(2);
    expect(buyStarUp(save, id)).toBe(true); // 2→3
    expect(cardStar(save, id)).toBe(CARD_CONFIG.starMax);
    expect(starUpCost(CARD_CONFIG.starMax)).toBeNull();
    expect(buyStarUp(save, id)).toBe(false); // 已 MAX
  });

  it('槽位：預設 2、解鎖需金幣、有上限', () => {
    const save = defaultSave();
    expect(save.cardSlots).toBe(2);
    save.coins = 1e12;
    let guard = 0;
    while (slotUnlockCost(save) !== null && guard++ < 20) expect(buySlot(save)).toBe(true);
    expect(save.cardSlots).toBe(CARD_CONFIG.maxSlots);
    expect(slotUnlockCost(save)).toBeNull();
    expect(buySlot(save)).toBe(false);
  });

  it('裝備：受槽數限制、未擁有不能裝、卸下可行；pruneEquipped 清理無效', () => {
    const save = defaultSave();
    save.bestWave = 999;
    syncCardUnlocks(save);
    save.cardSlots = 2;
    const owned = CARDS.filter((c) => cardStar(save, c.id) > 0).map((c) => c.id);
    expect(toggleEquip(save, owned[0])).toBe(true);
    expect(toggleEquip(save, owned[1])).toBe(true);
    // 第三張塞不進 2 槽
    expect(toggleEquip(save, owned[2])).toBe(false);
    expect(save.equipped.length).toBe(2);
    // 卸下
    expect(toggleEquip(save, owned[0])).toBe(false);
    expect(save.equipped.length).toBe(1);
    // 星級歸零後 prune 會移除
    save.cards[owned[1]] = 0;
    pruneEquipped(save);
    expect(save.equipped.includes(owned[1])).toBe(false);
  });
});

describe('cards effects in sim', () => {
  it('無裝備時與空 mods 行為一致（確定性、不影響既有平衡）', () => {
    const a = newRun({}, 555);
    const b = newRun({}, 555, emptyMods());
    runFor(a, 40);
    runFor(b, 40);
    expect(a.cash).toBe(b.cash);
    expect(a.kills).toBe(b.kills);
    expect(a.towerHp).toBe(b.towerHp);
  });

  it('數值卡（攻擊速度）確實提升開場攻速', () => {
    const base = newRun({}, 1);
    const withCard = newRun({}, 1, buildRunMods(['as'], () => 3));
    expect(withCard.stats.attackSpeed).toBeGreaterThan(base.stats.attackSpeed);
  });

  it('吸血卡：擊殺後回血', () => {
    const mods = buildRunMods(['lifesteal'], () => 3);
    const s = newRun({}, 3, mods);
    s.towerHp = 10;
    // 造一隻低血敵人並用彈丸擊殺
    s.enemies.push({
      id: 5000, typeId: 'normal', x: 40, y: 0, hp: 1, maxHp: 1, speed: 0, dmg: 0,
      cashValue: 1, coinValue: 0, radius: 9, attackTimer: 0, attackRange: 0, summonEvery: 0, summonTimer: 0,
    });
    s.bullets.push({ x: 40, y: 0, targetId: 5000, speed: 460, dmg: 999, crit: false });
    const before = s.towerHp;
    step(s, TICK_DT);
    expect(s.kills).toBe(1);
    expect(s.towerHp).toBeGreaterThan(before);
  });

  it('彈射卡：一發子彈同時傷及鄰近敵人', () => {
    const mods = buildRunMods(['bounce'], () => 2); // 彈射 2 個額外目標
    const s = newRun({}, 3, mods);
    const mk = (id: number, x: number) => ({
      id, typeId: 'normal', x, y: 0, hp: 1000, maxHp: 1000, speed: 0, dmg: 0,
      cashValue: 1, coinValue: 0, radius: 9, attackTimer: 0, attackRange: 0, summonEvery: 0, summonTimer: 0,
    });
    s.enemies.push(mk(1, 40), mk(2, 46), mk(3, 52));
    s.bullets.push({ x: 40, y: 0, targetId: 1, speed: 460, dmg: 100, crit: false });
    step(s, TICK_DT);
    // 主目標吃滿、鄰近兩隻吃 60%
    expect(s.enemies.find((e) => e.id === 1)!.hp).toBeLessThan(1000);
    expect(s.enemies.find((e) => e.id === 2)!.hp).toBeLessThan(1000);
    expect(s.enemies.find((e) => e.id === 3)!.hp).toBeLessThan(1000);
  });

  it('頭目剋星卡：對頭目傷害加成', () => {
    const mk = (mods: ReturnType<typeof emptyMods>) => {
      const s = newRun({}, 3, mods);
      s.enemies.push({
        id: 1, typeId: 'boss', x: 40, y: 0, hp: 1e9, maxHp: 1e9, speed: 0, dmg: 0,
        cashValue: 1, coinValue: 0, radius: 22, attackTimer: 0, attackRange: 0, summonEvery: 0, summonTimer: 0,
      });
      s.bullets.push({ x: 40, y: 0, targetId: 1, speed: 460, dmg: 100, crit: false });
      step(s, TICK_DT);
      return 1e9 - s.enemies[0].hp;
    };
    const plain = mk(emptyMods());
    const boosted = mk(buildRunMods(['bossbane'], () => 2));
    expect(boosted).toBeGreaterThan(plain);
  });

  it('裝備強力卡組的一場，波數不低於裸裝（不會反而變弱）', () => {
    const loadout = buildRunMods(['as', 'hp', 'crit'], () => 3);
    const bare = newRun({}, 202);
    const carded = newRun({}, 202, loadout);
    runFor(bare, 400);
    runFor(carded, 400);
    expect(carded.wave).toBeGreaterThanOrEqual(bare.wave);
  });
});
