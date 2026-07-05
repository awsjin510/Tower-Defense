import { buyInRunUpgrade, choosePerk, newRun, step, TICK_DT, type SimState } from './core/sim';
import { IN_RUN_UPGRADES, WORKSHOP_UPGRADES, computeStats } from './core/stats';
import { formatNumber, isMaxed, upgradeCost } from './core/economy';
import { perkById } from './core/perks';
import { offlineCoins } from './core/offline';
import { isZoneEntryWave, zoneForWave } from './core/zones';
import { CARDS, CARD_CONFIG, buildRunMods, cardById, describeCard } from './core/cards';
import {
  buyStarUp,
  buySlot,
  cardStar,
  pruneEquipped,
  slotUnlockCost,
  starUpCost,
  syncCardUnlocks,
  toggleEquip,
} from './meta/cards';
import type { StatId, UpgradeCategory, UpgradeDef } from './core/types';
import { applySave, ensurePlayerId, localStorageStore, type SaveData } from './meta/save';
import { buyWorkshopUpgrade, settleRun } from './meta/workshop';
import { render } from './ui/renderer';
import { Vfx } from './ui/vfx';
import type { User } from 'firebase/auth';

type CloudModule = typeof import('./cloud/firebase');

const store = localStorageStore();
const save: SaveData = store.load();
// 帳號代碼：首次開啟時產生（記憶體），下次任何存檔時一併持久化，避免多寫一次而干擾雲端衝突判定
ensurePlayerId(save);
// 卡片：依歷史最高波次補齊里程碑解鎖（由 bestWave 推導，不需強制寫檔），清理無效裝備
syncCardUnlocks(save);
pruneEquipped(save);
let cloudUser: User | null = null;
let cloudModule: CloudModule | null = null;
let cloudReady = false;
let cloudWrite = Promise.resolve();
let cloudRevision = 0;
const cloudConfigPresent = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID &&
    import.meta.env.VITE_CLOUDFLARE_API_URL
);

