import { activateTactic, activateUltimate, activeSynergies, buyInRunUpgrade, choosePerk, chooseRoute, chooseSpecialization, currentRerollCost, cycleTargetPriority, inRunUpgradeCost, newRun, rerollPerks, setSpawnViewport, skipPerks, step, TICK_DT, type SimState } from './core/sim';
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
  toggleUltimateEquip,
} from './meta/ultimates';
import type { RouteId, SpecializationId, StatId, TacticId, TargetPriority, UpgradeCategory, UpgradeDef } from './core/types';
import { applySave, ensurePlayerId, localStorageStore, mergeSaveProgress, type SaveData } from './meta/save';
import { buyWorkshopUpgrade, settleRun } from './meta/workshop';
import { render } from './ui/renderer';
import { Vfx } from './ui/vfx';
import { icon, type IconName } from './ui/icons';
import { CARD_RARITY_LABEL, cardArtUrl, cardRarity } from './ui/card-art';
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
const syncButton = $('#sync-btn') as HTMLButtonElement;

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
  const goldIcon = document.querySelector<HTMLElement>('[data-gold-icon]');
  if (goldIcon) goldIcon.innerHTML = icon('coin');
}
decorateStaticUi();

function setAuthStatus(text: string, busy = false): void {
  authStatus.textContent = text;
  authButton.disabled = busy;
}

function showSyncRetry(show: boolean): void { syncButton.hidden = !show; }

function saveProgress(): void {
  save.lastSeenAt = Date.now();
  store.save(save);
  if (!cloudUser) return;
  const user = cloudUser;
  const snapshot = structuredClone(save);
  cloudWrite = cloudWrite
    .then(async () => {
      try {
        cloudRevision = await cloudModule!.writeCloudSave(user, snapshot, cloudRevision);
      } catch (error) {
        if (!(error instanceof cloudModule!.CloudApiError) || error.status !== 409) throw error;
        const latest = await cloudModule!.loadCloudSave(user);
        const merged = latest.save ? mergeSaveProgress(snapshot, latest.save) : snapshot;
        cloudRevision = await cloudModule!.writeCloudSave(user, merged, latest.revision);
        applySave(save, merged);
        store.save(save);
        if (!sim) refreshWorkshop();
      }
    })
    .then(() => { setAuthStatus(`☁️ ${cloudUser?.email ?? '已同步'} · 已同步`); showSyncRetry(false); })
    .catch((error) => { console.error('cloud_save_failed', error); setAuthStatus('⚠️ 雲端同步失敗，本機進度已保存'); showSyncRetry(true); });
}

async function reconcileCloud(user: User): Promise<void> {
  setAuthStatus('☁️ 正在同步…', true);
  try {
    const result = await cloudModule!.loadCloudSave(user);
    cloudRevision = result.revision;
    const merged = result.save ? mergeSaveProgress(save, result.save) : structuredClone(save);
    applySave(save, merged);
    store.save(save);
    cloudRevision = await cloudModule!.writeCloudSave(user, save, cloudRevision);
    setAuthStatus(`☁️ ${user.email ?? 'Google 帳號'} · 已同步`);
    showSyncRetry(false);
    if (!sim) refreshWorkshop();
  } catch (error) {
    console.error('cloud_reconcile_failed', error);
    setAuthStatus('⚠️ 雲端連線失敗，本機模式');
    showSyncRetry(true);
  } finally {
    authButton.disabled = false;
  }
}

