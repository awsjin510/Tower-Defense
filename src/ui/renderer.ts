import { ARENA_RADIUS, TOWER_RADIUS, type SimState } from '../core/sim';
import { ENEMY_TYPES } from '../core/waves';

const WORLD = ARENA_RADIUS * 2 + 60;
const enemyColor = new Map(ENEMY_TYPES.map((t) => [t.id, t.color]));

export function render(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, s: SimState): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, w, h);

  // 世界座標（塔在原點）置中、等比縮放
  const scale = Math.min(w, h) / WORLD;
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);

  // 生成圈與射程圈
  ctx.strokeStyle = '#21262d';
  ctx.lineWidth = 2 / scale;
  ctx.beginPath();
  ctx.arc(0, 0, ARENA_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(88, 166, 255, 0.18)';
  ctx.beginPath();
  ctx.arc(0, 0, s.stats.range, 0, Math.PI * 2);
  ctx.stroke();

  // 子彈
  for (const b of s.bullets) {
    ctx.fillStyle = b.crit ? '#f85149' : '#e3b341';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.crit ? 5 : 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 敵人（血條只給受過傷的畫）
  for (const e of s.enemies) {
    ctx.fillStyle = enemyColor.get(e.typeId) ?? '#e05555';
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
    if (e.hp < e.maxHp) {
      const bw = e.radius * 2;
      ctx.fillStyle = '#30363d';
      ctx.fillRect(e.x - e.radius, e.y - e.radius - 7, bw, 3.5);
      ctx.fillStyle = '#56d364';
      ctx.fillRect(e.x - e.radius, e.y - e.radius - 7, bw * Math.max(e.hp / e.maxHp, 0), 3.5);
    }
  }

  // 塔本體 + 血環
  ctx.fillStyle = '#1f6feb';
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#58a6ff';
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS * 0.55, 0, Math.PI * 2);
  ctx.fill();
  const hpRatio = Math.max(s.towerHp / s.stats.maxHealth, 0);
  ctx.strokeStyle = hpRatio > 0.35 ? '#56d364' : '#f85149';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, TOWER_RADIUS + 8, -Math.PI / 2, -Math.PI / 2 + hpRatio * Math.PI * 2);
  ctx.stroke();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