let sim: SimState | null = null;
let speed = 1;
let activeTab: UpgradeCategory = 'attack';
let resultsShown = false;
const vfx = new Vfx();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const topbar = $('#topbar');
const workshopScreen = $('#workshop-screen');
const battleScreen = $('#battle-screen');
const canvas = $('#game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const authStatus = $('#auth-status');
const authButton = $('#auth-btn') as HTMLButtonElement;

function setAuthStatus(text: string, busy = false): void {
  authStatus.textContent = text;
  authButton.disabled = busy;
}

function saveProgress(): void {
  save.lastSeenAt = Date.now();
  store.save(save);
  if (!cloudUser) return;
  const user = cloudUser;
  const snapshot = structuredClone(save);
  cloudWrite = cloudWrite
    .then(async () => { cloudRevision = await cloudModule!.writeCloudSave(user, snapshot, cloudRevision); })
    .then(() => setAuthStatus(`☁️ ${cloudUser?.email ?? '已同步'}`))
    .catch(() => setAuthStatus('⚠️ 雲端同步失敗，本機進度已保存'));
}

async function reconcileCloud(user: User): Promise<void> {
  setAuthStatus('☁️ 正在同步…', true);
  try {
    const result = await cloudModule!.loadCloudSave(user);
    cloudRevision = result.revision;
    if (result.save && result.save.updatedAt > save.updatedAt) {
      applySave(save, result.save);
      store.save(save);
    } else {
      store.save(save);
      cloudRevision = await cloudModule!.writeCloudSave(user, save, cloudRevision);
    }
    setAuthStatus(`☁️ ${user.email ?? 'Google 帳號'}`);
    if (!sim) refreshWorkshop();
  } catch {
    setAuthStatus('⚠️ 雲端連線失敗，本機模式');
  } finally {
    authButton.disabled = false;
  }
}

async function initCloud(): Promise<void> {
  if (!cloudConfigPresent) {
    setAuthStatus('本機存檔（雲端尚未設定）');
    authButton.hidden = true;
    return;
  }
  cloudModule = await import('./cloud/firebase');
  if (!cloudModule.cloudConfigured) {
    setAuthStatus('本機存檔（雲端尚未設定）');
    authButton.hidden = true;
    return;
  }

  cloudReady = true;
  authButton.textContent = 'Google 登入';
  authButton.addEventListener('click', async () => {
    setAuthStatus(cloudUser ? '正在登出…' : '正在登入…', true);
    try {
      if (cloudUser) await cloudModule!.signOutGoogle();
      else await cloudModule!.signInGoogle();
    } catch {
      setAuthStatus('登入未完成');
      authButton.disabled = false;
    }
  });
  cloudModule.watchGoogleUser((user) => {
    cloudUser = user;
    authButton.textContent = user ? '登出' : 'Google 登入';
    if (user) void reconcileCloud(user);
    else {
      cloudRevision = 0;
      setAuthStatus('本機存檔');
      authButton.disabled = false;
    }
    renderAccountIfOpen();
  });
}

void initCloud().catch(() => {
  setAuthStatus('本機存檔（雲端載入失敗）');
  authButton.hidden = true;
});

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

/** 屬性的當前絕對值（各屬性用各自的單位），讓玩家一眼看懂目前數值 */
function fmtStatValue(stat: StatId, v: number): string {
  switch (stat) {
    case 'critChance':
      return `${(v * 100).toFixed(1)}%`;
    case 'critFactor':
    case 'cashPerKill':
    case 'coinBonus':
      return `x${v.toFixed(2)}`;
    case 'attackSpeed':
      return v.toFixed(2);
    case 'healthRegen':
      return `${v.toFixed(1)}/s`;
    default:
      return formatNumber(v);
  }
}

interface UpgradeButton {
  el: HTMLButtonElement;
  def: UpgradeDef;
}

function makeUpgradeButton(def: UpgradeDef, onClick: () => void): UpgradeButton {
  const el = document.createElement('button');
  el.className = 'upgrade-btn';
  el.innerHTML =
    `<span class="name"></span>` +
    `<span class="value"></span>` +
    `<span class="foot"><span class="delta"></span><span class="cost"></span></span>`;
  el.addEventListener('click', onClick);
  return { el, def };
}

function refreshUpgradeButton(
  btn: UpgradeButton,
  level: number,
  currency: number,
  currencyClass: string,
  currentValue: number
): void {
  const { def, el } = btn;
  const maxed = isMaxed(def, level);
  const cost = upgradeCost(def, level);
  (el.querySelector('.name') as HTMLElement).textContent = `${def.name} Lv.${level}`;
  // 目前的實際數值（含工坊 + 場內 + Perk 的總和），一眼看懂目前狀態
  (el.querySelector('.value') as HTMLElement).textContent = fmtStatValue(def.stat, currentValue);
  (el.querySelector('.delta') as HTMLElement).textContent = `每級 ${fmtStatDelta(def.stat, def.valuePerLevel)}`;
  const costEl = el.querySelector('.cost') as HTMLElement;
  costEl.className = `cost ${currencyClass}`;
  costEl.textContent = maxed ? 'MAX' : formatNumber(cost);
  const affordable = !maxed && currency >= cost;
  el.disabled = !affordable;
  // 買得起就發亮——放置遊戲最核心的視覺鉤子
  el.classList.toggle('affordable', affordable);
}

// ---------- 工坊畫面 ----------

const workshopButtons: UpgradeButton[] = WORKSHOP_UPGRADES.map((def) =>
  makeUpgradeButton(def, () => {
    if (buyWorkshopUpgrade(save, def.id)) {
      saveProgress();
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
  // 工坊顯示「每場開局」的屬性值（永久升級套用後、尚未買場內升級時的起點）
  const startStats = computeStats(save.workshopLevels, {});
  for (const btn of workshopButtons) {
    refreshUpgradeButton(btn, save.workshopLevels[btn.def.id] ?? 0, save.coins, 'coin', startStats[btn.def.stat]);
  }
}

function showWorkshop(): void {
  sim = null;
  workshopScreen.classList.add('active');
  cardsScreen.classList.remove('active');
  battleScreen.classList.remove('active');
  $('#results').classList.remove('active');
  setMetaNav('workshop');
  refreshWorkshop();
}

// ---------- 卡片畫面 ----------

const cardsScreen = $('#cards-screen');

function setMetaNav(active: 'workshop' | 'cards'): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.meta-nav button')) {
    b.classList.toggle('active', b.dataset.meta === active);
  }
}

function showCards(): void {
  sim = null;
  cardsScreen.classList.add('active');
  workshopScreen.classList.remove('active');
  battleScreen.classList.remove('active');
  $('#results').classList.remove('active');
  setMetaNav('cards');
  refreshCards();
}

/** 一張卡片格：擁有→顯示效果＋裝備/升星；未解鎖→鎖頭＋解鎖波次 */
function makeCardCell(id: string): HTMLElement {
  const cell = document.createElement('div');
  cell.className = 'card-cell';
  cell.dataset.card = id;
  return cell;
}

function starDots(star: number, max: number): string {
  let out = '';
  for (let i = 0; i < max; i++) out += i < star ? '★' : '☆';
  return out;
}

function refreshCardCell(cell: HTMLElement): void {
  const id = cell.dataset.card!;
  const def = cardById(id)!;
  const star = cardStar(save, id);
  const owned = star > 0;
  const equipped = save.equipped.includes(id);
  cell.classList.toggle('owned', owned);
  cell.classList.toggle('equipped', equipped);
  cell.classList.toggle('locked', !owned);
  if (!owned) {
    cell.innerHTML = `
      <div class="card-art locked-art">🔒</div>
      <div class="card-name">${def.name}</div>
      <div class="card-sub">波次 ${def.unlockWave} 解鎖</div>`;
    return;
  }
  const cost = starUpCost(star);
  const canStar = cost !== null;
  cell.style.setProperty('--card-color', def.color);
  cell.innerHTML = `
    <div class="card-art" style="background:linear-gradient(160deg, ${def.color}44, ${def.color}11)">
      <span class="card-icon">${def.icon}</span>
      <span class="card-stars">${starDots(star, CARD_CONFIG.starMax)}</span>
    </div>
    <div class="card-name">${def.name}</div>
    <div class="card-sub">${describeCard(def, star)}</div>
    <div class="card-actions">
      <button class="card-equip">${equipped ? '卸下' : '裝備'}</button>
      <button class="card-star" ${canStar && save.coins >= (cost as number) ? '' : 'disabled'}>${
        canStar ? `升星 🪙${formatNumber(cost as number)}` : 'MAX'
      }</button>
    </div>`;
  (cell.querySelector('.card-equip') as HTMLButtonElement).addEventListener('click', () => {
    if (!equipped && save.equipped.length >= save.cardSlots && cardStar(save, id) > 0) {
      // 沒空槽時給提示
      flashSlots();
      return;
    }
    toggleEquip(save, id);
    saveProgress();
    refreshCards();
  });
  (cell.querySelector('.card-star') as HTMLButtonElement).addEventListener('click', () => {
    if (buyStarUp(save, id)) {
      saveProgress();
      refreshCards();
    }
  });
}

let slotsFlash = 0;
function flashSlots(): void {
  slotsFlash = 1;
  refreshCards();
  setTimeout(() => {
    slotsFlash = 0;
    if (cardsScreen.classList.contains('active')) refreshCards();
  }, 600);
}

function refreshCards(): void {
  refreshWorkshop(); // 共用頂欄（金幣/最高波次/場數）

  // 裝備列：已用/總槽位 + 各槽內容 + 解鎖新槽位
  const slotWrap = $('#card-loadout');
  const cost = slotUnlockCost(save);
  $('#card-loadout-label').innerHTML =
    `裝備 <b class="${slotsFlash ? 'flash' : ''}">${save.equipped.length}/${save.cardSlots}</b> · 槽位有限，取捨你的流派`;
  slotWrap.innerHTML = '';
  for (let i = 0; i < save.cardSlots; i++) {
    const id = save.equipped[i];
    const slot = document.createElement('div');
    slot.className = id ? 'loadout-slot filled' : 'loadout-slot';
    if (id) {
      const def = cardById(id)!;
      slot.style.borderColor = def.color;
      slot.innerHTML = `<span class="slot-icon">${def.icon}</span><span class="slot-name">${def.name} ${starDots(
        cardStar(save, id),
        CARD_CONFIG.starMax
      )}</span>`;
      slot.addEventListener('click', () => {
        toggleEquip(save, id);
        saveProgress();
        refreshCards();
      });
    } else {
      slot.innerHTML = '<span class="slot-empty">＋</span>';
    }
    slotWrap.appendChild(slot);
  }
  if (cost !== null) {
    const unlock = document.createElement('button');
    unlock.className = 'slot-unlock';
    unlock.disabled = save.coins < cost;
    unlock.innerHTML = `🔓 解鎖新槽位<br>🪙${formatNumber(cost)}`;
    unlock.addEventListener('click', () => {
      if (buySlot(save)) {
        saveProgress();
        refreshCards();
      }
    });
    slotWrap.appendChild(unlock);
  }

  // 庫存：全部卡片（擁有在前、已解鎖依波次、鎖住在後）
  const inv = $('#card-inventory');
  inv.innerHTML = '';
  const ordered = [...CARDS].sort((a, b) => {
    const oa = cardStar(save, a.id) > 0 ? 0 : 1;
    const ob = cardStar(save, b.id) > 0 ? 0 : 1;
    return oa - ob || a.unlockWave - b.unlockWave;
  });
  for (const def of ordered) {
    const cell = makeCardCell(def.id);
    inv.appendChild(cell);
    refreshCardCell(cell);
  }
}

// ---------- 戰鬥畫面 ----------

const battleButtons: UpgradeButton[] = IN_RUN_UPGRADES.map((def) =>
  makeUpgradeButton(def, () => {
    if (sim && buyInRunUpgrade(sim, def.id)) refreshBattleButtons();
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
  refreshBattleButtons();
}

// 戰鬥頂欄用持久 DOM（每幀更新數字、平滑滾動），不整塊重建
interface Hud {
  wave: HTMLElement;
  zone: HTMLElement;
  cash: HTMLElement;
  coin: HTMLElement;
  hp: HTMLElement;
  speedBtn: HTMLButtonElement;
}
let hud: Hud | null = null;
// 顯示值（朝真實值插值，做出數字滾動效果）
let dispCash = 0;
let dispCoin = 0;
let dispHp = 0;

function buildBattleTopbar(): void {
  topbar.innerHTML = `
    <div class="stat"><span class="label">波次</span><span class="value" data-wave></span></div>
    <div class="stat"><span class="label">戰區</span><span class="value" data-zone></span></div>
    <div class="stat"><span class="label">現金</span><span class="value cash" data-cash></span></div>
    <div class="stat"><span class="label">本場金幣</span><span class="value coin" data-coin></span></div>
    <div class="stat"><span class="label">血量</span><span class="value" data-hp></span></div>
    <div class="spacer"></div>
    <button id="speed-btn" class="speed-btn">x${speed}</button>`;
  const speedBtn = $('#speed-btn') as HTMLButtonElement;
  speedBtn.addEventListener('click', () => {
    speed = speed >= 3 ? 1 : speed + 1;
    speedBtn.textContent = `x${speed}`;
  });
  hud = {
    wave: topbar.querySelector('[data-wave]') as HTMLElement,
    zone: topbar.querySelector('[data-zone]') as HTMLElement,
    cash: topbar.querySelector('[data-cash]') as HTMLElement,
    coin: topbar.querySelector('[data-coin]') as HTMLElement,
    hp: topbar.querySelector('[data-hp]') as HTMLElement,
    speedBtn,
  };
}

/** 每幀更新頂欄數字（平滑滾動）與血量色 */
function updateBattleHud(dt: number): void {
  if (!sim || !hud) return;
  const k = Math.min(dt * 12, 1);
  dispCash += (sim.cash - dispCash) * k;
  dispCoin += (sim.coinsEarned - dispCoin) * k;
  dispHp += (sim.towerHp - dispHp) * k;
  hud.wave.textContent = String(sim.wave);
  const zone = zoneForWave(sim.wave);
  if (hud.zone.textContent !== zone.name) {
    hud.zone.textContent = zone.name;
    hud.zone.style.color = zone.accent;
  }
  hud.cash.textContent = `$ ${formatNumber(dispCash)}`;
  hud.coin.textContent = `🪙 ${formatNumber(dispCoin)}`;
  hud.hp.textContent = `${formatNumber(Math.max(Math.ceil(dispHp), 0))}/${formatNumber(sim.stats.maxHealth)}`;
  const ratio = sim.towerHp / sim.stats.maxHealth;
  hud.hp.style.color = ratio > 0.35 ? '' : '#f85149';
}

/** 只刷新升級按鈕（成本/買得起狀態），與頂欄滾動分開 */
function refreshBattleButtons(): void {
  if (!sim) return;
  for (const btn of battleButtons) {
    refreshUpgradeButton(btn, sim.inRunLevels[btn.def.id] ?? 0, sim.cash, 'cash', sim.stats[btn.def.stat]);
  }
}

let bannerTimer = 0;
function showWaveBanner(wave: number, boss: boolean): void {
  const banner = $('#wave-banner');
  banner.style.background = '';
  banner.style.boxShadow = '';
  if (boss) {
    banner.textContent = `⚠ 頭目來襲 · Wave ${wave}`;
    banner.className = 'show boss';
  } else if (isZoneEntryWave(wave) && wave > 1) {
    // 跨入新戰區：以戰區主題色宣告
    const zone = zoneForWave(wave);
    banner.textContent = `🌐 進入 ${zone.name} · Wave ${wave}`;
    banner.className = 'show';
    banner.style.background = zone.accent;
    banner.style.boxShadow = `0 4px 22px ${zone.accent}`;
  } else {
    banner.textContent = `Wave ${wave}`;
    banner.className = 'show';
  }
  bannerTimer = boss ? 2.4 : isZoneEntryWave(wave) && wave > 1 ? 2.2 : 1.6;
}

// ---------- Perk 三選一（模擬已在 core 暫停，選完才恢復） ----------

const perkOverlay = $('#perk-overlay');

function showPerkChoice(wave: number, choices: string[]): void {
  $('#perk-sub').textContent = `Wave ${wave} 獎勵 · 本場有效`;
  const cards = $('#perk-cards');
  cards.innerHTML = '';
  for (const id of choices) {
    const def = perkById(id);
    if (!def) continue;
    const btn = document.createElement('button');
    btn.className = def.risky ? 'perk-card risky' : 'perk-card';
    btn.innerHTML = `<span class="perk-name"></span><span class="perk-desc"></span>`;
    (btn.querySelector('.perk-name') as HTMLElement).textContent = def.name;
    (btn.querySelector('.perk-desc') as HTMLElement).textContent = def.desc;
    btn.addEventListener('click', () => {
      if (sim && choosePerk(sim, id)) {
        perkOverlay.classList.remove('active');
        refreshBattleButtons();
      }
    });
    cards.appendChild(btn);
  }
  perkOverlay.classList.add('active');
}

// ---------- 離線收益（開啟遊戲時結算一次） ----------

function checkOfflineEarnings(): void {
  const now = Date.now();
  const elapsedSec = (now - save.lastSeenAt) / 1000;
  const gained = save.lastSeenAt > 0 ? offlineCoins(save.coinRate, elapsedSec) : 0;
  if (gained < 1) return;
  save.coins += gained;
  saveProgress();
  const hours = Math.floor(elapsedSec / 3600);
  const mins = Math.floor((elapsedSec % 3600) / 60);
  const durText = hours > 0 ? `${hours} 小時 ${mins} 分` : `${mins} 分鐘`;
  $('#offline-rows').innerHTML = `
    <div class="row"><span class="label">離線時間</span><span class="value">${durText}</span></div>
    <div class="row"><span class="label">獲得金幣</span><span class="value coin" data-offroll>+🪙 0</span></div>`;
  $('#offline-modal').classList.add('active');
  rollNumber($('#offline-rows').querySelector('[data-offroll]') as HTMLElement, gained, 0.8, '+🪙 ');
}

$('#offline-btn').addEventListener('click', () => {
  $('#offline-modal').classList.remove('active');
  refreshWorkshop();
});

// 關閉/切出頁面時記下時間點，回來才能結算離線收益
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    save.lastSeenAt = Date.now();
    store.save(save);
  }
});

// ---------- 帳戶面板（帳號 ID + Email 連動） ----------

const accountModal = $('#account-modal');
const accountBtn = $('#account-btn') as HTMLButtonElement;

/** Email 遮罩顯示：ke***10@gmail.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  if (local.length <= 4) return `${local[0] ?? ''}***@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-2)}@${domain}`;
}

function authCode(e: unknown): string {
  return (e as { code?: string })?.code ?? '';
}

/** 把 Firebase 認證錯誤碼轉成看得懂的中文 */
function authMessage(e: unknown): string {
  const map: Record<string, string> = {
    'auth/invalid-email': 'Email 格式不正確',
    'auth/weak-password': '密碼太弱（至少 6 碼）',
    'auth/email-already-in-use': '這個 Email 已被使用',
    'auth/wrong-password': '密碼錯誤',
    'auth/invalid-credential': 'Email 或密碼錯誤',
    'auth/requires-recent-login': '基於安全考量，請先登出再重新登入後再試',
    'auth/too-many-requests': '嘗試次數過多，請稍後再試',
    'auth/popup-closed-by-user': '登入視窗被關閉',
    'auth/network-request-failed': '網路連線失敗',
    'auth/credential-already-in-use': '這個 Email 已連結到其他帳號',
    'auth/operation-not-allowed': '此登入方式尚未在後台啟用',
  };
  return map[authCode(e)] ?? (e instanceof Error ? e.message : '未知錯誤');
}

function renderAccountIfOpen(): void {
  if (accountModal.classList.contains('active')) renderAccount();
}

function addAccountAction(label: string, handler: () => void | Promise<void>, danger = false): void {
  const b = document.createElement('button');
  b.className = danger ? 'account-action danger' : 'account-action';
  b.textContent = label;
  b.addEventListener('click', () => void handler());
  $('#account-actions').appendChild(b);
}

/** 統一包住雲端動作：失敗跳中文提示、結束後重繪面板 */
async function runCloud(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    alert(`${label}：${authMessage(e)}`);
  }
  renderAccountIfOpen();
}

