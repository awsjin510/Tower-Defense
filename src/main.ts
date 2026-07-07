import { activateUltimate, buyInRunUpgrade, choosePerk, chooseRoute, currentRerollCost, cycleTargetPriority, newRun, rerollPerks, skipPerks, step, TICK_DT, type SimState } from './core/sim';
import { IN_RUN_UPGRADES, WORKSHOP_UPGRADES, computeStats, nextMilestone } from './core/stats';
import { formatNumber, isMaxed, upgradeCost } from './core/economy';
import { applyPerks, perkById, perkRarity, perkSchool, perkStacks } from './core/perks';
import { offlineCoins } from './core/offline';
import { isZoneEntryWave, zoneForWave } from './core/zones';
import { CARDS, CARD_CONFIG, CARD_SETS, activeSets, applyCardStatMods, buildRunMods, cardById, describeBonus, describeCard, type CardDef } from './core/cards';
import {
  buyStarUp,
  buySlot,
  cardStar,
  pruneEquipped,
  slotUnlockCost,
  starUpCost,
  syncCardUnlocks,
  toggleEquip,
  applyPreset,
  savePreset,
} from './meta/cards';
import {
  RESEARCH,
  isResearchMaxed,
  researchById,
  researchCost,
  researchTimeSec,
  researchValue,
} from './core/research';
import {
  collectResearch,
  researchLevel,
  researchProgress,
  researchRemainingSec,
  startResearch,
} from './meta/research';
import { ULTIMATES, describeUltimate, isUltimateMaxed, ultimateById } from './core/ultimates';
import {
  buyUltimateUpgrade,
  resolvedUltimates,
  syncUltimateUnlocks,
  ultimateLevel,
  ultimateUpgradePrice,
} from './meta/ultimates';
import type { StatId, TargetPriority, UpgradeCategory, UpgradeDef } from './core/types';
import { applySave, ensurePlayerId, localStorageStore, type SaveData } from './meta/save';
import { buyWorkshopUpgrade, settleRun } from './meta/workshop';
import { render } from './ui/renderer';
import { Vfx } from './ui/vfx';
import { icon, type IconName } from './ui/icons';
import { Sound } from './ui/sound';
import { TIER_CONFIG, tierMods } from './core/tiers';
import { selectTier, settleTier, tierBest } from './meta/tiers';
import { isMissionComplete, missionById } from './core/missions';
import { applyRunToMissions, claimMission, claimableCount, ensureDaily } from './meta/missions';
import type { User } from 'firebase/auth';

type CloudModule = typeof import('./cloud/firebase');

const store = localStorageStore();
const save: SaveData = store.load();
// 帳號代碼：首次開啟時產生（記憶體），下次任何存檔時一併持久化，避免多寫一次而干擾雲端衝突判定
ensurePlayerId(save);
// 卡片：依歷史最高波次補齊里程碑解鎖（由 bestWave 推導，不需強制寫檔），清理無效裝備
syncCardUnlocks(save);
pruneEquipped(save);
// 研究：開啟時結算離線期間已完成的研究（真實時間），完成則立即寫回避免遺失
const offlineResearch = collectResearch(save, Date.now());
if (offlineResearch) store.save(save);
// 終極武器：依歷史最高波次補齊里程碑解鎖（由 bestWave 推導，不需強制寫檔）
syncUltimateUnlocks(save);
// 每日任務：跨日則重置為當天任務（由日期推導，載入不強制寫檔）
ensureDaily(save);
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

const META_ICONS: Record<string, IconName> = { workshop: 'workshop', cards: 'cards', research: 'research', ultimates: 'ultimate' };
function decorateStaticUi(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.meta-nav button')) {
    const name = META_ICONS[b.dataset.meta ?? ''];
    if (name && !b.querySelector('svg')) b.innerHTML = `${icon(name)}<span>${b.textContent}</span>`;
  }
  const headings: Array<[string, IconName]> = [
    ['#workshop-screen h1', 'workshop'], ['#cards-screen h1', 'cards'],
    ['#research-screen h1', 'research'], ['#ultimates-screen h1', 'ultimate'],
  ];
  for (const [sel, name] of headings) {
    const h = $(sel); h.innerHTML = `${icon(name)}<span>${h.textContent}</span>`;
  }
  $('#start-btn').innerHTML = `${icon('play')}<span>開始戰鬥</span>`;
  $('#account-btn').innerHTML = `${icon('user')}<span>帳戶</span>`;
}
decorateStaticUi();

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
    case 'freeUpgradeChance':
    case 'armorPen':
    case 'damageReduction':
    case 'interestRate':
      return `+${(v * 100).toFixed(1)}%`;
    case 'critFactor':
    case 'cashPerKill':
    case 'coinBonus':
    case 'elementalPower':
    case 'eliteDamage':
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
    case 'freeUpgradeChance':
    case 'armorPen':
    case 'damageReduction':
    case 'interestRate':
      return `${(v * 100).toFixed(1)}%`;
    case 'critFactor':
    case 'cashPerKill':
    case 'coinBonus':
    case 'elementalPower':
    case 'eliteDamage':
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
    `<span class="value"><span class="current"></span><span class="preview"></span></span>` +
    `<span class="milestone"></span>` +
    `<span class="foot"><span class="delta"></span><span class="cost"></span></span>`;
  el.dataset.upgrade = def.id;
  el.addEventListener('click', () => {
    onClick();
    el.classList.remove('bought');
    void el.offsetWidth;
    el.classList.add('bought');
    setTimeout(() => el.classList.remove('bought'), 450);
  });
  return { el, def };
}

