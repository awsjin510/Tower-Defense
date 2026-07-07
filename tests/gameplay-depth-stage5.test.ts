import { describe, expect, it } from 'vitest';
import { activateUltimate, chooseRoute, newRun, step, TICK_DT } from '../src/core/sim';
import { resolveUltimate, ultimateById } from '../src/core/ultimates';
import { defaultSave, migrate } from '../src/meta/save';
import { resolvedUltimates, toggleUltimateEquip } from '../src/meta/ultimates';
import { RESEARCH } from '../src/core/research';

describe('ultimate arsenal and charge', () => {
  it('只有滿充能可以施放，研究提供開場充能', () => {
    const gold=resolveUltimate(ultimateById('golden')!,1);
    const s=newRun({},1,undefined,{r_ultcharge:4},[gold]);
    expect(s.ultCharge.golden).toBe(20);
    expect(activateUltimate(s,'golden')).toBe(false);
    s.ultCharge.golden=100;
    expect(activateUltimate(s,'golden')).toBe(true);
    expect(s.ultUses.golden).toBe(1);
  });
  it('時間凍結停止敵人移動但塔能持續射擊', () => {
    const tf=resolveUltimate(ultimateById('timefreeze')!,1);
    const s=newRun({},2,undefined,{},[tf]); s.spawnList=[];
    const e={id:1,typeId:'normal',x:150,y:0,hp:1000,maxHp:1000,speed:50,dmg:0,cashValue:1,coinValue:1,radius:9,attackTimer:0,attackRange:0,summonEvery:0,summonTimer:0,burnDps:0,burnTime:0,burnStacks:0,frostStacks:0,frozenTime:0,zoneTimer:0,zoneEmpower:1,canSplit:false,affixTimer:0,affixShield:0,affixTriggered:false,bossPhase:3};
    s.enemies=[e]; s.ultCharge.timefreeze=100; activateUltimate(s,'timefreeze'); const x=e.x;
    for(let i=0;i<10;i++)step(s,TICK_DT);
    expect(e.x).toBe(x); expect(e.hp).toBeLessThan(e.maxHp);
  });
});

describe('loadout, research and routes', () => {
  it('終極攜帶上限為兩件且分支會影響解析值', () => {
    const save=defaultSave(); save.bestWave=999;
    for(const id of ['golden','blackhole','orbital']) save.ultimates[id]=3;
    expect(toggleUltimateEquip(save,'golden')).toBe(true); expect(toggleUltimateEquip(save,'blackhole')).toBe(true);
    expect(toggleUltimateEquip(save,'orbital')).toBe(false);
    save.ultimateBranches.blackhole='power';
    expect(resolvedUltimates(save).find((u)=>u.id==='blackhole')?.damageMult).toBeGreaterThan(resolveUltimate(ultimateById('blackhole')!,3).damageMult);
  });
  it('研究包含四種橫向功能，航道研究解鎖異常路線',()=>{
    expect(new Set(RESEARCH.filter((r)=>r.utility).map((r)=>r.utility)).size).toBe(4);
    const s=newRun({},1);s.pendingRoute=true;expect(chooseRoute(s,'anomaly')).toBe(true);expect(s.activeRoute).toBe('anomaly');
  });
  it('v11 存檔補齊終極配置、專精與戰報欄位',()=>{
    const s=migrate({version:10,coins:1});expect(s.equippedUltimates).toEqual([]);expect(s.workshopSpec).toBe('firepower');expect(s.lastRunReport).toBeNull();
  });
});