syncButton.addEventListener('click', () => { if (cloudUser) void reconcileCloud(cloudUser); });

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
    case 'splashChance':
    case 'thorns':
    case 'killHeal':
    case 'upgradeDiscount':
      return `${(v * 100).toFixed(1)}%`;
    case 'critFactor':
    case 'cashPerKill':
    case 'coinBonus':
    case 'elementalPower':
    case 'eliteDamage':
    case 'eliteBounty':
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
  el.className = `upgrade-btn upgrade-${def.category}`;
  el.innerHTML =
    `<span class="upgrade-icon">${icon(def.category === 'attack' ? 'attack' : def.category === 'defense' ? 'defense' : 'economy')}</span>` +
    `<span class="upgrade-copy">` +
      `<span class="name"></span>` +
      `<span class="value"><span class="current"></span><span class="preview"></span></span>` +
      `<span class="milestone"></span>` +
      `<span class="foot"><span class="delta"></span><span class="cost"></span></span>` +
    `</span>`;
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
  nextValue: number,
  actualCost?: number
): void {
  const { def, el } = btn;
  const maxed = isMaxed(def, level);
  const cost = actualCost ?? upgradeCost(def, level);
  el.classList.remove('upgrade-attack', 'upgrade-defense', 'upgrade-economy');
  el.classList.add(`upgrade-${def.category}`);
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
  const commandWave = document.querySelector<HTMLElement>('[data-command-wave]');
  const commandTier = document.querySelector<HTMLElement>('[data-command-tier]');
  const commandGoal = document.querySelector<HTMLElement>('[data-command-goal]');
  if (commandWave) commandWave.textContent = `W${save.bestWave}`;
  if (commandTier) commandTier.textContent = `TIER ${save.tier}`;
  if (commandGoal) {
    const tierBestWave = tierBest(save, save.tier);
    commandGoal.textContent = save.tier < TIER_CONFIG.maxTier && tierBestWave < TIER_CONFIG.unlockWave
      ? `W${TIER_CONFIG.unlockWave}`
      : 'BUILD +1';
  }
  for (const btn of workshopButtons) {
    refreshUpgradeButton(btn, save.workshopLevels[btn.def.id] ?? 0, save.coins, 'coin', startStats[btn.def.stat], startStats[btn.def.stat] + btn.def.valuePerLevel);
  }
  refreshTierSelector();
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-spec]')) b.classList.toggle('active', b.dataset.spec === save.workshopSpec);
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
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-spec]')) b.addEventListener('click', () => {
  save.workshopSpec = b.dataset.spec as SaveData['workshopSpec']; saveProgress(); refreshWorkshop(); Sound.play('click');
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

function cardArtMarkup(def: CardDef, star: number, locked = false): string {
  const rarity = cardRarity(def.id);
  return `<div class="card-art${locked ? ' locked-art' : ''}">
    <img class="card-art-image" src="${cardArtUrl(def.id)}" alt="" loading="lazy">
    <span class="card-art-shade"></span>
    <span class="card-hud"><span>TACTICAL ASSET</span><span>${def.id.toUpperCase()}</span></span>
    <span class="card-icon" style="color:${def.color}">${locked ? icon('lock') : icon(cardIcon(def))}</span>
    ${locked ? '' : `<span class="card-stars">${starDots(star, CARD_CONFIG.starMax)}</span>`}
    <span class="card-rarity rar-${rarity}">${CARD_RARITY_LABEL[rarity]}</span>
    ${!locked && def.set ? `<span class="card-set">${setName(def.set)}套</span>` : ''}
  </div>`;
}