function refreshUpgradeButton(
  btn: UpgradeButton,
  level: number,
  currency: number,
  currencyClass: string,
  currentValue: number,
  nextValue = currentValue + def.valuePerLevel
): void {
  const { def, el } = btn;
  const maxed = isMaxed(def, level);
  const cost = upgradeCost(def, level);
  (el.querySelector('.name') as HTMLElement).textContent = `${def.name} Lv.${level}`;
  // 目前的實際數值（含工坊 + 場內 + Perk 的總和），一眼看懂目前狀態
  (el.querySelector('.current') as HTMLElement).textContent = fmtStatValue(def.stat, currentValue);
  (el.querySelector('.preview') as HTMLElement).textContent = maxed ? '' : `→ ${fmtStatValue(def.stat, nextValue)}`;
  (el.querySelector('.delta') as HTMLElement).textContent = maxed ? '已達上限' : `提升 ${fmtStatDelta(def.stat, nextValue - currentValue)}`;
  const milestone = nextMilestone(def.id, level);
  (el.querySelector('.milestone') as HTMLElement).textContent = milestone ? `◆ Lv.${milestone.level} ${milestone.name}` : '';
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
      Sound.play('buy');
      saveProgress();
      refreshWorkshop();
    }
  })
);
for (const btn of workshopButtons) $('#workshop-grid').appendChild(btn.el);

function refreshWorkshop(): void {
  topbar.classList.remove('battle-hud');
  topbar.innerHTML = `
    <div class="stat"><span class="label">${icon('coin')}金幣</span><span class="value coin">${formatNumber(save.coins)}</span></div>
    <div class="stat"><span class="label">最高波次</span><span class="value">${save.bestWave}</span></div>
    <div class="stat"><span class="label">總場數</span><span class="value">${save.totalRuns}</span></div>
    <div class="spacer"></div>`;
  // 工坊顯示「每場開局」的屬性值（永久升級 + 研究套用後、尚未買場內升級時的起點）
  const startStats = computeStats(save.workshopLevels, {}, save.researchLevels);
  for (const btn of workshopButtons) {
    refreshUpgradeButton(btn, save.workshopLevels[btn.def.id] ?? 0, save.coins, 'coin', startStats[btn.def.stat], startStats[btn.def.stat] + btn.def.valuePerLevel);
  }
  refreshTierSelector();
}

// ---------- Tier 選擇器 ----------

function refreshTierSelector(): void {
  const tm = tierMods(save.tier);
  $('#tier-name').textContent = `Tier ${save.tier}`;
  const best = tierBest(save, save.tier);
  const bestText = best > 0 ? `本 Tier 最高 W${best}` : '尚未挑戰';
  const unlockText =
    save.tier === save.tierMax && save.tierMax < TIER_CONFIG.maxTier
      ? ` · 到 W${TIER_CONFIG.unlockWave} 解鎖 T${save.tierMax + 1}`
      : '';
  $('#tier-detail').textContent = `敵人 HP ×${tm.hp.toFixed(1)}、獎勵 ×${tm.reward.toFixed(1)} · ${bestText}${unlockText}`;
  ($('#tier-prev') as HTMLButtonElement).disabled = save.tier <= 1;
  ($('#tier-next') as HTMLButtonElement).disabled = save.tier >= save.tierMax;
}

$('#tier-prev').addEventListener('click', () => {
  if (selectTier(save, save.tier - 1)) {
    Sound.play('click');
    saveProgress();
    refreshTierSelector();
  }
});
$('#tier-next').addEventListener('click', () => {
  if (selectTier(save, save.tier + 1)) {
    Sound.play('click');
    saveProgress();
    refreshTierSelector();
  }
});

const cardsScreen = $('#cards-screen');
const researchScreen = $('#research-screen');
const ultimatesScreen = $('#ultimates-screen');
type MetaScreen = 'workshop' | 'cards' | 'research' | 'ultimates';

function showMeta(active: MetaScreen): void {
  sim = null;
  workshopScreen.classList.toggle('active', active === 'workshop');
  cardsScreen.classList.toggle('active', active === 'cards');
  researchScreen.classList.toggle('active', active === 'research');
  ultimatesScreen.classList.toggle('active', active === 'ultimates');
  battleScreen.classList.remove('active');
  $('#results').classList.remove('active');
  setMetaNav(active);
}

function showWorkshop(): void {
  showMeta('workshop');
  refreshWorkshop();
}

// ---------- 卡片畫面 ----------

function setMetaNav(active: MetaScreen): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.meta-nav button')) {
    b.classList.toggle('active', b.dataset.meta === active);
  }
}