function askEmailPassword(pwLabel: string): { email: string; password: string } | null {
  const email = prompt('請輸入 Email');
  if (!email) return null;
  const password = prompt(pwLabel);
  if (!password) return null;
  return { email: email.trim(), password };
}

async function emailSignInFlow(): Promise<void> {
  const creds = askEmailPassword('請輸入密碼');
  if (!creds) return;
  try {
    await cloudModule!.signInEmail(creds.email, creds.password);
  } catch (e) {
    if (authCode(e) === 'auth/user-not-found') {
      if (confirm('查無此帳號，要用這組 Email／密碼註冊新帳號嗎？')) {
        await runCloud('註冊', () => cloudModule!.signUpEmail(creds.email, creds.password).then(() => undefined));
        return;
      }
    } else {
      alert(`登入失敗：${authMessage(e)}`);
    }
  }
  renderAccountIfOpen();
}

async function linkEmailFlow(): Promise<void> {
  const creds = askEmailPassword('為此帳號設定密碼（至少 6 碼）');
  if (!creds) return;
  await runCloud('連結 Email', async () => {
    await cloudModule!.linkEmail(creds.email, creds.password);
    alert('已連結 Email，之後可用 Email／密碼登入。');
  });
}

async function changeEmailFlow(): Promise<void> {
  const ne = prompt('請輸入新的 Email');
  if (!ne) return;
  await runCloud('變更電子郵件', async () => {
    await cloudModule!.changeEmail(ne);
    alert(`已寄出驗證信到 ${ne.trim()}，點擊信中連結後即完成變更。`);
  });
}

