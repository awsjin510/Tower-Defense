import type { SimEvent } from '../core/types';
import { ENEMY_TYPES } from '../core/waves';
import { formatNumber } from '../core/economy';

const typeById = new Map(ENEMY_TYPES.map((t) => [t.id, t]));

interface FloatText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Muzzle {
  angle: number;
  life: number;
}

/** 遠程敵人對塔的射擊光束（敵人位置 → 塔） */
interface Beam {
  x: number;
  y: number;
  life: number;
}

/** 終極武器衝擊波環（從塔中心擴散） */
interface Shock {
  life: number;
  maxLife: number;
  color: string;
  source: 'ultimate' | 'zone';
}

interface UltimateCue {
  id: string;
  color: string;
  life: number;
  maxLife: number;
}

/** 彈射鏈（多重射擊）：兩點間的閃電弧，含固定抖動點以維持確定外觀 */
interface Chain {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  crit: boolean;
  life: number;
  maxLife: number;
  jitter: number[];
}

/**
 * 純視覺特效層——只吃 SimEvent，不回寫任何遊戲狀態。
 * 命中閃白以敵人 id 為鍵存在這裡，核心的 Enemy 結構保持乾淨。
 */
export class Vfx {
  texts: FloatText[] = [];
  particles: Particle[] = [];
  muzzles: Muzzle[] = [];
  beams: Beam[] = [];
  shocks: Shock[] = [];
  chains: Chain[] = [];
  ultCues: UltimateCue[] = [];
  /** 黃金塔啟用時的金光殘留（秒） */
  goldGlow = 0;
  flash = new Map<number, number>();
  shake = 0;
  private rand = 0x9e3779b9;

  /** 內部隨機（不影響遊戲 RNG，避免污染確定性模擬） */
  private rnd(): number {
    this.rand = (this.rand + 0x6d2b79f5) | 0;
    let t = Math.imul(this.rand ^ (this.rand >>> 15), 1 | this.rand);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  ingest(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'hit': {
          this.flash.set(e.id, 0.12);
          this.texts.push({
            x: e.x + (this.rnd() - 0.5) * 6,
            y: e.y - 8,
            vy: -46,
            text: formatNumber(e.dmg),
            color: e.crit ? '#ff5b5b' : '#f0e6d2',
            size: e.crit ? 22 : 14,
            life: e.crit ? 0.95 : 0.7,
            maxLife: e.crit ? 0.95 : 0.7,
          });
          if (e.crit) {
            this.texts.push({
              x: e.x,
              y: e.y - 26,
              vy: -32,
              text: '暴擊!',
              color: '#ff8f5b',
              size: 13,
              life: 0.9,
              maxLife: 0.9,
            });
          }
          break;
        }
        case 'kill': {
          const def = typeById.get(e.typeId);
          const color = e.typeId === 'coin' ? '#ffd257' : def?.color ?? '#e05555';
          const n = e.typeId === 'boss' ? 26 : e.typeId === 'tank' ? 12 : 7;
          for (let i = 0; i < n; i++) {
            const a = this.rnd() * Math.PI * 2;
            const sp = 40 + this.rnd() * (e.typeId === 'boss' ? 220 : 120);
            this.particles.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              life: 0.5 + this.rnd() * 0.4,
              maxLife: 0.9,
              color,
              size: 1.5 + this.rnd() * 2.5,
            });
          }
          break;
        }
        case 'fire':
          this.muzzles.push({ angle: e.angle, life: 0.06 });
          break;
        case 'towerHit':
          this.shake = Math.min(this.shake + Math.min(e.dmg * 0.05, 6) + 1.5, 9);
          break;
        case 'enemyShot':
          this.beams.push({ x: e.x, y: e.y, life: 0.12 });
          break;
        case 'summon': {
          // 召喚：從 Boss 腳下炸開一圈粉紫粒子
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            const sp = 90 + this.rnd() * 60;
            this.particles.push({
              x: e.x,
              y: e.y,
              vx: Math.cos(a) * sp,
              vy: Math.sin(a) * sp,
              life: 0.45 + this.rnd() * 0.25,
              maxLife: 0.7,
              color: '#d43cc8',
              size: 1.5 + this.rnd() * 2,
            });
          }
          break;
        }
        case 'ultNuke':
          this.shocks.push({ life: 0.5, maxLife: 0.5, color: e.color || '#b878ff', source: 'ultimate' });
          this.shake = Math.min(this.shake + 8, 12);
          break;
        case 'ultActivate':
          this.ultCues.push({ id: e.id, color: e.color, life: 0.7, maxLife: 0.7 });
          if (e.id === 'golden') this.goldGlow = Math.max(this.goldGlow, 0.6);
          break;
        case 'chain': {
          // 為閃電弧預生成中段抖動（用內部 rng，不污染遊戲 RNG）
          const jitter = [this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5, this.rnd() - 0.5];
          this.chains.push({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2, crit: e.crit, life: 0.22, maxLife: 0.22, jitter });
          break;
        }
        case 'status': {
          const labels = { burn: ['燃燒', '#ff7a3d'], frost: ['冰霜', '#72d8ff'], freeze: ['凍結!', '#b9efff'], empower: ['共鳴', '#c58aff'] } as const;
          const [text, color] = labels[e.status];
          this.texts.push({ x: e.x, y: e.y - 16, vy: -28, text, color, size: e.status === 'freeze' ? 15 : 11, life: 0.55, maxLife: 0.55 });
          break;
        }
        case 'zonePulse':
          this.shocks.push({ life: 0.75, maxLife: 0.75, color: e.color, source: 'zone' });
          this.shake = Math.min(this.shake + 4, 10);
          break;
        // 'wave' / 'perkOffer' 由 UI 另行處理
      }
    }
  }

  update(dt: number): void {
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 1 - 1.6 * dt;
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 3 * dt;
      p.vy *= 1 - 3 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.muzzles.length - 1; i >= 0; i--) {
      this.muzzles[i].life -= dt;
      if (this.muzzles[i].life <= 0) this.muzzles.splice(i, 1);
    }
    for (let i = this.beams.length - 1; i >= 0; i--) {
      this.beams[i].life -= dt;
      if (this.beams[i].life <= 0) this.beams.splice(i, 1);
    }
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      this.shocks[i].life -= dt;
      if (this.shocks[i].life <= 0) this.shocks.splice(i, 1);
    }
    for (let i = this.ultCues.length - 1; i >= 0; i--) {
      this.ultCues[i].life -= dt;
      if (this.ultCues[i].life <= 0) this.ultCues.splice(i, 1);
    }
    for (let i = this.chains.length - 1; i >= 0; i--) {
      this.chains[i].life -= dt;
      if (this.chains[i].life <= 0) this.chains.splice(i, 1);
    }
    if (this.goldGlow > 0) this.goldGlow = Math.max(0, this.goldGlow - dt);
    for (const [id, t] of this.flash) {
      const nt = t - dt;
      if (nt <= 0) this.flash.delete(id);
      else this.flash.set(id, nt);
    }
    this.shake *= 1 - Math.min(9 * dt, 1);
    if (this.shake < 0.05) this.shake = 0;
  }
}