function installCardArtFallback(cell: HTMLElement): void {
  const image = cell.querySelector<HTMLImageElement>('.card-art-image');
  image?.addEventListener('error', () => image.remove(), { once: true });
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
  const rarity = cardRarity(id);
  cell.classList.remove('rar-common', 'rar-rare', 'rar-epic', 'rar-legendary');
  cell.classList.add(`rar-${rarity}`);
  if (!owned) {
    const requirements = [
      def.unlockWave > 0 ? `W${def.unlockWave}` : '',
      def.unlockTier ? `Tier ${def.unlockTier}` : '',
      def.unlockRuns ? `${def.unlockRuns} 場` : '',
      def.unlockKills ? `${formatNumber(def.unlockKills)} 擊殺` : '',
    ].filter(Boolean).join(' · ');
    cell.innerHTML = `
      ${cardArtMarkup(def, 0, true)}
      <div class="card-name">${def.name}</div>
      <div class="card-sub">挑戰：${requirements || '立即解鎖'}</div>`;
    installCardArtFallback(cell);
    return;
  }
  const cost = starUpCost(star);
  const canStar = cost !== null;
  const shardCost = star === 1 ? 15 : 35;
  const canAffordStar = canStar && (save.coins >= (cost as number) || save.cardShards >= shardCost);
  cell.style.setProperty('--card-color', def.color);
  const bonusText = describeBonus(def);
  const bonusActive = def.bonus ? star >= def.bonus.atStar : false;
  const contribution = save.lastRunReport?.cards[id] ?? 0;
  const estimate = def.effect.stat === 'maxHealth' || def.effect.kind==='thorns' || def.effect.kind==='lifesteal' ? '生存提升' : def.effect.stat==='coinBonus' || def.effect.kind==='interest' ? '收益提升' : '輸出提升';
  cell.innerHTML = `
    ${cardArtMarkup(def, star)}
    <div class="card-name">${def.name}</div>
    <div class="card-sub">${describeCard(def, star)}</div>
    <div class="card-estimate">${equipped?'目前生效':`裝備預估：${estimate}`}</div>
    ${contribution > 0 ? `<div class="card-contribution">上場貢獻 ${formatNumber(contribution)}</div>` : ''}
    ${bonusText ? `<div class="card-bonus ${bonusActive ? 'on' : ''}">◆ ${bonusText}</div>` : ''}
    ${star>=3?`<div class="card-variants"><button data-card-variant="power" class="${save.cardVariants[id]==='power'?'active':''}">火力變體</button><button data-card-variant="utility" class="${save.cardVariants[id]==='utility'?'active':''}">資源變體</button></div>`:''}
    <div class="card-actions">
      <button class="card-equip">${equipped ? '卸下' : '裝備'}</button>
      <button class="card-star" ${canAffordStar ? '' : 'disabled'}>${
        canStar ? (save.coins >= (cost as number) ? `升星 ${icon('coin')}${formatNumber(cost as number)}` : `升星 🧩${shardCost}`) : 'MAX'
      }</button>
    </div>`;
  installCardArtFallback(cell);
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
  for(const b of cell.querySelectorAll<HTMLButtonElement>('[data-card-variant]')) b.addEventListener('click',()=>{save.cardVariants[id]=b.dataset.cardVariant as 'power'|'utility';saveProgress();refreshCards();});
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
  const presetCount = 3 + Math.min(2, save.researchLevels.r_report ?? 0);
  for (let i = 0; i < presetCount; i++) {
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
  const builds = [
    ['🔥 燃燒',['emberstart','thermalcore','elemental']], ['❄️ 永凍',['frostcore','glacialcore','slowaura']],
    ['🌩️ 風暴',['stormcoil','supercap','crit']], ['🛰️ 軌道',['orbitaldock','twinorbit','voidanchor']], ['🪙 經濟',['coin','interest','warchest','bountycharter']],
  ] as const;
  $('#recommended-builds').innerHTML = builds.map(([name,ids])=>`<button data-build="${ids.join(',')}">${name}</button>`).join('');
  for(const b of document.querySelectorAll<HTMLButtonElement>('[data-build]')) b.addEventListener('click',()=>{
    save.equipped=(b.dataset.build??'').split(',').filter((id)=>cardStar(save,id)>0).slice(0,save.cardSlots); saveProgress(); refreshCards();
  });

  // 裝備列：已用/總槽位 + 各槽內容 + 解鎖新槽位
  const slotWrap = $('#card-loadout');
  const cost = slotUnlockCost(save);
  const sets = activeSets(save.equipped, (id) => cardStar(save, id));
  const setText = sets.length
    ? ' · ' + sets.map((s) => `<span class="set-active">${s.set.name}套 ${s.count} 件：${s.tiers.join('、')}</span>`).join(' ')
    : '';
  const nearSet = CARD_SETS.map((set)=>({set,count:set.members.filter((id)=>save.equipped.includes(id)).length,missing:set.members.find((id)=>!save.equipped.includes(id)&&cardStar(save,id)>0)})).find((x)=>x.count===1&&x.missing);
  $('#card-loadout-label').innerHTML =
    `裝備 <b class="${slotsFlash ? 'flash' : ''}">${save.equipped.length}/${save.cardSlots}</b> · 槽位有限，取捨你的流派${setText}${nearSet?` · <span class="set-active">再裝 ${cardById(nearSet.missing!)?.name} 啟動${nearSet.set.name}</span>`:''}`;
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
    const equipped = save.equippedUltimates.includes(def.id);
    if (equipped) row.classList.add('equipped');

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
        ${owned ? `<div class="ult-branches">${(['power','cycle','variant'] as const).map((b,i)=>`<button data-branch="${b}" class="${save.ultimateBranches[def.id]===b?'active':''}" ${level<3?'disabled':''}>${['威力','循環','變體'][i]}</button>`).join('')}</div>` : ''}
      </div>
      <div class="ult-cta">${owned ? `<button class="ult-equip">${equipped?'已攜帶':'攜帶'}</button>` : ''}${cta}</div>`;

    if (owned && !isUltimateMaxed(def, level)) {
      (row.querySelector('.ult-cta button:last-child') as HTMLButtonElement).addEventListener('click', () => {
        if (buyUltimateUpgrade(save, def.id)) {
          saveProgress();
          refreshUltimates();
        }
      });
    }
    row.querySelector<HTMLButtonElement>('.ult-equip')?.addEventListener('click', () => {
      if (!equipped && save.equippedUltimates.length >= 2) return;
      toggleUltimateEquip(save, def.id); saveProgress(); refreshUltimates();
    });
    for (const b of row.querySelectorAll<HTMLButtonElement>('[data-branch]')) b.addEventListener('click', () => {
      save.ultimateBranches[def.id] = b.dataset.branch as 'power'|'cycle'|'variant'; saveProgress(); refreshUltimates();
    });
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
    const nextGain = def.utility ? def.desc ?? '' : fmtResearchStat(def.stat ?? '', def.valuePerLevel);
    const curText = level > 0 ? (def.utility ? `研究階段 ${level}` : `目前 ${fmtResearchStat(def.stat ?? '', cur)}`) : '尚未研究';

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
      <div class="research-icon" style="color:${def.color};background:linear-gradient(160deg, ${def.color}44, ${def.color}11)">${icon(def.stat?.includes('Health') || def.stat === 'healthRegen' ? 'defense' : def.stat?.includes('coin') || def.stat?.includes('cash') ? 'economy' : 'research')}</div>
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
  const schools: Record<UpgradeCategory, Array<{ name: string; ids: string[] }>> = {
    attack: [
      { name: '火力核心', ids: ['damage','critChance','critFactor','eliteDamage'] },
      { name: '速射武裝', ids: ['attackSpeed','projectileSpeed','range','armorPen'] },
      { name: '戰術彈藥', ids: ['elementalPower','knockback','splashChance'] },
    ],
    defense: [
      { name: '堡壘裝甲', ids: ['maxHealth','armor','damageReduction'] },
      { name: '護盾修復', ids: ['energyShield','healthRegen','killHeal'] },
      { name: '反擊系統', ids: ['thorns'] },
    ],
    economy: [
      { name: '戰場收入', ids: ['cashPerKill','cashPerWave','eliteBounty'] },
      { name: '投資協議', ids: ['interestRate','upgradeDiscount'] },
      { name: '永久收益', ids: ['coinBonus'] },
    ],
  };
  for (const school of schools[activeTab]) {
    const header = document.createElement('div');
    header.className = 'upgrade-school';
    header.textContent = school.name;
    grid.appendChild(header);
    for (const id of school.ids) {
      const btn = battleButtons.find((candidate) => candidate.def.id === id);
      if (btn) grid.appendChild(btn.el);
    }
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
  closest: '最近', farthest: '最遠', highHp: '最高血', lowHp: '最低血', elite: '精英', ranged: '遠程', support: '支援',
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
  const golden = sim.ultActive.find((active) => active.id === 'golden');
  const goldBuff = $('#gold-buff');
  goldBuff.classList.toggle('active', Boolean(golden));
  if (golden) {
    const resolved = sim.ultimates.find((ultimate) => ultimate.id === 'golden');
    const duration = Math.max(resolved?.duration ?? golden.remaining, 0.01);
    const multiplier = golden.coinMult + Math.floor((golden.kills ?? 0) / 10) * 0.25;
    (goldBuff.querySelector('[data-gold-mult]') as HTMLElement).textContent = `×${multiplier.toFixed(2)}`;
    (goldBuff.querySelector('[data-gold-time]') as HTMLElement).textContent = `${golden.remaining.toFixed(1)}s`;
    (goldBuff.querySelector('.gold-fill') as HTMLElement).style.width = `${Math.min(100, golden.remaining / duration * 100)}%`;
  }
  $('#target-btn').textContent = `索敵：${TARGET_LABELS[sim.targetPriority]}`;
  ($('#energy-fill') as HTMLElement).style.width = `${sim.coreEnergy}%`;
  const synergies = activeSynergies(sim);
  $('#synergy-hud').textContent = synergies.length ? `流派連攜｜${synergies.join(' · ')}` : '';
  const tacticCosts: Record<TacticId, number> = { pulse: 35, overclock: 50, repair: 40 };
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tactic]')) {
    const tactic = button.dataset.tactic as TacticId;
    button.disabled = sim.coreEnergy < tacticCosts[tactic] || sim.tacticCooldown > 0 || Boolean(sim.pendingRoute || sim.pendingPerks || sim.pendingSpecialization);
    button.classList.toggle('active', tactic === 'overclock' && sim.overclockTimer > 0);
  }
  const challengeHud = $('#challenge-hud');
  challengeHud.classList.toggle('active', Boolean(sim.challenge));
  if (sim.challenge) {
    const c = sim.challenge;
    const progress = c.type === 'outerRing' ? ` ${Math.min(c.progress, c.goal)}/${c.goal}` : c.type === 'quickClear' ? ` ${Math.max(0, c.goal - (sim.time - c.startedAt)).toFixed(1)}s` : c.failed ? ' 已失敗' : '';
    challengeHud.textContent = `挑戰｜${c.name}${progress}`;
  }
  const immediateThreats = sim.enemies.filter((e)=>Math.hypot(e.x,e.y)<95 || (e.eliteAffix==='volatile' && Math.hypot(e.x,e.y)<150));
  const threatWarning = $('#threat-warning');
  threatWarning.classList.toggle('active', immediateThreats.length > 0);
  if (immediateThreats.length) {
    const threat = immediateThreats.reduce((a,b)=>Math.hypot(a.x,a.y)<Math.hypot(b.x,b.y)?a:b);
    const distance = Math.hypot(threat.x, threat.y) || 1;
    threatWarning.style.setProperty('--threat-x', `${50 + threat.x / distance * 44}%`);
    threatWarning.style.setProperty('--threat-y', `${50 + threat.y / distance * 44}%`);
  }
}

$('#target-btn').addEventListener('click', () => {
  if (!sim) return;
  cycleTargetPriority(sim);
  Sound.play('click');
  $('#target-btn').textContent = `索敵：${TARGET_LABELS[sim.targetPriority]}`;
});

$('#upgrade-toggle').addEventListener('click', () => {
  const drawer = $('#bottom');
  const collapsed = drawer.classList.toggle('collapsed');
  const toggle = $('#upgrade-toggle') as HTMLButtonElement;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.textContent = collapsed ? '展開升級' : '收合升級';
  Sound.play('click');
});

/** 只刷新升級按鈕（成本/買得起狀態），與頂欄滾動分開 */
function refreshBattleButtons(): void {
  if (!sim) return;
  for (const btn of battleButtons) {
    const nextLevels = { ...sim.inRunLevels, [btn.def.id]: (sim.inRunLevels[btn.def.id] ?? 0) + 1 };
    const next = computeStats(sim.workshopLevels, nextLevels, sim.researchLevels);
    applyPerks(next, sim.perks);
    applyCardStatMods(next, sim.mods.statMods);
    const level = sim.inRunLevels[btn.def.id] ?? 0;
    refreshUpgradeButton(btn, level, sim.cash, 'cash', sim.stats[btn.def.stat], next[btn.def.stat], inRunUpgradeCost(sim, btn.def, level));
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

const SPEC_OPTIONS: Record<UpgradeCategory, Array<{ id: SpecializationId; name: string; desc: string }>> = {
  attack: [
    { id: 'rapid', name: '速射核心', desc: '攻擊速度 +25%' },
    { id: 'rail', name: '軌道彈道', desc: '傷害 +18%，額外穿透 2 名' },
    { id: 'blast', name: '爆裂彈頭', desc: '命中對周圍造成 32% 濺射' },
  ],
  defense: [
    { id: 'shield', name: '相位護盾', desc: '護盾存在時承傷 -28%' },
    { id: 'thorns', name: '反應裝甲', desc: '近戰與遠程反傷 +55%' },
    { id: 'repairBay', name: '緊急維修', desc: '低於半血時持續修復' },
  ],
  economy: [
    { id: 'bounty', name: '懸賞協議', desc: '擊殺現金 +25%' },
    { id: 'interest', name: '複利引擎', desc: '每波額外 4% 利息' },
    { id: 'discount', name: '模組回收', desc: '戰鬥升級價格 -15%' },
  ],
};

function showSpecialization(category: UpgradeCategory): void {
  const names: Record<UpgradeCategory, string> = { attack: '攻擊專精', defense: '防禦專精', economy: '經濟專精' };
  $('#spec-title').textContent = names[category];
  const list = $('#spec-options');
  list.innerHTML = '';
  for (const option of SPEC_OPTIONS[category]) {
    const button = document.createElement('button');
    button.className = 'spec-option';
    button.innerHTML = `<strong>${option.name}</strong><span>${option.desc}</span>`;
    button.addEventListener('click', () => {
      if (sim && chooseSpecialization(sim, option.id)) {
        $('#spec-overlay').classList.remove('active');
        accumulator = 0;
        Sound.play('buy');
      }
    });
    list.appendChild(button);
  }
  $('#spec-overlay').classList.add('active');
}

function syncDecisionOverlays(): void {
  const routeOverlay = $('#route-overlay');
  if (!sim) {
    routeOverlay.classList.remove('active'); perkOverlay.classList.remove('active'); $('#spec-overlay').classList.remove('active');
    return;
  }
  routeOverlay.classList.toggle('active', sim.pendingRoute);
  if (sim.pendingSpecialization) {
    if (!$('#spec-overlay').classList.contains('active')) showSpecialization(sim.pendingSpecialization);
  } else $('#spec-overlay').classList.remove('active');
  if (!sim.pendingRoute && !sim.pendingSpecialization && sim.pendingPerks) {
    if (!perkOverlay.classList.contains('active')) showPerkChoice(sim.wave, sim.pendingPerks);
  } else perkOverlay.classList.remove('active');
  if (sim.pendingRoute) {
    $('#route-sub').textContent = `Wave ${sim.wave} 起生效｜預覽接下來 10 波的敵群傾向`;
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tactic]')) button.addEventListener('click', () => {
  if (sim && activateTactic(sim, button.dataset.tactic as TacticId)) {
    Sound.play('ult');
    vfx.ingest(sim.events, sim.ultActive.some((active) => active.id === 'golden'));
  }
});

// ---------- 離線收益（開啟遊戲時結算一次） ----------

function checkOfflineEarnings(): void {
  const now = Date.now();
  const elapsedSec = (now - save.lastSeenAt) / 1000;
  const gained = save.lastSeenAt > 0 ? offlineCoins(save.coinRate, elapsedSec) : 0;
  const shards = save.lastSeenAt > 0 && elapsedSec >= 3600 ? Math.min(16, Math.floor(elapsedSec / 3600) * 2) : 0;
  // 離線期間完成的研究（load 時已 collectResearch 結算）也在此一併告知
  const doneDef = offlineResearch ? researchById(offlineResearch) : undefined;
  if (gained < 1 && !doneDef && shards < 1) return;
  if (gained >= 1) {
    save.coins += gained;
    saveProgress();
  }
  if (shards > 0) { save.cardShards += shards; saveProgress(); }
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
    ${coinRow}${shards ? `<div class="row"><span class="label">找到卡片碎片</span><span class="value">🧩 +${shards}</span></div>` : ''}${researchRow}`;
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
let pendingUltTarget: string | null = null;

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
    btn.innerHTML = `<span class="glyph">${icon(u.kind === 'coinBuff' ? 'coin' : 'ultimate')}</span><div class="charge-ring"></div><div class="cool-mask"></div><div class="cool-num"></div><small></small>`;
    let holdTimer=0;
    btn.addEventListener('pointerdown',()=>{holdTimer=window.setTimeout(()=>{const tip=$('#ult-tooltip');tip.textContent=describeUltimate(def!,ultimateLevel(save,u.id));tip.classList.add('active');},450);});
    const endHold=()=>{clearTimeout(holdTimer);$('#ult-tooltip').classList.remove('active');};
    btn.addEventListener('pointerup',endHold);btn.addEventListener('pointercancel',endHold);btn.addEventListener('pointerleave',endHold);
    btn.addEventListener('click', () => {
      if (!sim) return;
      if (u.kind === 'orbital') {
        pendingUltTarget=u.id; const tip=$('#ult-tooltip');tip.textContent='點擊戰場選擇轟炸區域';tip.classList.add('active');
      } else if (activateUltimate(sim, u.id)) updateUltBar();
    });
    bar.appendChild(btn);
  }
}

