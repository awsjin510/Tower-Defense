/**
 * 離線收益（規劃書設計支柱 4 與陷阱 3）：
 * 收益 = 每秒金幣估算 × min(離線秒數, 上限) × 折扣係數。
 * 沒有上限與折扣的離線會比在線划算，玩家反而不玩——所以兩者都是硬規則。
 */
export const OFFLINE_EFFICIENCY = 0.5;
export const OFFLINE_CAP_HOURS = 8;
/** 低於這個秒數不結算，避免切個分頁回來也跳視窗 */
export const OFFLINE_MIN_SECONDS = 90;

/** 一場 run 的每秒金幣產出（供離線估算用） */
export function runCoinRate(coinsEarned: number, timeSec: number): number {
  if (coinsEarned <= 0 || timeSec <= 0) return 0;
  return coinsEarned / timeSec;
}

export function offlineCoins(coinRate: number, elapsedSec: number): number {
  if (coinRate <= 0 || !isFinite(elapsedSec) || elapsedSec < OFFLINE_MIN_SECONDS) return 0;
  const effective = Math.min(elapsedSec, OFFLINE_CAP_HOURS * 3600);
  return coinRate * effective * OFFLINE_EFFICIENCY;
}