function showCards(): void {
  showMeta('cards');
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

function cardIcon(def: CardDef): IconName {
  if (def.effect.kind === 'slowAura') return 'frost';
  if (def.effect.kind === 'thorns' || def.effect.kind === 'lifesteal' || def.effect.stat === 'maxHealth') return 'defense';
  if (def.effect.kind === 'interest' || def.effect.kind === 'startCash' || def.effect.stat === 'coinBonus') return 'economy';
  if (def.effect.kind === 'zoneDamage') return 'zone';
  if (def.effect.kind === 'extraPerk' || def.effect.kind === 'startPerk') return 'perk';
  return 'attack';
}

function setName(setId: string | undefined): string | null {
  return setId ? CARD_SETS.find((s) => s.id === setId)?.name ?? null : null;
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
    const requirements = [
      def.unlockWave > 0 ? `W${def.unlockWave}` : '',
      def.unlockTier ? `Tier ${def.unlockTier}` : '',
      def.unlockRuns ? `${def.unlockRuns} 場` : '',
      def.unlockKills ? `${formatNumber(def.unlockKills)} 擊殺` : '',
    ].filter(Boolean).join(' · ');
    cell.innerHTML = `
      <div class="card-art locked-art">${icon('lock')}</div>
      <div class="card-name">${def.name}</div>
      <div class="card-sub">挑戰：${requirements || '立即解鎖'}</div>`;
    return;
  }
  const cost = starUpCost(star);
  const canStar = cost !== null;
  cell.style.setProperty('--card-color', def.color);
  const bonusText = describeBonus(def);
  const bonusActive = def.bonus ? star >= def.bonus.atStar : false;
  const setLabel = setName(def.set);
  cell.innerHTML = `
    <div class="card-art" style="background:linear-gradient(160deg, ${def.color}44, ${def.color}11)">
      <span class="card-icon" style="color:${def.color}">${icon(cardIcon(def))}</span>
      <span class="card-stars">${starDots(star, CARD_CONFIG.starMax)}</span>
      ${setLabel ? `<span class="card-set">${setLabel}套</span>` : ''}
    </div>
    <div class="card-name">${def.name}</div>
    <div class="card-sub">${describeCard(def, star)}</div>
    ${bonusText ? `<div class="card-bonus ${bonusActive ? 'on' : ''}">◆ ${bonusText}</div>` : ''}
    <div class="card-actions">
      <button class="card-equip">${equipped ? '卸下' : '裝備'}</button>
      <button class="card-star" ${canStar && save.coins >= (cost as number) ? '' : 'disabled'}>${
        canStar ? `升星 ${icon('coin')}${formatNumber(cost as number)}` : 'MAX'
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
type CardFilter = 'all' | 'attack' | 'defense' | 'economy' | 'element' | 'origin';
let cardFilter: CardFilter = 'all';

function cardGroup(def: CardDef): CardFilter {
  if (def.cat === 'origin') return 'origin';
  if (def.set === 'flame' || def.set === 'frost' || def.effect.stat === 'elementalPower') return 'element';
  if (['maxHealth', 'healthRegen', 'armor', 'damageReduction', 'energyShield'].includes(def.effect.stat ?? '') || ['thorns', 'lifesteal'].includes(def.effect.kind)) return 'defense';
  if (['cashPerKill', 'cashPerWave', 'coinBonus', 'interestRate'].includes(def.effect.stat ?? '') || ['interest', 'startCash'].includes(def.effect.kind)) return 'economy';
  return 'attack';
}

function cardMatchesFilter(def: CardDef, filter: CardFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'origin') return def.cat === 'origin';
  if (filter === 'element') return def.set === 'flame' || def.set === 'frost' || def.effect.stat === 'elementalPower';
  return cardGroup(def) === filter;
}

function renderCardPresets(): void {
  const root = $('#card-presets');
  root.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    const group = document.createElement('div');
    group.className = 'preset-group';
    const count = save.cardPresets[i]?.length ?? 0;
    group.innerHTML = `<button data-load>配置 ${i + 1}${count ? ` · ${count}張` : ' · 空'}</button><button data-save>儲存</button>`;
    (group.querySelector('[data-load]') as HTMLButtonElement).addEventListener('click', () => {
      if (applyPreset(save, i)) { saveProgress(); refreshCards(); }
    });
    (group.querySelector('[data-save]') as HTMLButtonElement).addEventListener('click', () => {
      savePreset(save, i); saveProgress(); refreshCards();
    });
    root.appendChild(group);
  }
}

function renderCardFilters(): void {
  const defs: Array<[CardFilter, string]> = [['all', '全部'], ['attack', '攻擊'], ['defense', '防禦'], ['economy', '經濟'], ['element', '元素'], ['origin', '開局']];
  const root = $('#card-filters');
  root.innerHTML = '';
  for (const [id, label] of defs) {
    const b = document.createElement('button');
    b.textContent = label;
    b.classList.toggle('active', cardFilter === id);
    b.addEventListener('click', () => { cardFilter = id; refreshCards(); });
    root.appendChild(b);
  }
}
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
  renderCardPresets();
  renderCardFilters();

  // 裝備列：已用/總槽位 + 各槽內容 + 解鎖新槽位
  const slotWrap = $('#card-loadout');
  const cost = slotUnlockCost(save);
  const sets = activeSets(save.equipped, (id) => cardStar(save, id));
  const setText = sets.length
    ? ' · ' + sets.map((s) => `<span class="set-active">${s.set.name}套 ${s.count} 件：${s.tiers.join('、')}</span>`).join(' ')
    : '';
  $('#card-loadout-label').innerHTML =
    `裝備 <b class="${slotsFlash ? 'flash' : ''}">${save.equipped.length}/${save.cardSlots}</b> · 槽位有限，取捨你的流派${setText}`;
  slotWrap.innerHTML = '';
  for (let i = 0; i < save.cardSlots; i++) {
    const id = save.equipped[i];
    const slot = document.createElement('div');
    slot.className = id ? 'loadout-slot filled' : 'loadout-slot';
    if (id) {
      const def = cardById(id)!;
      slot.style.borderColor = def.color;
      slot.innerHTML = `<span class="slot-icon" style="color:${def.color}">${icon(cardIcon(def))}</span><span class="slot-name">${def.name} ${starDots(
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
    unlock.innerHTML = `${icon('lock')} 解鎖新槽位<br>${icon('coin')}${formatNumber(cost)}`;
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
  for (const def of ordered.filter((d) => cardMatchesFilter(d, cardFilter))) {
    const cell = makeCardCell(def.id);
    inv.appendChild(cell);
    refreshCardCell(cell);
  }
}

// ---------- 研究室畫面 ----------

function showResearch(): void {
  showMeta('research');
  refreshResearch();
}

// ---------- 終極武器升級畫面 ----------

function showUltimates(): void {
  showMeta('ultimates');
  refreshUltimates();
}

function refreshUltimates(): void {
  refreshWorkshop(); // 共用頂欄
  const list = $('#ultimates-list');
  list.innerHTML = '';
  for (const def of ULTIMATES) {
    const level = ultimateLevel(save, def.id);
    const owned = level >= 1;
    const row = document.createElement('div');
    row.className = 'ult-row' + (owned ? '' : ' locked');

    let cta: string;
    if (!owned) {
      cta = `<button disabled>波次 ${def.unlockWave}<br>解鎖</button>`;
    } else if (isUltimateMaxed(def, level)) {
      cta = `<button disabled>MAX</button>`;
    } else {
      const price = ultimateUpgradePrice(save, def.id)!;
      cta = `<button ${save.coins >= price ? '' : 'disabled'}>升級<br>${icon('coin')}${formatNumber(price)}</button>`;
    }

    row.innerHTML = `
      <div class="ult-icon" style="color:${def.color};background:linear-gradient(160deg, ${def.color}55, ${def.color}11)">${icon('ultimate')}</div>
      <div class="ult-body">
        <div class="ult-name">${def.name}<span class="lv">${owned ? `Lv.${level}` : '未解鎖'}</span></div>
        <div class="ult-sub">${describeUltimate(def, Math.max(level, 1))}</div>
      </div>
      <div class="ult-cta">${cta}</div>`;

    if (owned && !isUltimateMaxed(def, level)) {
      (row.querySelector('.ult-cta button') as HTMLButtonElement).addEventListener('click', () => {
        if (buyUltimateUpgrade(save, def.id)) {
          saveProgress();
          refreshUltimates();
        }
      });
    }
    list.appendChild(row);
  }
}

function fmtDuration(sec: number): string {
  if (sec >= 3600) return `${Math.floor(sec / 3600)}時${Math.floor((sec % 3600) / 60)}分`;
  if (sec >= 60) return `${Math.floor(sec / 60)}分${sec % 60}秒`;
  return `${sec}秒`;
}

function fmtResearchStat(stat: string, v: number): string {
  switch (stat) {
    case 'critChance':
      return `+${(v * 100).toFixed(1)}%`;
    case 'attackSpeed':
    case 'coinBonus':
      return `+${v.toFixed(2)}`;
    case 'healthRegen':
      return `+${v.toFixed(1)}`;
    default:
      return `+${formatNumber(v)}`;
  }
}

/** 整塊重建研究列表（開始/收成/切換分頁時）；倒數則由 tick 就地更新 */
function refreshResearch(): void {
  refreshWorkshop(); // 共用頂欄
  const list = $('#research-list');
  list.innerHTML = '';
  const busy = save.activeResearch !== null;
  for (const def of RESEARCH) {
    const level = researchLevel(save, def.id);
    const maxed = isResearchMaxed(def, level);
    const isActive = save.activeResearch?.id === def.id;
    const cost = researchCost(def, level);
    const timeSec = researchTimeSec(def, level);

    const row = document.createElement('div');
    row.className = 'research-row' + (isActive ? ' active' : busy ? ' busy-other' : '');
    row.dataset.research = def.id;

    const cur = researchValue(def, level);
    const nextGain = fmtResearchStat(def.stat, def.valuePerLevel);
    const curText = level > 0 ? `目前 ${fmtResearchStat(def.stat, cur)}` : '尚未研究';

    let ctaHtml: string;
    if (isActive) {
      ctaHtml = `<div class="research-timer" data-timer>—</div>`;
    } else if (maxed) {
      ctaHtml = `<button disabled>MAX</button>`;
    } else {
      const afford = !busy && save.coins >= cost;
      ctaHtml = `<button class="start" ${afford ? '' : 'disabled'}>開始<br>${icon('coin')}${formatNumber(cost)}</button>`;
    }

    row.innerHTML = `
      <div class="research-icon" style="color:${def.color};background:linear-gradient(160deg, ${def.color}44, ${def.color}11)">${icon(def.stat.includes('Health') || def.stat === 'healthRegen' ? 'defense' : def.stat.includes('coin') || def.stat.includes('cash') ? 'economy' : 'research')}</div>
      <div class="research-body">
        <div class="research-name">${def.name}<span class="lv">Lv.${level}${maxed ? ' MAX' : ''}</span></div>
        <div class="research-sub">${curText} · 下一級 ${nextGain} · ⏱ ${fmtDuration(timeSec)}</div>
        ${isActive ? '<div class="research-bar"><span data-bar style="width:0%"></span></div>' : ''}
      </div>
      <div class="research-cta">${ctaHtml}</div>`;

    if (!isActive && !maxed) {
      (row.querySelector('.research-cta button') as HTMLButtonElement)?.addEventListener('click', () => {
        if (startResearch(save, def.id, Date.now())) {
          saveProgress();
          refreshResearch();
        }
      });
    }
    list.appendChild(row);
  }
  tickResearch(); // 立即填入倒數/進度
}

/** 每秒就地更新倒數與進度，並在完成時自動收成 */
function tickResearch(): void {
  if (!save.activeResearch) return;
  const now = Date.now();
  const done = collectResearch(save, now);
  if (done) {
    saveProgress();
    if (researchScreen.classList.contains('active')) refreshResearch();
    return;
  }
  if (!researchScreen.classList.contains('active')) return;
  const remain = researchRemainingSec(save, now);
  const prog = researchProgress(save, now);
  const timerEl = document.querySelector('[data-timer]') as HTMLElement | null;
  const barEl = document.querySelector('[data-bar]') as HTMLElement | null;
  if (timerEl) timerEl.textContent = fmtDuration(remain);
  if (barEl) barEl.style.width = `${Math.round(prog * 100)}%`;
}

setInterval(tickResearch, 1000);

// ---------- 戰鬥畫面 ----------

const battleButtons: UpgradeButton[] = IN_RUN_UPGRADES.map((def) =>
  makeUpgradeButton(def, () => {
    if (!sim) return;
    const cashBefore = sim.cash;
    if (buyInRunUpgrade(sim, def.id)) {
      // 免費升級機率命中：現金未扣，給金幣音效與提示
      const wasFree = sim.cash === cashBefore;
      Sound.play(wasFree ? 'coin' : 'buy');
      if (wasFree) flashFreeUpgrade();
      refreshBattleButtons();
    }
  })
);

/** 免費升級命中時的短暫提示 */
function flashFreeUpgrade(): void {
  const banner = $('#free-banner');
  banner.classList.remove('show');
  void banner.offsetWidth;
  banner.classList.add('show');
}

const TABS: Array<{ id: UpgradeCategory; name: string; icon: IconName }> = [
  { id: 'attack', name: '攻擊', icon: 'attack' },
  { id: 'defense', name: '防禦', icon: 'defense' },
  { id: 'economy', name: '經濟', icon: 'economy' },
];

function buildTabs(): void {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  for (const t of TABS) {
    const b = document.createElement('button');
    b.innerHTML = `${icon(t.icon)}<span>${t.name}</span>`;
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
const TARGET_LABELS: Record<TargetPriority, string> = {
  closest: '最近', farthest: '最遠', highHp: '最高血', lowHp: '最低血', elite: '精英', ranged: '遠程',
};

function buildBattleTopbar(): void {
  topbar.classList.add('battle-hud');
  topbar.innerHTML = `
    <div class="stat stat-primary"><span class="label">${icon('wave')}波次</span><span class="value" data-wave></span></div>
    <div class="stat"><span class="label">${icon('zone')}戰區</span><span class="value" data-zone></span></div>
    <div class="stat"><span class="label">${icon('cash')}現金</span><span class="value cash" data-cash></span></div>
    <div class="stat"><span class="label">${icon('coin')}金幣</span><span class="value coin" data-coin></span></div>
    <div class="stat hp-stat"><span class="label">${icon('health')}核心</span><span class="value" data-hp></span><span class="hp-track"><span class="hp-fill"></span></span><span class="status-pips" data-status></span></div>
    <div class="spacer"></div>
    <button id="speed-btn" class="speed-btn">${icon('speed')}<span>x${speed}</span></button>`;
  const speedBtn = $('#speed-btn') as HTMLButtonElement;
  speedBtn.addEventListener('click', () => {
    speed = speed >= 3 ? 1 : speed + 1;
    (speedBtn.querySelector('span') as HTMLElement).textContent = `x${speed}`;
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
  hud.wave.textContent = sim.tier > 1 ? `T${sim.tier}·${sim.wave}` : String(sim.wave);
  const zone = zoneForWave(sim.wave);
  if (hud.zone.textContent !== zone.name) {
    hud.zone.textContent = zone.name;
    hud.zone.style.color = zone.accent;
  }
  hud.cash.textContent = `$ ${formatNumber(dispCash)}`;
  hud.coin.textContent = formatNumber(dispCoin);
  hud.hp.textContent = `${formatNumber(Math.max(Math.ceil(dispHp), 0))}/${formatNumber(sim.stats.maxHealth)}${sim.shieldHp > 0 ? ` +${formatNumber(sim.shieldHp)}` : ''}`;
  const ratio = sim.towerHp / sim.stats.maxHealth;
  hud.hp.style.color = ratio > 0.35 ? '' : '#f85149';
  const hpFill = topbar.querySelector('.hp-fill') as HTMLElement;
  hpFill.style.width = `${Math.max(0, ratio) * 100}%`;
  hpFill.style.background = ratio > 0.35 ? '#4fe08a' : '#f85149';
  const status = topbar.querySelector('[data-status]') as HTMLElement;
  status.innerHTML = sim.perks.includes('incendiary') ? '<span style="color:#ff7a3d;background:#ff7a3d"></span>' : '';
  if (sim.perks.includes('cryoRounds')) status.innerHTML += '<span style="color:#72d8ff;background:#72d8ff"></span>';

  const boss = sim.enemies.find((e) => e.typeId === 'boss');
  const bossHud = $('#boss-hud');
  bossHud.classList.toggle('active', Boolean(boss));
  if (boss) {
    const bossRatio = Math.max(0, boss.hp / boss.maxHp);
    (bossHud.querySelector('.boss-fill') as HTMLElement).style.width = `${bossRatio * 100}%`;
    const bossNames = { swarm: '蟲群母艦', bulwark: '壁壘巨像', leech: '噬命領主', chrono: '時序監督者' };
    (bossHud.querySelector('[data-boss-name]') as HTMLElement).textContent = `${bossNames[boss.bossArchetype ?? 'swarm']} · 階段 ${boss.bossPhase}`;
    const summonIn = Math.max(0, boss.summonTimer);
    const skills = { swarm: `召喚 ${summonIn.toFixed(1)}s`, bulwark: `護盾 ${formatNumber(boss.affixShield)}`, leech: '攻擊吸血 8%', chrono: sim.bossSlowTimer > 0 ? '時間壓制中' : `時間脈衝 ${Math.max(0,boss.affixTimer).toFixed(1)}s` };
    (bossHud.querySelector('[data-boss-skill]') as HTMLElement).textContent = skills[boss.bossArchetype ?? 'swarm'];
    bossHud.classList.toggle('threatening', summonIn <= 1.5);
  } else {
    bossHud.classList.remove('threatening');
  }
  $('#target-btn').textContent = `索敵：${TARGET_LABELS[sim.targetPriority]}`;
}

$('#target-btn').addEventListener('click', () => {
  if (!sim) return;
  cycleTargetPriority(sim);
  Sound.play('click');
  $('#target-btn').textContent = `索敵：${TARGET_LABELS[sim.targetPriority]}`;
});

/** 只刷新升級按鈕（成本/買得起狀態），與頂欄滾動分開 */
function refreshBattleButtons(): void {
  if (!sim) return;
  for (const btn of battleButtons) {
    const nextLevels = { ...sim.inRunLevels, [btn.def.id]: (sim.inRunLevels[btn.def.id] ?? 0) + 1 };
    const next = computeStats(sim.workshopLevels, nextLevels, sim.researchLevels);
    applyPerks(next, sim.perks);
    applyCardStatMods(next, sim.mods.statMods);
    refreshUpgradeButton(btn, sim.inRunLevels[btn.def.id] ?? 0, sim.cash, 'cash', sim.stats[btn.def.stat], next[btn.def.stat]);
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
  } else if (isZoneEntryWave(wave)) {
    // 跨入新戰區：以戰區主題色宣告
    const zone = zoneForWave(wave);
    banner.textContent = `🌐 ${zone.name}｜${zone.mechanic.name}：${zone.mechanic.desc}`;
    banner.className = 'show';
    banner.style.background = zone.accent;
    banner.style.boxShadow = `0 4px 22px ${zone.accent}`;
  } else {
    banner.textContent = `Wave ${wave}`;
    banner.className = 'show';
  }
  bannerTimer = boss ? 2.4 : isZoneEntryWave(wave) ? 4.2 : 1.6;
}

// ---------- Perk 三選一（模擬已在 core 暫停，選完才恢復） ----------

const perkOverlay = $('#perk-overlay');

function schoolLink(school: string, prerequisite: string | null): string {
  if (prerequisite) return `聯動：${prerequisite}`;
  if (school === 'fire') return '燃燒流核心';
  if (school === 'frost') return '冰凍流核心';
  if (school === 'form') return '攻擊形態';
  if (school === 'trigger') return '觸發效果';
  if (school === 'risk') return '高風險';
  return '即時強化';
}

function renderPerkCards(wave: number, choices: string[]): void {
  $('#perk-sub').textContent = `Wave ${wave} 獎勵 · 本場有效`;
  const cards = $('#perk-cards');
  cards.innerHTML = '';
  for (const id of choices) {
    const def = perkById(id);
    if (!def) continue;
    const btn = document.createElement('button');
    const school = perkSchool(def);
    const visualIcon: IconName = school === 'fire' ? 'fire' : school === 'frost' ? 'frost' : school === 'form' ? 'attack' : school === 'risk' ? 'risk' : 'perk';
    const owned = sim ? perkStacks(sim.perks, id) : 0;
    btn.className = `perk-card school-${school} rar-${def.rarity}${def.risky ? ' risky' : ''}`;
    const prerequisite = def.prerequisite ? perkById(def.prerequisite)?.name ?? null : null;
    const stackBadge = owned > 0 && def.stackable ? `<span class="perk-stack">Lv ${owned} → ${owned + 1}</span>` : '';
    btn.innerHTML =
      `<span class="perk-art">${icon(visualIcon)}</span>` +
      `<span class="perk-name"></span>` +
      `<span class="perk-rarity">${perkRarity(def)}</span>` +
      `<span class="perk-desc"></span>` +
      `<span class="perk-link">${schoolLink(school, prerequisite)}</span>` +
      stackBadge;
    (btn.querySelector('.perk-name') as HTMLElement).textContent = def.name;
    (btn.querySelector('.perk-desc') as HTMLElement).textContent = def.desc;
    btn.addEventListener('click', () => {
      if (sim && choosePerk(sim, id)) {
        Sound.play('buy');
        perkOverlay.classList.remove('active');
        refreshBattleButtons();
      }
    });
    cards.appendChild(btn);
  }
  updatePerkFooter();
}

/** 重骰／跳過按鈕狀態（花費、可否負擔） */
function updatePerkFooter(): void {
  if (!sim) return;
  const cost = currentRerollCost(sim);
  const rerollBtn = $('#perk-reroll') as HTMLButtonElement;
  const skipBtn = $('#perk-skip') as HTMLButtonElement;
  rerollBtn.disabled = sim.cash < cost;
  rerollBtn.innerHTML = `${icon('coin')} 重骰 <b>$${formatNumber(cost)}</b>`;
  skipBtn.textContent = '跳過領錢';
}

function showPerkChoice(wave: number, choices: string[]): void {
  renderPerkCards(wave, choices);
  perkOverlay.classList.add('active');
}

$('#perk-reroll').addEventListener('click', () => {
  if (sim && rerollPerks(sim)) {
    Sound.play('click');
    renderPerkCards(sim.wave, sim.pendingPerks ?? []);
    refreshBattleButtons();
  }
});
$('#perk-skip').addEventListener('click', () => {
  if (sim && sim.pendingPerks) {
    const reward = skipPerks(sim);
    Sound.play(reward > 0 ? 'coin' : 'click');
    perkOverlay.classList.remove('active');
    refreshBattleButtons();
  }
});

// ---------- 離線收益（開啟遊戲時結算一次） ----------

function checkOfflineEarnings(): void {
  const now = Date.now();
  const elapsedSec = (now - save.lastSeenAt) / 1000;
  const gained = save.lastSeenAt > 0 ? offlineCoins(save.coinRate, elapsedSec) : 0;
  // 離線期間完成的研究（load 時已 collectResearch 結算）也在此一併告知
  const doneDef = offlineResearch ? researchById(offlineResearch) : undefined;
  if (gained < 1 && !doneDef) return;
  if (gained >= 1) {
    save.coins += gained;
    saveProgress();
  }
  const hours = Math.floor(elapsedSec / 3600);
  const mins = Math.floor((elapsedSec % 3600) / 60);
  const durText = hours > 0 ? `${hours} 小時 ${mins} 分` : `${mins} 分鐘`;
  const researchRow = doneDef
    ? `<div class="row"><span class="label">完成研究</span><span class="value">${doneDef.icon} ${doneDef.name} Lv.${researchLevel(save, doneDef.id)}</span></div>`
    : '';
  const coinRow =
    gained >= 1
      ? `<div class="row"><span class="label">獲得金幣</span><span class="value coin" data-offroll>+🪙 0</span></div>`
      : '';
  $('#offline-rows').innerHTML = `
    <div class="row"><span class="label">離線時間</span><span class="value">${durText}</span></div>
    ${coinRow}${researchRow}`;
  $('#offline-modal').classList.add('active');
  if (gained >= 1) {
    rollNumber($('#offline-rows').querySelector('[data-offroll]') as HTMLElement, gained, 0.8, '+🪙 ');
  }
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

// ---------- 終極武器：戰鬥中施放鈕 ----------

function buildUltBar(): void {
  const bar = $('#ult-bar');
  bar.innerHTML = '';
  if (!sim) return;
  for (const u of sim.ultimates) {
    const def = ultimateById(u.id);
    const btn = document.createElement('button');
    btn.className = 'ult-btn';
    btn.dataset.ult = u.id;
    btn.style.setProperty('--ult-color', u.color);
    btn.innerHTML = `<span class="glyph">${icon(u.kind === 'coinBuff' ? 'coin' : 'ultimate')}</span><div class="cool-mask"></div><div class="cool-num"></div>`;
    btn.addEventListener('click', () => {
      if (sim && activateUltimate(sim, u.id)) updateUltBar();
    });
    bar.appendChild(btn);
  }
}

function updateUltBar(): void {
  if (!sim) return;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#ult-bar .ult-btn')) {
    const id = btn.dataset.ult!;
    const u = sim.ultimates.find((x) => x.id === id);
    if (!u) continue;
    const cd = sim.ultCooldowns[id] ?? 0;
    const cooling = cd > 0;
    btn.classList.toggle('cooling', cooling);
    btn.disabled = cooling || sim.over;
    const mask = btn.querySelector('.cool-mask') as HTMLElement;
    const num = btn.querySelector('.cool-num') as HTMLElement;
    if (cooling) {
      mask.style.height = `${Math.round(Math.min(cd / u.cooldown, 1) * 100)}%`;
      num.textContent = String(Math.ceil(cd));
    } else {
      mask.style.height = '0%';
      num.textContent = '';
    }
  }
}

function startBattle(): void {
  const mods = buildRunMods(save.equipped, (id) => cardStar(save, id));
  sim = newRun(
    save.workshopLevels,
    (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
    mods,
    save.researchLevels,
    resolvedUltimates(save),
    save.tier
  );
  resultsShown = false;
  perkOverlay.classList.remove('active');
  dispCash = 0;
  dispCoin = 0;
  dispHp = sim.stats.maxHealth;
  vfx.texts.length = 0;
  vfx.particles.length = 0;
  vfx.flash.clear();
  vfx.shocks.length = 0;
  vfx.chains.length = 0;
  vfx.goldGlow = 0;
  workshopScreen.classList.remove('active');
  battleScreen.classList.add('active');
  buildBattleTopbar();
  buildTabs();
  buildBattleGrid();
  buildUltBar();
  showWaveBanner(1, false);
  // 排行榜：登入且雲端就緒時，向後端開一場 run session（供結算時提交防作弊）
  activeRunId = null;
  runWallStart = Date.now();
  runUltCasts = 0;
  if (cloudReady && cloudUser && cloudModule) {
    const user = cloudUser;
    cloudModule
      .startRun(user)
      .then((id) => {
        activeRunId = id;
      })
      .catch(() => {
        activeRunId = null;
      });
  }
}

// 排行榜提交用：本場的後端 run id 與真實開始時間（牆鐘）
let activeRunId: string | null = null;
let runWallStart = 0;
// 每日任務用：本場終極武器施放次數
let runUltCasts = 0;

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
  // 這一場刷新紀錄後可能解鎖新卡片 / 終極武器 / Tier
  const newCards = syncCardUnlocks(save);
  const newUlts = syncUltimateUnlocks(save);
  const newTier = settleTier(save, s.tier, s.wave);
  // 每日任務進度
  ensureDaily(save);
  applyRunToMissions(save, { kills: s.kills, coins: s.coinsEarned, wave: s.wave, ults: runUltCasts });
  updateDailyBadge();
  saveProgress();
  const unlockedLine = newCards.length
    ? `<div class="record">🃏 解鎖新卡片：${newCards.map((id) => cardById(id)?.name ?? id).join('、')}</div>`
    : '';
  const ultLine = newUlts.length
    ? `<div class="record">💥 解鎖終極武器：${newUlts.map((id) => ultimateById(id)?.name ?? id).join('、')}</div>`
    : '';
  const tierLine = newTier
    ? `<div class="record">🔓 解鎖 Tier ${newTier}！（+🪙${formatNumber(TIER_CONFIG.firstClearCoins * newTier)}）</div>`
    : '';
  const damageNames = { direct:'砲塔直擊', burn:'燃燒', chain:'連鎖閃電', splash:'爆炸', bounce:'彈射', thorns:'反傷', ultimate:'終極武器', satellite:'軌道衛星' };
  const totalDamage = Object.values(s.damageBreakdown).reduce((a,b) => a+b, 0);
  const damageRows = Object.entries(s.damageBreakdown).sort((a,b)=>b[1]-a[1]).slice(0,3).filter(([,v])=>v>0)
    .map(([k,v]) => `<div class="row"><span class="label">${damageNames[k as keyof typeof damageNames]}</span><span class="value">${formatNumber(v)} · ${totalDamage ? Math.round(v/totalDamage*100) : 0}%</span></div>`).join('');
  $('#results-rows').innerHTML = `
    ${isRecord ? '<div class="record">🏆 新紀錄！</div>' : ''}
    ${unlockedLine}${ultLine}${tierLine}
    <div class="row"><span class="label">難度</span><span class="value">T${s.tier}</span></div>
    <div class="row"><span class="label">到達波次</span><span class="value">${s.wave}</span></div>
    <div class="row"><span class="label">擊殺數</span><span class="value">${formatNumber(s.kills)}</span></div>
    <div class="row"><span class="label">承受傷害</span><span class="value">${formatNumber(s.damageTaken)}</span></div>
    <div class="row"><span class="label">致命來源</span><span class="value">${s.lastDamageSource}</span></div>
    ${damageRows}
    <div class="row"><span class="label">獲得金幣</span><span class="value coin" data-coinroll>+🪙 0</span></div>
    <div class="row"><span class="label">歷史最高</span><span class="value">${save.bestWave}</span></div>`;
  $('#results').classList.add('active');
  rollNumber($('#results-rows').querySelector('[data-coinroll]') as HTMLElement, s.coinsEarned, 0.8, '+🪙 ');
  Sound.play('gameover');
  if (s.coinsEarned >= 1) setTimeout(() => Sound.coinCascade(), 350);

  // 排行榜提交：把 Tier 編碼進分數（tier*100000+wave），讓排名兼顧難度與深度
  const durationMs = Date.now() - runWallStart;
  if (cloudReady && cloudUser && cloudModule && activeRunId && durationMs >= 1000) {
    const score = s.tier * 100000 + s.wave;
    cloudModule
      .submitRun(cloudUser, { runId: activeRunId, wave: score, kills: s.kills, durationMs })
      .catch(() => undefined);
  }
  activeRunId = null;
}

// ---------- 排行榜 ----------

const boardModal = $('#board-modal');

/** 把編碼分數還原成 Tier 與波次（舊/純波次資料 < 100000 視為 T1） */
function decodeScore(score: number): { tier: number; wave: number } {
  if (score >= 100000) return { tier: Math.floor(score / 100000), wave: score % 100000 };
  return { tier: 1, wave: score };
}

async function openLeaderboard(): Promise<void> {
  boardModal.classList.add('active');
  const list = $('#board-list');
  if (!cloudReady || !cloudModule) {
    list.innerHTML = '<div class="board-note">雲端排行榜尚未設定。<br>設定 Firebase + Cloudflare 後即可上傳成績、與全球玩家較量最高波次。</div>';
    return;
  }
  list.innerHTML = '<div class="board-note">載入中…</div>';
  try {
    const entries = await cloudModule.fetchLeaderboard();
    if (!entries.length) {
      list.innerHTML = '<div class="board-note">還沒有人上榜——登入後打一場，成為第一名！</div>';
      return;
    }
    list.innerHTML = '';
    entries.forEach((e, i) => {
      const { tier, wave } = decodeScore(e.bestWave);
      const row = document.createElement('div');
      row.className = 'board-row' + (i < 3 ? ` top${i + 1}` : '');
      row.innerHTML = `<span class="rank">${i + 1}</span><span class="who"></span><span class="score">T${tier}·W${wave}</span>`;
      (row.querySelector('.who') as HTMLElement).textContent = e.playerName || '匿名';
      list.appendChild(row);
    });
  } catch {
    list.innerHTML = '<div class="board-note">排行榜載入失敗，請稍後再試。</div>';
  }
}

$('#board-btn').addEventListener('click', () => {
  Sound.play('click');
  void openLeaderboard();
});
$('#board-close').addEventListener('click', () => boardModal.classList.remove('active'));
boardModal.addEventListener('click', (e) => {
  if (e.target === boardModal) boardModal.classList.remove('active');
});

// ---------- 每日任務 ----------

const dailyModal = $('#daily-modal');
const dailyBtn = $('#daily-btn') as HTMLButtonElement;

function updateDailyBadge(): void {
  dailyBtn.classList.toggle('has-claim', claimableCount(save) > 0);
}

function renderDaily(): void {
  ensureDaily(save);
  const list = $('#daily-list');
  list.innerHTML = '';
  for (const m of save.dailyMissions) {
    const def = missionById(m.id);
    if (!def) continue;
    const done = isMissionComplete(def, m.progress);
    const pct = Math.min(100, Math.round((m.progress / def.target) * 100));
    const row = document.createElement('div');
    row.className = 'mission-row' + (done ? ' done' : '');
    row.innerHTML = `
      <div class="m-top"><span class="m-name"></span><span class="m-reward">🪙${formatNumber(def.reward)}</span></div>
      <div class="m-desc"></div>
      <div class="m-bar"><span style="width:${pct}%"></span></div>
      <div class="m-foot">
        <span class="m-prog">${formatNumber(Math.min(m.progress, def.target))} / ${formatNumber(def.target)}</span>
        <button class="m-claim" ${done && !m.claimed ? '' : 'disabled'}>${m.claimed ? '已領取' : '領取'}</button>
      </div>`;
    (row.querySelector('.m-name') as HTMLElement).textContent = def.name;
    (row.querySelector('.m-desc') as HTMLElement).textContent = def.desc;
    (row.querySelector('.m-claim') as HTMLButtonElement).addEventListener('click', () => {
      if (claimMission(save, m.id) > 0) {
        Sound.play('buy');
        saveProgress();
        updateDailyBadge();
        renderDaily();
        if (!sim) refreshWorkshop();
      }
    });
    list.appendChild(row);
  }
}

dailyBtn.addEventListener('click', () => {
  Sound.play('click');
  renderDaily();
  dailyModal.classList.add('active');
});
$('#daily-close').addEventListener('click', () => dailyModal.classList.remove('active'));
dailyModal.addEventListener('click', (e) => {
  if (e.target === dailyModal) dailyModal.classList.remove('active');
});
updateDailyBadge();

// ---------- 主迴圈：固定 tick 模擬 + 每幀渲染 ----------

let lastTime = performance.now();
let accumulator = 0;
let uiTimer = 0;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.25);
  lastTime = now;

  if (sim && !sim.over) {
    accumulator += dt * speed;
    while (accumulator >= TICK_DT && !sim.pendingRoute) {
      step(sim, TICK_DT);
      // 取走本 tick 的視覺事件（下個 step 開頭會清空）
      vfx.ingest(sim.events);
      for (const e of sim.events) {
        if (e.type === 'wave') {
          showWaveBanner(e.wave, e.boss);
          Sound.play(e.boss ? 'boss' : 'wave');
        }
        if (e.type === 'perkOffer') showPerkChoice(e.wave, e.choices);
        else if (e.type === 'routeOffer') $('#route-overlay').classList.add('active');
        else if (e.type === 'fire') Sound.play('fire');
        else if (e.type === 'hit') Sound.play(e.crit ? 'crit' : 'hit');
        else if (e.type === 'kill') Sound.play(e.typeId === 'coin' ? 'coin' : 'kill');
        else if (e.type === 'ultActivate') { Sound.play('ult'); runUltCasts++; }
        else if (e.type === 'ultNuke') { Sound.play('nuke'); runUltCasts++; }
      }
      accumulator -= TICK_DT;
    }
    updateBattleHud(dt);
    uiTimer += dt;
    if (uiTimer >= 0.1) {
      uiTimer = 0;
      refreshBattleButtons();
      updateUltBar();
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

$('#start-btn').addEventListener('click', () => {
  Sound.play('click');
  startBattle();
});
$('#results-btn').addEventListener('click', showWorkshop);
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-route]')) button.addEventListener('click', () => {
  if (sim && chooseRoute(sim, button.dataset.route as 'safe'|'danger')) {
    $('#route-overlay').classList.remove('active'); accumulator = 0; Sound.play('click');
  }
});

// 工坊 / 卡片 / 研究 分頁切換
for (const b of document.querySelectorAll<HTMLButtonElement>('.meta-nav button')) {
  b.addEventListener('click', () => {
    Sound.play('click');
    if (b.dataset.meta === 'cards') showCards();
    else if (b.dataset.meta === 'research') showResearch();
    else if (b.dataset.meta === 'ultimates') showUltimates();
    else showWorkshop();
  });
}

// 音效：首個手勢喚醒音訊環境；靜音鈕
const soundBtn = $('#sound-btn') as HTMLButtonElement;
soundBtn.textContent = Sound.muted ? '🔇' : '🔊';
soundBtn.classList.toggle('muted', Sound.muted);
soundBtn.addEventListener('click', () => {
  const muted = Sound.toggleMute();
  soundBtn.textContent = muted ? '🔇' : '🔊';
  soundBtn.classList.toggle('muted', muted);
  if (!muted) Sound.play('click');
});
window.addEventListener('pointerdown', () => Sound.unlock(), { once: true });

showWorkshop();
checkOfflineEarnings();
requestAnimationFrame(frame);
