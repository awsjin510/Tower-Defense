import { ARENA_RADIUS, TOWER_RADIUS, type SimState } from '../core/sim';
import { ENEMY_TYPES } from '../core/waves';
import { zoneForWave } from '../core/zones';
import type { Enemy } from '../core/types';
import type { Vfx } from './vfx';
import { hasPerk } from '../core/perks';

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

// 能量信標：戰區主題的場邊脈動光點（固定 6 座，均分在生成圈上）
const BEACON_COUNT = 6;

/** 主題色 #rrggbb → rgba 字串 */
function tint(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 把顏色朝白色提亮 amt（0..1） */
function lighten(hex: string, amt: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const m = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

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
    case 'vampire': {
      // 五角星（菁英尖刺感）
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
        const rr = i % 2 === 0 ? r * 1.25 : r * 0.55;
        const px = e.x + Math.cos(a) * rr;
        const py = e.y + Math.sin(a) * rr;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'protector': {
      // 八角形（裝甲/防禦感）
      for (let i = 0; i < 8; i++) {
        const a = Math.PI / 8 + (i / 8) * Math.PI * 2;
        const px = e.x + Math.cos(a) * r;
        const py = e.y + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'splitter': {
      // 五邊形（會裂開的團塊）
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
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
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  // Canvas backing size 必須是整數。直接與含小數的 CSS 尺寸比較，會在
  // 1.25x/1.5x 顯示倍率下每幀重設畫布，造成點技能時閃動與裁切錯位。
  const pixelWidth = Math.max(1, Math.round(w * dpr));
  const pixelHeight = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 深空底：垂直漸層讓戰場更有景深
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0b1120');
  bg.addColorStop(1, '#05070d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const scale = Math.min(w, h) / WORLD;
  // 螢幕震動
  const sh = vfx.shake;
  const ox = sh ? (Math.sin(s.time * 91) * sh) : 0;
  const oy = sh ? (Math.cos(s.time * 73) * sh) : 0;
  ctx.translate(w / 2 + ox, h / 2 + oy);
  ctx.scale(scale, scale);

  const zone = zoneForWave(s.wave);

  if (s.timeFreezeTimer > 0) {
    ctx.fillStyle = 'rgba(80,190,255,.12)'; ctx.fillRect(-WORLD/2,-WORLD/2,WORLD,WORLD);
  }
  if (s.blackHole) {
    const pulse=34+Math.sin(s.time*8)*6;
    const bh=ctx.createRadialGradient(s.blackHole.x,s.blackHole.y,2,s.blackHole.x,s.blackHole.y,pulse*2.4);
    bh.addColorStop(0,'#000'); bh.addColorStop(.35,'rgba(80,20,130,.95)'); bh.addColorStop(1,'rgba(170,80,255,0)');
    ctx.fillStyle=bh; ctx.beginPath(); ctx.arc(s.blackHole.x,s.blackHole.y,pulse*2.4,0,Math.PI*2); ctx.fill();
  }
  if (s.orbital) {
    ctx.strokeStyle=s.orbital.warning>0?'rgba(255,80,60,.9)':'rgba(255,112,67,.42)';ctx.lineWidth=s.orbital.warning>0?4:2;ctx.setLineDash([8,6]);
    ctx.beginPath();ctx.arc(s.orbital.x,s.orbital.y,150,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  }

  // 主題光影：戰區色的環境輻射光（中心亮、邊緣散）+ 偏移的星雲團塊
  const glow = ctx.createRadialGradient(0, 0, ARENA_RADIUS * 0.1, 0, 0, ARENA_RADIUS * 1.25);
  glow.addColorStop(0, zone.glow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-WORLD / 2, -WORLD / 2, WORLD, WORLD);
  // 兩團緩慢漂移的星雲，加強戰區氛圍
  for (let n = 0; n < 2; n++) {
    const nx = Math.cos(s.time * 0.05 + n * 2.3) * ARENA_RADIUS * 0.55;
    const ny = Math.sin(s.time * 0.04 + n * 1.7) * ARENA_RADIUS * 0.5;
    const neb = ctx.createRadialGradient(nx, ny, 0, nx, ny, ARENA_RADIUS * 0.7);
    neb.addColorStop(0, tint(zone.accent, 0.06));
    neb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb;
    ctx.fillRect(-WORLD / 2, -WORLD / 2, WORLD, WORLD);
  }

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

  // 戰區環境語言：每區都有可辨識、可預讀的動態，而不只是換底色。
  if (zone.mechanic.kind === 'split') {
    ctx.fillStyle = '#72e78a';
    for (let i = 0; i < 15; i++) {
      const a = i * 2.4 + s.time * (0.025 + (i % 3) * 0.012);
      const rr = 65 + ((i * 43) % 250);
      ctx.globalAlpha = 0.12 + (i % 4) * 0.035;
      ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a * 1.07) * rr, 1.5 + (i % 3), 0, Math.PI * 2); ctx.fill();
    }
  } else if (zone.mechanic.kind === 'frost') {
    ctx.strokeStyle = 'rgba(150,230,255,.28)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r1 = ARENA_RADIUS - 16 - (i % 3) * 9;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * ARENA_RADIUS, Math.sin(a) * ARENA_RADIUS);
      ctx.lineTo(Math.cos(a + 0.05) * r1, Math.sin(a + 0.05) * r1);
      ctx.stroke();
    }
  } else if (zone.mechanic.kind === 'magma') {
    const warning = Math.max(0, 1 - s.zonePulseTimer / 1.5);
    ctx.strokeStyle = `rgba(255,92,40,${0.18 + warning * 0.65})`;
    ctx.shadowColor = '#ff5c28'; ctx.shadowBlur = warning * 18; ctx.lineWidth = 2 + warning * 2;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.35;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * 62, Math.sin(a) * 62);
      for (let k = 1; k <= 4; k++) {
        const r = 62 + k * 56;
        const wobble = Math.sin(i * 9 + k * 4) * 0.075;
        ctx.lineTo(Math.cos(a + wobble) * r, Math.sin(a + wobble) * r);
      }
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  } else {
    ctx.strokeStyle = 'rgba(190,125,255,.2)';
    for (let i = 0; i < 4; i++) {
      const r = 85 + i * 58 + Math.sin(s.time * 1.2 + i) * 8;
      ctx.globalAlpha = .18 + i * .05; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(0, 0, r, r * .82, s.time * .035 * (i % 2 ? -1 : 1), 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // 雷達網格：戰區色的同心圓 + 輻條 + 旋轉掃描線
  ctx.strokeStyle = zone.grid;
  ctx.lineWidth = 1.5 / scale;
  for (let ring = 1; ring <= 3; ring++) {
    ctx.beginPath();
    ctx.arc(0, 0, (ARENA_RADIUS / 3) * ring, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.moveTo(Math.cos(a) * TOWER_RADIUS * 2, Math.sin(a) * TOWER_RADIUS * 2);
    ctx.lineTo(Math.cos(a) * ARENA_RADIUS, Math.sin(a) * ARENA_RADIUS);
  }
  ctx.stroke();
  // 掃描線（帶漸淡尾巴）
  const sweep = s.time * 0.7;
  const sweepGrad = ctx.createLinearGradient(0, 0, Math.cos(sweep) * ARENA_RADIUS, Math.sin(sweep) * ARENA_RADIUS);
  sweepGrad.addColorStop(0, 'rgba(0,0,0,0)');
  sweepGrad.addColorStop(1, tint(zone.accent, 0.35));
  ctx.strokeStyle = sweepGrad;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(sweep) * ARENA_RADIUS, Math.sin(sweep) * ARENA_RADIUS);
  ctx.stroke();

  // 生成圈（戰區色）與射程圈
  ctx.strokeStyle = tint(zone.accent, 0.22);
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

  // 能量信標：生成圈上的脈動光點
  for (let i = 0; i < BEACON_COUNT; i++) {
    const a = (i / BEACON_COUNT) * Math.PI * 2 + Math.PI / BEACON_COUNT;
    const pulse = 0.5 + Math.sin(s.time * 2.2 + i * 1.7) * 0.5;
    const bx = Math.cos(a) * ARENA_RADIUS;
    const by = Math.sin(a) * ARENA_RADIUS;
    ctx.globalAlpha = 0.35 + pulse * 0.5;
    ctx.fillStyle = zone.accent;
    ctx.beginPath();
    ctx.arc(bx, by, 3 + pulse * 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = (0.35 + pulse * 0.5) * 0.35;
    ctx.beginPath();
    ctx.arc(bx, by, 8 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

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

  // 彈射鏈（多重射擊）：兩點間的發光閃電弧
  if (vfx.chains.length) {
    ctx.save();
    for (const c of vfx.chains) {
      const a = Math.min(c.life / c.maxLife, 1);
      const col = c.crit ? '#ff8f5b' : '#7fe0ff';
      const dx = c.x2 - c.x1;
      const dy = c.y2 - c.y1;
      const nx = -dy;
      const ny = dx;
      const len = Math.hypot(dx, dy) || 1;
      const amp = Math.min(len * 0.12, 16);
      ctx.strokeStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 10;
      ctx.globalAlpha = a;
      ctx.lineWidth = c.crit ? 3 : 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(c.x1, c.y1);
      for (let k = 0; k < 4; k++) {
        const t = (k + 1) / 5;
        const off = (c.jitter[k] ?? 0) * amp;
        ctx.lineTo(c.x1 + dx * t + (nx / len) * off, c.y1 + dy * t + (ny / len) * off);
      }
      ctx.lineTo(c.x2, c.y2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

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
    const base = e.golden ? '#ffd54a' : (enemyColor.get(e.typeId) ?? '#e05555');
    // 護盾兵：畫出治療光環，讓玩家一眼看出威脅來源
    if (e.typeId === 'protector') {
      const rad = ENEMY_TYPES.find((t) => t.id === 'protector')?.auraRadius ?? 130;
      const pulse = 0.5 + Math.sin(s.time * 3) * 0.5;
      ctx.strokeStyle = tint(base, 0.16 + pulse * 0.12);
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 7]);
      ctx.beginPath();
      ctx.arc(e.x, e.y, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // 徑向漸層填色 + 同色外輝光，讓敵人有體積感並在暗背景中發亮
    ctx.save();
    ctx.shadowColor = base;
    ctx.shadowBlur = 9;
    const grad = ctx.createRadialGradient(
      e.x - e.radius * 0.35,
      e.y - e.radius * 0.35,
      e.radius * 0.1,
      e.x,
      e.y,
      e.radius * 1.15
    );
    grad.addColorStop(0, lighten(base, 0.45));
    grad.addColorStop(1, base);
    traceEnemy(ctx, e, s.time);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    // 細描邊
    traceEnemy(ctx, e, s.time);
    ctx.strokeStyle = lighten(base, 0.5);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (e.typeId === 'boss') {
      ctx.strokeStyle = 'rgba(212,60,200,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 7 + Math.sin(s.time * 4) * 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.affixShield > 0) {
      ctx.strokeStyle = '#66e4ff'; ctx.lineWidth = 3; ctx.globalAlpha = .75;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 6, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (e.eliteAffix) {
      const marks = { shielded:'◆', regenerating:'✚', enraged:'!', stealth:'◌', volatile:'✹', healer:'♥', reflective:'↩', blinking:'⌁' };
      ctx.fillStyle = '#fff4b8'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(marks[e.eliteAffix], e.x, e.y - e.radius - 10);
    }
    // 狀態辨識環：燃燒橘、冰霜藍、凍結實線、虛空強化紫。
    if (e.burnTime > 0 || e.frostStacks > 0 || e.frozenTime > 0 || e.zoneEmpower > 1) {
      const statusColor = e.frozenTime > 0 ? '#b9efff' : e.burnTime > 0 ? '#ff7a3d' : e.zoneEmpower > 1 ? '#c58aff' : '#72d8ff';
      ctx.strokeStyle = statusColor;
      ctx.lineWidth = e.frozenTime > 0 ? 3 : 2;
      if (e.frozenTime <= 0) ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (e.burnTime > 0) {
      ctx.fillStyle = '#ff8b3d';
      for (let i = 0; i < e.burnStacks; i++) {
        const a = s.time * 4 + (i / Math.max(e.burnStacks, 1)) * Math.PI * 2;
        ctx.globalAlpha = .55 + Math.sin(a * 2) * .2;
        ctx.beginPath(); ctx.arc(e.x + Math.cos(a) * (e.radius + 6), e.y + Math.sin(a) * (e.radius + 6) - 2, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (e.frozenTime > 0) {
      ctx.strokeStyle = '#d9f7ff'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + Math.cos(a) * (e.radius + 7), e.y + Math.sin(a) * (e.radius + 7)); ctx.stroke();
      }
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

  // 塔：固定式科技防禦核心，不顯示外露炮管或旋轉瞄準結構。
  // 終極武器衝擊波（黑洞）：從中心擴散的環
  for (const sh of vfx.shocks) {
    const t = 1 - sh.life / sh.maxLife;
    const r = t * ARENA_RADIUS * 1.35;
    ctx.globalAlpha = (1 - t) * 0.9;
    ctx.strokeStyle = sh.color;
    ctx.lineWidth = 6 * (1 - t) + 1;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 射擊時以能量脈衝取代炮管後座。
  const fireFlash = vfx.muzzles.reduce((m, mz) => Math.max(m, mz.life / 0.06), 0);

  // 六角懸浮底座：深色金屬板、分割裝甲與緩慢旋轉的能量刻度。
  ctx.save();
  ctx.shadowColor = fireFlash > 0 ? '#8fe9ff' : tint(zone.accent, 0.8);
  ctx.shadowBlur = 13 + fireFlash * 13;
  ctx.fillStyle = '#071426';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + i * Math.PI / 4;
    const r = i % 2 ? TOWER_RADIUS * 1.08 : TOWER_RADIUS * 1.23;
    i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#4c8fc4';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.rotate(-s.time * 0.35);
  ctx.strokeStyle = tint(zone.accent, 0.5);
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS * 0.88, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  // 固定式裝甲機座。
  ctx.save();
  ctx.shadowColor = tint(zone.accent, 0.75);
  ctx.shadowBlur = 10 + fireFlash * 8;
  const turretShell = ctx.createRadialGradient(-5, -7, 2, 0, 0, TOWER_RADIUS * 0.83);
  turretShell.addColorStop(0, '#6f9fbd');
  turretShell.addColorStop(0.38, '#23445e');
  turretShell.addColorStop(1, '#0b1d30');
  ctx.fillStyle = turretShell;
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS * 0.78, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#75bde3';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.restore();
  // Build 外觀：燃燒軌道、冰霜晶環、防禦護盾與經濟資料粒子。
  if (hasPerk(s.perks, 'incendiary')) {
    ctx.fillStyle = '#ff7a3d'; ctx.shadowColor = '#ff7a3d'; ctx.shadowBlur = 9;
    for (let i = 0; i < 3; i++) { const a = s.time * 1.8 + i * Math.PI * 2 / 3; ctx.beginPath(); ctx.arc(Math.cos(a) * 38, Math.sin(a) * 38, 3.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.shadowBlur = 0;
  }
  if (hasPerk(s.perks, 'cryoRounds')) {
    ctx.strokeStyle = 'rgba(130,225,255,.75)'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = -s.time * .5 + i * Math.PI / 3; const x = Math.cos(a) * 39, y = Math.sin(a) * 39; i ? ctx.lineTo(x,y) : ctx.moveTo(x,y); } ctx.closePath(); ctx.stroke();
  }
  // 軌道衛星：繞塔飛行的自動炮台（畫出軌道虛線 + 發光機體）
  if (hasPerk(s.perks, 'satellite')) {
    const orbit = TOWER_RADIUS + 46;
    const sx = Math.cos(s.satAngle) * orbit;
    const sy = Math.sin(s.satAngle) * orbit;
    ctx.strokeStyle = 'rgba(80,230,210,.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, orbit, 0, Math.PI * 2); ctx.stroke();
    ctx.save();
    ctx.shadowColor = '#4be6d2'; ctx.shadowBlur = 12;
    ctx.fillStyle = '#8ffff0';
    ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(139,255,240,.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 8 + Math.sin(s.time * 6) * 1.5, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  const defenseLv = (s.inRunLevels.maxHealth ?? 0) + (s.workshopLevels.ws_maxHealth ?? 0);
  if (defenseLv >= 3) {
    ctx.strokeStyle = `rgba(88,198,255,${Math.min(.18 + defenseLv * .008, .48)})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, TOWER_RADIUS + 20 + Math.sin(s.time * 2) * 1.5, 0, Math.PI * 2); ctx.stroke();
  }
  const ecoLv = s.inRunLevels.cashPerKill ?? 0;
  if (ecoLv >= 3) {
    ctx.fillStyle = '#ffd45c';
    for (let i = 0; i < Math.min(ecoLv / 3, 5); i++) { const a = -s.time + i * 1.9; ctx.globalAlpha=.45; ctx.fillRect(Math.cos(a)*48-1, Math.sin(a)*31-1, 2, 2); }
    ctx.globalAlpha=1;
  }
  // 塔核心：戰區主題色的脈動能量核
  const corePulse = 0.5 + Math.sin(s.time * 3.2) * 0.5;
  ctx.fillStyle = '#cfe4ff';
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = tint(zone.accent, 0.55 + corePulse * 0.35);
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS * (0.26 + corePulse * 0.09), 0, Math.PI * 2);
  ctx.fill();

  const hpRatio = Math.max(s.towerHp / s.stats.maxHealth, 0);
  ctx.strokeStyle = hpRatio > 0.35 ? '#56d364' : '#f85149';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS + 9, -Math.PI / 2, -Math.PI / 2 + hpRatio * Math.PI * 2);
  ctx.stroke();

  // 寒冰戰區：外圈顯示攻速侵蝕程度，擊殺會讓它回退。
  if (zone.mechanic.kind === 'frost' && s.zoneMeter > 0) {
    ctx.strokeStyle = 'rgba(114,216,255,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, TOWER_RADIUS + 15, -Math.PI / 2, -Math.PI / 2 + (s.zoneMeter / zone.mechanic.value) * Math.PI * 2);
    ctx.stroke();
  }

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

  // 黃金塔啟用：全螢幕金光暈邊（螢幕座標）
  const goldActive = s.ultActive.some((a) => a.coinMult > 1);
  if (goldActive || vfx.goldGlow > 0) {
    const pulse = goldActive ? 0.28 + Math.sin(s.time * 6) * 0.08 : vfx.goldGlow / 0.6 * 0.3;
    const vign = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vign.addColorStop(0, 'rgba(0,0,0,0)');
    vign.addColorStop(1, `rgba(227, 179, 65, ${Math.max(pulse, 0)})`);
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, w, h);
  }
}