canvas.addEventListener('click',(ev)=>{
  if(!sim||!pendingUltTarget)return;
  const rect=canvas.getBoundingClientRect();const world=Math.min(rect.width,rect.height);const scale=world/(330*2+60);
  const x=(ev.clientX-rect.left-rect.width/2)/scale;const y=(ev.clientY-rect.top-rect.height/2)/scale;
  if(activateUltimate(sim,pendingUltTarget,x,y)){pendingUltTarget=null;$('#ult-tooltip').classList.remove('active');updateUltBar();}
});

function updateUltBar(): void {
  if (!sim) return;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('#ult-bar .ult-btn')) {
    const id = btn.dataset.ult!;
    const u = sim.ultimates.find((x) => x.id === id);
    if (!u) continue;
    const cd = sim.ultCooldowns[id] ?? 0;
    const charge = sim.ultCharge[id] ?? 0;
    const cooling = cd > 0 || charge < 100;
    btn.classList.toggle('cooling', cooling);
    btn.classList.toggle('ready', !cooling);
    btn.disabled = cooling || sim.over;
    btn.style.setProperty('--charge', `${charge * 3.6}deg`);
    const mask = btn.querySelector('.cool-mask') as HTMLElement;
    const num = btn.querySelector('.cool-num') as HTMLElement;
    if (cooling) {
      mask.style.height = `${Math.round(Math.min(cd / u.cooldown, 1) * 100)}%`;
      num.textContent = cd > 0 ? String(Math.ceil(cd)) : `${Math.floor(charge)}%`;
    } else {
      mask.style.height = '0%';
      num.textContent = '';
    }
    (btn.querySelector('small') as HTMLElement).textContent = ultimateById(id)?.name ?? id;
  }
}

