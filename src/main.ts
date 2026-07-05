import { buyInRunUpgrade, newRun, step, TICK_DT, type SimState } from './core/sim';
import { IN_RUN_UPGRADES, WORKSHOP_UPGRADES } from './core/stats';
import { formatNumber, isMaxed, upgradeCost } from './core/economy';
import type { StatId, UpgradeCategory, UpgradeDef } from './core/types';
import { localStorageStore, type SaveData } from './meta/save';
import { buyWorkshopUpgrade, settleRun } from './meta/workshop';
import { render } from './ui/renderer';

const store = localStorageStore();
const save: SaveData = store.load();

let sim: SimState | null = null;
let speed = 1;
let activeTab: UpgradeCategory = 'attack';
let resultsShown = false;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const topbar = $('#topbar');
const workshopScreen = $('#workshop-screen');
const battleScreen = $('#battle-screen');
const canvas = $('#game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

function fmtStatDelta(stat: StatId, v: number): string {
  switch (stat) {
    case 'critChance':
      return `+${(v * 100).toFixed(1)}%`;
    case 'critFactor':
    case 'cashPerKill':
    case 'coinBonus':
      return `+${v.toFixed(2)}x`;
    case 'attackSpeed':
    case 'healthRegen':
      return `+${v.toFixed(2)}`;
    default:
      return `+${formatNumber(v)}`;
  }
}

interface UpgradeButton {
  el: HTMLButtonElement;
  def: UpgradeDef;
}

function makeUpgradeButton(def: UpgradeDef, onClick: () => void): UpgradeButton {
  const el = document.createElement('button');
  el.className = 'upgrade-btn';
  el.innerHTML = `<span class="name"></span><span class="info"></span><span class="cost"></span>`;
  el.addEventListener('click', onClick);
  return { el, def };
}

function refreshUpgradeButton(btn: UpgradeButton, level: number, currency: number, currencyClass: string): void {
  const { def, el } = btn;
  const maxed = isMaxed(def, level);
  const cost = upgradeCost(def, level);
  (el.querySelector('.name') as HTMLElement).textContent = `${def.name} Lv.${level}`;
  (el.querySelector('.info') as HTMLElement).textContent = `每級 ${fmtStatDelta(def.stat, def.valuePerLevel)}`;
  const costEl = el.querySelector('.cost') as HTMLElement;
  costEl.className = `cost ${currencyClass}`;
  costEl.textContent = maxed ? 'MAX' : formatNumber(cost);
  el.disabled = maxed || currency < cost;
}

// ---------- 工坊畫面 ----------

const workshopButtons: UpgradeButton[] = WORKSHOP_UPGRADES.map((def) =>
  makeUpgradeButton(def, () => {
    if (buyWorkshopUpgrade(save, def.id)) {
      store.save(save);
      refreshWorkshop();
    }
  })
);
for (const btn of workshopButtons) $('#workshop-grid').appendChild(btn.el);

function refreshWorkshop(): void {
  topbar.innerHTML = `
    <div class="stat"><span class="label">金幣</span><span class="value coin">🪙 ${formatNumber(save.coins)}</span></div>
    <div class="stat"><span class="label">最高波次</span><span class="value">${save.bestWave}</span></div>
    <div class="stat"><span class="label">總場數</span><span class="value">${save.totalRuns}</span></div>
    <div class="spacer"></div>`;
  for (const btn of workshopButtons) {
    refreshUpgradeButton(btn, save.workshopLevels[btn.def.id] ?? 0, save.coins, 'coin');
  }
}

function showWorkshop(): void {
  sim = null;
  workshopScreen.classList.add('active');
  battleScreen.classList.remove('active');
  $('#results').classList.remove('active');
  refreshWorkshop();
}

// ---------- 戰鬥畫面 ----------

const battleButtons: UpgradeButton[] = IN_RUN_UPGRADES.map((def) =>
  makeUpgradeButton(def, () => {
    if (sim && buyInRunUpgrade(sim, def.id)) refreshBattleUI();
  })
);

const TABS: Array<{ id: UpgradeCategory; name: string }> = [
  { id: 'attack', name: '⚔️ 攻擊' },
  { id: 'defense', name: '🛡️ 防禦' },
  { id: 'economy', name: '💰 經濟' },
];

function buildTabs(): void {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  for (const t of TABS) {
    const b = document.createElement('button');
    b.textContent = t.name;
    b.dataset.tab = t.id;
    b.classList.toggle('active', t.id === activeTab);
    b.addEventListener('click', () => {
      activeTab = t.id;
      buildTabs();
      buildBattleGrid();
    });
    tabs.appendChild(b);
  }
}

function buildBattleGrid(): void {
  const grid = $('#battle-grid');
  grid.innerHTML = '';
  for (const btn of battleButtons) {
    if (btn.def.category === activeTab) grid.appendChild(btn.el);
  }
  refreshBattleUI();
}

function refreshBattleUI(): void {
  if (!sim) return;
  topbar.innerHTML = `
    <div class="stat"><span class="label">波次</span><span class="value">${sim.wave}</span></div>
    <div class="stat"><span class="label">現金</span><span class="value cash">$ ${formatNumber(sim.cash)}</span></div>
    <div class="stat"><span class="label">本場金幣</span><span class="value coin">🪙 ${formatNumber(sim.coinsEarned)}</span></div>
    <div class="stat"><span class="label">血量</span><span class="value">${formatNumber(Math.ceil(sim.towerHp))}/${formatNumber(sim.stats.maxHealth)}</span></div>
    <div class="spacer"></div>
    <button id="speed-btn">x${speed}</button>`;
  $('#speed-btn').addEventListener('click', () => {
    speed = speed >= 3 ? 1 : speed + 1;
    refreshBattleUI();
  });
  for (const btn of battleButtons) {
    refreshUpgradeButton(btn, sim.inRunLevels[btn.def.id] ?? 0, sim.cash, 'cash');
  }
}

function startBattle(): void {
  sim = newRun(save.workshopLevels, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  resultsShown = false;
  workshopScreen.classList.remove('active');
  battleScreen.classList.add('active');
  buildTabs();
  buildBattleGrid();
}

function showResults(s: SimState): void {
  settleRun(save, { wave: s.wave, coinsEarned: s.coinsEarned, kills: s.kills });
  store.save(save);
  $('#results-rows').innerHTML = `
    <div class="row"><span class="label">到達波次</span><span class="value">${s.wave}</span></div>
    <div class="row"><span class="label">擊殺數</span><span class="value">${formatNumber(s.kills)}</span></div>
    <div class="row"><span class="label">獲得金幣</span><span class="value coin">+🪙 ${formatNumber(s.coinsEarned)}</span></div>
    <div class="row"><span class="label">歷史最高</span><span class="value">${save.bestWave}</span></div>`;
  $('#results').classList.add('active');
}

// ---------- 主迴圈：固定 tick 模擬 + 每幀渲染 ----------

let lastTime = performance.now();
let accumulator = 0;
let uiTimer = 0;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;

  if (sim && !sim.over) {
    accumulator += dt * speed;
    while (accumulator >= TICK_DT) {
      step(sim, TICK_DT);
      accumulator -= TICK_DT;
    }
    uiTimer += dt;
    if (uiTimer >= 0.15) {
      uiTimer = 0;
      refreshBattleUI();
    }
  }
  if (sim) {
    render(ctx, canvas, sim);
    if (sim.over && !resultsShown) {
      resultsShown = true;
      showResults(sim);
    }
  }
  requestAnimationFrame(frame);
}

$('#start-btn').addEventListener('click', startBattle);
$('#results-btn').addEventListener('click', showWorkshop);

showWorkshop();
requestAnimationFrame(frame);
