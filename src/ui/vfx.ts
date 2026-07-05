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

/**
 * 純視覺特效層——只吃 SimEvent，不回寫任何遊戲狀態。
 * 命中閃白以敵人 id 為鍵存在這裡，核心的 Enemy 結構保持乾淨。
 */
export class Vfx {
  texts: FloatText[] = [];
  particles: Particle[] = [];
  muzzles: Muzzle[] = [];
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
          const color = def?.color ?? '#e05555';
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
        // 'wave' 由 UI 橫幅另行處理
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
    for (const [id, t] of this.flash) {
      const nt = t - dt;
      if (nt <= 0) this.flash.delete(id);
      else this.flash.set(id, nt);
    }
    this.shake *= 1 - Math.min(9 * dt, 1);
    if (this.shake < 0.05) this.shake = 0;
  }
}