async function changePasswordFlow(): Promise<void> {
  const np = prompt('請輸入新密碼（至少 6 碼）');
  if (!np) return;
  await runCloud('變更密碼', async () => {
    await cloudModule!.changePassword(np);
    alert('密碼已更新。');
  });
}

function renderAccount(): void {
  $('#account-id-val').textContent = save.playerId || '—';
  const linked = $('#account-linked');
  const actions = $('#account-actions');
  linked.innerHTML = '';
  actions.innerHTML = '';

  // 已連結帳號
  if (cloudUser?.email) {
    const row = document.createElement('div');
    row.className = 'linked-row';
    row.innerHTML = `<span class="mail"></span><span class="check">✓</span>`;
    (row.querySelector('.mail') as HTMLElement).textContent = `📧 ${maskEmail(cloudUser.email)}`;
    linked.appendChild(row);
  } else {
    linked.innerHTML = '<div class="linked-none">尚未連結任何帳號</div>';
  }

  // 雲端未設定：只提供本機 ID
  if (!cloudReady) {
    const note = document.createElement('div');
    note.className = 'account-note';
    note.textContent =
      '雲端同步尚未設定，目前僅提供本機帳號 ID。設定 Firebase 後即可用 Email 連動、跨裝置同步進度。';
    actions.appendChild(note);
    return;
  }

  if (!cloudUser) {
    addAccountAction('📧 使用 Email 登入 / 註冊', emailSignInFlow);
    addAccountAction('使用 Google 登入', () =>
      runCloud('Google 登入', () => cloudModule!.signInGoogle().then(() => undefined))
    );
    return;
  }

  const providers = cloudUser.providerData.map((p) => p.providerId);
  const hasPassword = providers.includes('password');
  if (!hasPassword) addAccountAction('🔗 連結 Email／密碼', linkEmailFlow);
  addAccountAction('變更電子郵件', changeEmailFlow);
  if (hasPassword) addAccountAction('變更密碼', changePasswordFlow);
  addAccountAction('登出', () => runCloud('登出', () => cloudModule!.signOutGoogle()), true);
}

