/* 几何工具：rough ops 展开成折线、按长度取点 / 画一部分、SVG 路径做仿射变换。全部是纯函数。 */
import { parsePath, absolutize, normalize } from 'path-data-parser';

export const clamp = x => (x < 0 ? 0 : x > 1 ? 1 : x);
export const eio = x => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
export const eo = x => 1 - Math.pow(1 - x, 3);
export const lin = x => x;

/* 折线：p=[x0,y0,x1,y1,...]，cum=累计长度，len=总长 */
export function poly(p) {
  const cum = [0];
  let L = 0;
  for (let i = 2; i < p.length; i += 2) { L += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); cum.push(L) }
  return { p, cum, len: L };
}

/* rough 的 ops（move / lineTo / bcurveTo）→ 折线段；贝塞尔每段细分 10 点 */
export function flattenOps(ops) {
  const out = [];
  let cur = null, x = 0, y = 0;
  for (const o of ops) {
    const d = o.data;
    if (o.op === 'move') { cur = [d[0], d[1]]; out.push(cur); x = d[0]; y = d[1] }
    else if (o.op === 'lineTo') { if (!cur) { cur = [x, y]; out.push(cur) } cur.push(d[0], d[1]); x = d[0]; y = d[1] }
    else if (o.op === 'bcurveTo') {
      if (!cur) { cur = [x, y]; out.push(cur) }
      for (let i = 1; i <= 10; i++) {
        const s = i / 10, u = 1 - s, a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, e = s * s * s;
        cur.push(a * x + b * d[0] + c * d[2] + e * d[4], a * y + b * d[1] + c * d[3] + e * d[5]);
      }
      x = d[4]; y = d[5];
    }
  }
  return out.filter(p => p.length >= 4).map(poly);
}

/* 折线上长度 L 处的点 */
export function pointAt(c, L) {
  const { p, cum } = c;
  if (L <= 0) return { x: p[0], y: p[1] };
  if (L >= c.len) return { x: p[p.length - 2], y: p[p.length - 1] };
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= L) lo = m; else hi = m }
  const f = (L - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return { x: p[lo * 2] + (p[hi * 2] - p[lo * 2]) * f, y: p[lo * 2 + 1] + (p[hi * 2 + 1] - p[lo * 2 + 1]) * f };
}

/* 把折线前 L 长度加进当前路径（调用方负责 beginPath / stroke） */
export function tracePart(ctx, c, L) {
  if (L <= 0) return;
  const { p, cum } = c;
  ctx.moveTo(p[0], p[1]);
  if (L >= c.len) { for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); return }
  for (let i = 1; i < cum.length; i++) {
    if (cum[i] <= L) ctx.lineTo(p[i * 2], p[i * 2 + 1]);
    else { const q = pointAt(c, L); ctx.lineTo(q.x, q.y); break }
  }
}

/* SVG 路径 d → 只含 M L C Z 的绝对路径，再对每个点做 f(x,y) 变换（翻转、缩放都安全，弧线已转成三次贝塞尔） */
export function mapPath(d, f) {
  const segs = normalize(absolutize(parsePath(d)));
  let s = '';
  for (const { key, data } of segs) {
    s += key;
    for (let i = 0; i < data.length; i += 2) { const q = f(data[i], data[i + 1]); s += (i ? ' ' : '') + q[0].toFixed(2) + ' ' + q[1].toFixed(2) }
    s += ' ';
  }
  return s.trim();
}

/* 手绘圈：与 v1 相同的椭圆点列（转 1.08 圈，带轻微起伏） */
export function circPts(cx, cy, rx, ry, n = 44) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = -2.1 + i / n * Math.PI * 2 * 1.08, j = 1 + Math.sin(i * 0.35 * 90 / n) * 0.012;
    pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
  }
  return pts;
}
