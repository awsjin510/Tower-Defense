import { describe, expect, it } from 'vitest';
import { ZONES, ZONE_CONFIG, isZoneEntryWave, zoneForWave, zoneIndexForWave } from '../src/core/zones';
import { SCALING, WAVE_CONFIG, enemyCountForWave, enemyDmg, enemyHp, enemySpeed } from '../src/core/waves';
import { newRun, step, TICK_DT } from '../src/core/sim';

describe('zones', () => {
  it('資料表健全：4 個戰區、id 不重複、倍率皆為正、每 10 波切換', () => {
    expect(ZONES.length).toBe(4);
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length);
    expect(ZONE_CONFIG.zoneEvery).toBe(10);
    for (const z of ZONES) {
      expect(z.name.length).toBeGreaterThan(0);
      expect(z.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(z.mechanic.name.length).toBeGreaterThan(0);
      expect(z.mechanic.desc.length).toBeGreaterThan(0);
      expect(z.mechanic.value).toBeGreaterThan(0);
      for (const v of Object.values(z.mods)) expect(v).toBeGreaterThan(0);
    }
  });

  it('每 10 波切換戰區並循環', () => {
    expect(zoneIndexForWave(1)).toBe(0);
    expect(zoneIndexForWave(10)).toBe(0);
    expect(zoneIndexForWave(11)).toBe(1);
    expect(zoneIndexForWave(21)).toBe(2);
    expect(zoneIndexForWave(31)).toBe(3);
    expect(zoneIndexForWave(41)).toBe(0); // 循環回第一區
    expect(zoneForWave(15).id).toBe(ZONES[1].id);
  });

  it('進區時機：每區第一波（含 wave 1）', () => {
    expect(isZoneEntryWave(1)).toBe(true);
    expect(isZoneEntryWave(2)).toBe(false);
    expect(isZoneEntryWave(10)).toBe(false);
    expect(isZoneEntryWave(11)).toBe(true);
    expect(isZoneEntryWave(41)).toBe(true);
  });

  it('戰區倍率套用到敵人血量／速度／傷害', () => {
    // 波 11 落在第二區：與「無戰區倍率」的基準公式比較
    const wave = 11;
    const mods = zoneForWave(wave).mods;
    const baseHp = SCALING.baseHp * Math.pow(SCALING.hpGrowth, wave - 1);
    expect(enemyHp(wave, 1)).toBeCloseTo(baseHp * mods.hpMult);
    const baseSpeed = Math.min(SCALING.baseSpeed + SCALING.speedPerWave * (wave - 1), SCALING.maxSpeed);
    expect(enemySpeed(wave, 1)).toBeCloseTo(baseSpeed * mods.speedMult);
    const baseDmg = SCALING.baseDmg * Math.pow(SCALING.dmgGrowth, wave - 1);
    expect(enemyDmg(wave, 1)).toBeCloseTo(baseDmg * mods.dmgMult);
  });

  it('出怪量倍率生效且不超過上限', () => {
    // 第 31 波落在虛空深淵（countMult 1.2）
    const wave = 31;
    const mods = zoneForWave(wave).mods;
    expect(mods.countMult).toBeGreaterThan(1);
    const base = WAVE_CONFIG.baseCount + WAVE_CONFIG.countPerWave * (wave - 1);
    expect(enemyCountForWave(wave)).toBe(Math.min(Math.floor(base * mods.countMult), WAVE_CONFIG.maxCount));
    // 上限仍然有效
    expect(enemyCountForWave(999)).toBe(WAVE_CONFIG.maxCount);
  });

  it('加入戰區後模擬仍為確定性', () => {
    const a = newRun({}, 777);
    const b = newRun({}, 777);
    for (let i = 0; i < Math.floor(90 / TICK_DT); i++) {
      step(a, TICK_DT);
      step(b, TICK_DT);
      if (a.pendingPerks) {
        // 兩邊同步選第一個
        a.perks.push(a.pendingPerks[0]);
        a.pendingPerks = null;
        b.perks.push(b.pendingPerks![0]);
        b.pendingPerks = null;
      }
    }
    expect(a.cash).toBe(b.cash);
    expect(a.wave).toBe(b.wave);
    expect(a.kills).toBe(b.kills);
  });
});
