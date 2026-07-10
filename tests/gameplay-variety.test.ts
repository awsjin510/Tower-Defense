import { describe, expect, it } from 'vitest';
import {
  ROUTES,
  activateTactic,
  activeSynergies,
  buyInRunUpgrade,
  chooseRoute,
  chooseSpecialization,
  newRun,
  selectTarget,
} from '../src/core/sim';
import type { Enemy } from '../src/core/types';

function enemy(id: number, typeId: string, x: number, attackRange = 0): Enemy {
  return {
    id, typeId, x, y: 0, hp: 100, maxHp: 100, speed: 0, dmg: 0,
    cashValue: 0, coinValue: 0, radius: 9, attackTimer: 999, attackRange,
    summonEvery: 0, summonTimer: 0, burnDps: 0, burnTime: 0, burnStacks: 0,
    frostStacks: 0, frozenTime: 0, zoneTimer: 999, zoneEmpower: 1, canSplit: true,
  };
}

describe('gameplay variety systems', () => {
  it('route decision resumes a queued perk decision and includes distinct forecasts', () => {
    const s = newRun({}, 1);
    s.pendingRoute = true;
    s.queuedPerks = ['sharp', 'rapid'];
    expect(chooseRoute(s, 'swarm')).toBe(true);
    expect(s.pendingRoute).toBe(false);
    expect(s.pendingPerks).toEqual(['sharp', 'rapid']);
    expect(ROUTES.swarm.count).toBeGreaterThan(ROUTES.armored.count);
  });

  it('level 10 unlocks one mutually exclusive specialization', () => {
    const s = newRun({}, 2);
    s.cash = 1e12;
    s.inRunLevels.damage = 9;
    expect(buyInRunUpgrade(s, 'damage')).toBe(true);
    expect(s.pendingSpecialization).toBe('attack');
    expect(chooseSpecialization(s, 'blast')).toBe(true);
    expect(s.specializations.attack).toBe('blast');
    s.pendingSpecialization = 'attack';
    expect(chooseSpecialization(s, 'rapid')).toBe(false);
  });

  it('core tactics consume energy and change the battlefield', () => {
    const s = newRun({}, 3);
    const target = enemy(1, 'normal', 80);
    s.enemies = [target];
    s.coreEnergy = 100;
    expect(activateTactic(s, 'pulse')).toBe(true);
    expect(s.coreEnergy).toBe(65);
    expect(target.x).toBeGreaterThan(80);
    expect(activateTactic(s, 'repair')).toBe(false);
  });

  it('support targeting prioritizes disruptors over closer fodder', () => {
    const fodder = enemy(1, 'normal', 20);
    const jammer = enemy(2, 'jammer', 90, 118);
    expect(selectTarget({ targetPriority: 'support' }, [fodder, jammer])).toBe(jammer);
  });

  it('completed perk chains expose named synergies', () => {
    const s = newRun({}, 4);
    s.perks = ['incendiary', 'volatileFuel', 'wildfire', 'cryoRounds', 'brittle', 'shatter'];
    expect(activeSynergies(s)).toEqual(expect.arrayContaining(['煉獄鏈', '永凍碎裂']));
  });
});
