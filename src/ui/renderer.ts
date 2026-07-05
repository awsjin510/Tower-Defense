import { ARENA_RADIUS, TOWER_RADIUS, type SimState } from '../core/sim';
import { ENEMY_TYPES } from '../core/waves';
import type { Enemy } from '../core/types';
import type { Vfx } from './vfx';

const WORLD = ARENA_RADIUS * 2 + 60;
const enemyColor = new Map(ENEMY_TYPES.map((t) => [t.id, t.color]));

// 星空背景：兩層視差，只生成一次
interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}
function makeStars(n: number, spread: number, seed: number): Star[] {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => ({
    x: (rnd() - 0.5) * spread,
    y: (rnd() - 0.5) * spread,
    r: 0.4 + rnd() * 1.3,
    a: 0.15 + rnd() * 0.55,
  }));
}
const STARS_FAR = makeStars(60, WORLD * 1.4, 1);
const STARS_NEAR = makeStars(30, WORLD * 1.4, 99);

/** 描出敵人形狀路徑（不填色），讓呼叫端可先填底色再疊閃白 */
function traceEnemy(ctx: CanvasRenderingContext2D, e: Enemy, time: number): void {
  const r = e.radius;
  ctx.beginPath();
  switch (e.typeId) {
    case 'fast': {
      // 三角形，朝向塔（移動方向）
      const h = Math.atan2(-e.y, -e.x);
      for (let i = 0; i < 3; i++) {
        const a = h + (i / 3) * Math.PI * 2;
        const rr = i === 0 ? r * 1.5 : r;
        const px = e.x + Math.cos(a) * rr;
        const py = e.y + Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'tank': {
      // 圓角方塊
      const d = r * 0.9;
      ctx.roundRect(e.x - d, e.y - d, d * 2, d * 2, r * 0.35);
      break;
    }
    case 'sniper': {
      // 菱形（尖端朝塔），遠程單位的識別形
      const h = Math.atan2(-e.y, -e.x);
      const pts = [
        [h, r * 1.4],
        [h + Math.PI / 2, r * 0.8],
        [h + Math.PI, r * 1.1],
        [h - Math.PI / 2, r * 0.8],
      ] as const;
      pts.forEach(([a, rr], i) => {
        const px = e.x + Math.cos(a) * rr;
        const py = e.y + Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      });
      ctx.closePath();
      break;
    }
    case 'boss': {
      // 六角形
      for (let i = 0; i < 6; i++) {
        const a = time * 0.6 + (i / 6) * Math.PI * 2;
        const px = e.x + Math.cos(a) * r;
        const py = e.y + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    default:
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
  }
}

export function render(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  s: SimState,
  vfx: Vfx
): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0a0e14';
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(w, h) / WORLD;
  // 螢幕震動
  const sh = vfx.shake;
  const ox = sh ? (Math.sin(s.time * 91) * sh) : 0;
  const oy = sh ? (Math.cos(s.time * 73) * sh) : 0;
  ctx.translate(w / 2 + ox, h / 2 + oy);
  ctx.scale(scale, scale);

  // 星空（視差漂移）
  const drift = s.time * 4;
  ctx.fillStyle = '#ffffff';
  for (const st of STARS_FAR) {
    ctx.globalAlpha = st.a * 0.5;
    ctx.beginPath();
    ctx.arc(st.x + Math.sin(drift * 0.02 + st.y) * 3, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const st of STARS_NEAR) {
    ctx.globalAlpha = st.a;
    ctx.beginPath();
    ctx.arc(st.x + Math.sin(drift * 0.05 + st.x) * 6, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 生成圈與射程圈
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 2 / scale;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(88, 166, 255, 0.16)';
  ctx.setLineDash([6, 8]);
  ctx.beginPath();
  ctx.arc(0, 0, s.stats.range, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // 死亡粒子（畫在敵人下方）
  for (const p of vfx.particles) {
    ctx.globalAlpha = Math.max(p.life / p.maxLife, 0);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 遠程敵人的射擊光束（敵人 → 塔）
  for (const bm of vfx.beams) {
    ctx.globalAlpha = Math.min(bm.life / 0.12, 1) * 0.8;
    ctx.strokeStyle = '#3cc8e0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bm.x, bm.y);
    ctx.lineTo(0, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 子彈（發光拖尾）
  ctx.save();
  for (const b of s.bullets) {
    ctx.shadowColor = b.crit ? '#ff5b5b' : '#ffd24a';
    ctx.shadowBlur = 8;
    ctx.fillStyle = b.crit ? '#ff7a7a' : '#ffe08a';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.crit ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 敵人（形狀 + 血條 + 命中閃白）
  for (const e of s.enemies) {
    traceEnemy(ctx, e, s.time);
    ctx.fillStyle = enemyColor.get(e.typeId) ?? '#e05555';
    ctx.fill();
    if (e.typeId === 'boss') {
      ctx.strokeStyle = 'rgba(212,60,200,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 7 + Math.sin(s.time * 4) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    const fl = vfx.flash.get(e.id);
    if (fl) {
      ctx.globalAlpha = Math.min(fl / 0.12, 1) * 0.85;
      traceEnemy(ctx, e, s.time);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (e.hp < e.maxHp) {
      const bw = e.radius * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(e.x - e.radius, e.y - e.radius - 8, bw, 3.5);
      ctx.fillStyle = e.hp / e.maxHp > 0.4 ? '#56d364' : '#f0a03c';
      ctx.fillRect(e.x - e.radius, e.y - e.radius - 8, bw * Math.max(e.hp / e.maxHp, 0), 3.5);
    }
  }

  // 塔：砲管指向最近目標 + 呼吸光暈 + 血環
  let aim = -Math.PI / 2;
  let bestSq = Infinity;
  for (const e of s.enemies) {
    const d = e.x * e.x + e.y * e.y;
    if (d < bestSq) {
      bestSq = d;
      aim = Math.atan2(e.y, e.x);
    }
  }
  // 開火閃光
  for (const m of vfx.muzzles) {
    ctx.globalAlpha = m.life / 0.06;
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(m.angle) * (TOWER_RADIUS + 16), Math.sin(m.angle) * (TOWER_RADIUS + 16));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.shadowColor = 'rgba(88,166,255,0.7)';
  ctx.shadowBlur = 14 + Math.sin(s.time * 2.5) * 5;
  ctx.fillStyle = '#1f6feb';
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 砲管
  ctx.strokeStyle = '#9ecbff';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(aim) * TOWER_RADIUS * 1.4, Math.sin(aim) * TOWER_RADIUS * 1.4);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = '#cfe4ff';
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS * 0.5, 0, Math.PI * 2);
  ctx.fill();

  const hpRatio = Math.max(s.towerHp / s.stats.maxHealth, 0);
  ctx.strokeStyle = hpRatio > 0.35 ? '#56d364' : '#f85149';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS + 9, -Math.PI / 2, -Math.PI / 2 + hpRatio * Math.PI * 2);
  ctx.stroke();

  // 傷害數字（世界座標，字級需除以 scale 保持螢幕大小一致）
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of vfx.texts) {
    ctx.globalAlpha = Math.min(t.life / t.maxLife, 1);
    ctx.font = `700 ${t.size}px system-ui, sans-serif`;
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