function startBattle(): void {
  const mods = buildRunMods(save.equipped, (id) => cardStar(save, id), (id)=>save.cardVariants[id]);
  if (save.workshopSpec === 'firepower') { mods.statMods.push({stat:'damage',mult:1.1}); mods.startPerks.push('precision'); }
  else if (save.workshopSpec === 'fortress') { mods.statMods.push({stat:'maxHealth',mult:1.15},{stat:'damageReduction',add:.05}); }
  else { mods.statMods.push({stat:'coinBonus',mult:1.12},{stat:'cashPerKill',mult:1.1}); }
  sim = newRun(
    save.workshopLevels,
    (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
    mods,
    save.researchLevels,
    resolvedUltimates(save),
    save.tier
  );
  (document.querySelector('[data-route="anomaly"]') as HTMLButtonElement).hidden = (save.researchLevels.r_route ?? 0) < 1;
  resultsShown = false;
  perkOverlay.classList.remove('active');
  $('#route-overlay').classList.remove('active');
  $('#spec-overlay').classList.remove('active');
  dispCash = 0;
  dispCoin = 0;
  dispHp = sim.stats.maxHealth;
  vfx.texts.length = 0;
  vfx.particles.length = 0;
  vfx.flash.clear();
  vfx.shocks.length = 0;
  vfx.chains.length = 0;
  vfx.ultCues.length = 0;
  vfx.goldGlow = 0;
  vfx.bossIntro = 0;
  vfx.critPulse = 0;
  workshopScreen.classList.remove('active');
  battleScreen.classList.add('active');
  const upgradeDrawer = $('#bottom');
  const collapseUpgrades = true;
  upgradeDrawer.classList.toggle('collapsed', collapseUpgrades);
  const upgradeToggle = $('#upgrade-toggle') as HTMLButtonElement;
  upgradeToggle.setAttribute('aria-expanded', 'false');
  upgradeToggle.textContent = '展開升級';
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
  const equippedCards = save.equipped.filter((id)=>cardStar(save,id)>0);
  const cardShare = equippedCards.length ? totalDamage / equippedCards.length : 0;
  save.lastRunReport = { damage:totalDamage, cards:Object.fromEntries(equippedCards.map((id)=>[id,cardShare])), ultimates:Object.fromEntries(s.ultimates.map((u)=>[u.id,{uses:s.ultUses[u.id]??0,damage:s.ultDamage[u.id]??0,coins:s.ultCoins[u.id]??0}])) };
  saveProgress();
  const biggestTaken = s.lastDamageSource;
  const unusedUlt = s.ultimates.find((u)=>(s.ultUses[u.id]??0)===0);
  const diagnosis = [`最大威脅：${biggestTaken}`, unusedUlt?`${ultimateById(unusedUlt.id)?.name??unusedUlt.id} 整場未使用`:'終極武器使用正常', s.activeRoute==='danger'?'危險路線提高了敵軍壓力':'可嘗試危險路線提升收益'];
  const timeline = s.battleTimeline.slice(-4).map((e)=>`W${e.wave} ${e.text}`).join(' → ');
  const ultRows = s.ultimates.map((u)=>`<div class="row"><span class="label">${ultimateById(u.id)?.name}貢獻</span><span class="value">${s.ultUses[u.id]??0} 次 · ${formatNumber(s.ultDamage[u.id]??0)} 傷害 · +${formatNumber(s.ultCoins[u.id]??0)}幣</span></div>`).join('');
  $('#results-rows').innerHTML = `
    ${isRecord ? '<div class="record">🏆 新紀錄！</div>' : ''}
    ${unlockedLine}${ultLine}${tierLine}
    <div class="row"><span class="label">難度</span><span class="value">T${s.tier}</span></div>
    <div class="row"><span class="label">到達波次</span><span class="value">${s.wave}</span></div>
    <div class="row"><span class="label">擊殺數</span><span class="value">${formatNumber(s.kills)}</span></div>
    <div class="row"><span class="label">承受傷害</span><span class="value">${formatNumber(s.damageTaken)}</span></div>
    <div class="row"><span class="label">致命來源</span><span class="value">${s.lastDamageSource}</span></div>
    ${damageRows}
    ${ultRows}
    <div class="report-note">🧠 ${diagnosis.join('<br>🧠 ')}</div>
    ${timeline?`<div class="report-timeline">${timeline}</div>`:''}
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
    setSpawnViewport(sim, canvas.clientWidth, canvas.clientHeight);
    accumulator += dt * speed;
    while (accumulator >= TICK_DT && !sim.pendingRoute && !sim.pendingPerks && !sim.pendingSpecialization) {
      step(sim, TICK_DT);
      // 取走本 tick 的視覺事件（下個 step 開頭會清空）
      vfx.ingest(sim.events, sim.ultActive.some((active) => active.id === 'golden'));
      for (const e of sim.events) {
        if (e.type === 'wave') {
          showWaveBanner(e.wave, e.boss);
          Sound.play(e.boss ? 'boss' : 'wave');
        }
        if (e.type === 'perkOffer') showPerkChoice(e.wave, e.choices);
        else if (e.type === 'routeOffer') $('#route-overlay').classList.add('active');
        else if (e.type === 'challenge') Sound.play(e.state === 'complete' ? 'coin' : 'click');
        else if (e.type === 'tactic') Sound.play('ult');
        else if (e.type === 'fire') Sound.play('fire');
        else if (e.type === 'hit') Sound.play(e.crit ? 'crit' : 'hit');
        else if (e.type === 'kill') Sound.play(e.typeId === 'coin' ? 'coin' : 'kill');
        else if (e.type === 'ultActivate') { Sound.play('ult'); runUltCasts++; const wrap=$('#canvas-wrap');wrap.classList.remove('ult-cinematic');void wrap.offsetWidth;wrap.classList.add('ult-cinematic');setTimeout(()=>wrap.classList.remove('ult-cinematic'),450); }
        else if (e.type === 'ultNuke') { Sound.play('nuke'); runUltCasts++; }
      }
      accumulator -= TICK_DT;
    }
    syncDecisionOverlays();
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
  if (sim && chooseRoute(sim, button.dataset.route as RouteId)) {
    $('#route-overlay').classList.remove('active'); accumulator = 0; Sound.play('click');
    syncDecisionOverlays();
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