accountBtn.addEventListener('click', () => {
  renderAccount();
  accountModal.classList.add('active');
});
$('#account-close').addEventListener('click', () => accountModal.classList.remove('active'));
accountModal.addEventListener('click', (e) => {
  if (e.target === accountModal) accountModal.classList.remove('active');
});
$('#account-copy').addEventListener('click', async () => {
  const btn = $('#account-copy');
  try {
    await navigator.clipboard.writeText(save.playerId);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = save.playerId;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* 複製不支援時忽略 */
    }
    ta.remove();
  }
  btn.classList.add('copied');
  btn.textContent = '✓';
  setTimeout(() => {
    btn.classList.remove('copied');
    btn.textContent = '📋';
  }, 1200);
});

function startBattle(): void {
  const mods = buildRunMods(save.equipped, (id) => cardStar(save, id));
  sim = newRun(save.workshopLevels, (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0, mods);
  resultsShown = false;
  perkOverlay.classList.remove('active');
  dispCash = 0;
  dispCoin = 0;
  dispHp = sim.stats.maxHealth;
  vfx.texts.length = 0;
  vfx.particles.length = 0;
  vfx.flash.clear();
  workshopScreen.classList.remove('active');
  battleScreen.classList.add('active');
  buildBattleTopbar();
  buildTabs();
  buildBattleGrid();
}

/** 數字滾動：dur 秒內從 0 補到 target */
function rollNumber(el: HTMLElement, target: number, dur: number, prefix: string): void {
  const start = performance.now();
  function tick(now: number): void {
    const t = Math.min((now - start) / (dur * 1000), 1);
    const eased = 1 - (1 - t) * (1 - t);
    el.textContent = `${prefix}${formatNumber(target * eased)}`;
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function showResults(s: SimState): void {
  const isRecord = s.wave > save.bestWave;
  settleRun(save, { wave: s.wave, coinsEarned: s.coinsEarned, kills: s.kills, timeSec: s.time });
  // 這一場刷新紀錄後可能解鎖新卡片
  const newCards = syncCardUnlocks(save);
  saveProgress();
  const unlockedLine = newCards.length
    ? `<div class="record">🃏 解鎖新卡片：${newCards.map((id) => cardById(id)?.name ?? id).join('、')}</div>`
    : '';
  $('#results-rows').innerHTML = `
    ${isRecord ? '<div class="record">🏆 新紀錄！</div>' : ''}
    ${unlockedLine}
    <div class="row"><span class="label">到達波次</span><span class="value">${s.wave}</span></div>
    <div class="row"><span class="label">擊殺數</span><span class="value">${formatNumber(s.kills)}</span></div>
    <div class="row"><span class="label">獲得金幣</span><span class="value coin" data-coinroll>+🪙 0</span></div>
    <div class="row"><span class="label">歷史最高</span><span class="value">${save.bestWave}</span></div>`;
  $('#results').classList.add('active');
  rollNumber($('#results-rows').querySelector('[data-coinroll]') as HTMLElement, s.coinsEarned, 0.8, '+🪙 ');
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
      // 取走本 tick 的視覺事件（下個 step 開頭會清空）
      vfx.ingest(sim.events);
      for (const e of sim.events) {
        if (e.type === 'wave') showWaveBanner(e.wave, e.boss);
        if (e.type === 'perkOffer') showPerkChoice(e.wave, e.choices);
      }
      accumulator -= TICK_DT;
    }
    updateBattleHud(dt);
    uiTimer += dt;
    if (uiTimer >= 0.1) {
      uiTimer = 0;
      refreshBattleButtons();
    }
    if (bannerTimer > 0) {
      bannerTimer -= dt;
      if (bannerTimer <= 0) $('#wave-banner').className = '';
    }
  }
  if (sim) {
    vfx.update(dt);
    render(ctx, canvas, sim, vfx);
    if (sim.over && !resultsShown) {
      resultsShown = true;
      showResults(sim);
    }
  }
  requestAnimationFrame(frame);
}

$('#start-btn').addEventListener('click', startBattle);
$('#results-btn').addEventListener('click', showWorkshop);

// 工坊 / 卡片 分頁切換
for (const b of document.querySelectorAll<HTMLButtonElement>('.meta-nav button')) {
  b.addEventListener('click', () => (b.dataset.meta === 'cards' ? showCards() : showWorkshop()));
}

showWorkshop();
checkOfflineEarnings();
requestAnimationFrame(frame);
