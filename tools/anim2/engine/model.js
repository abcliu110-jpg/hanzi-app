/* 动画模型：读 v1 的脚本 + 时间轴，排出每个场景的绘制项（rough 笔画、真实笔顺汉字、文字、田字格），
 * 再提供纯函数 drawFrame(ctx, t)。坐标沿用 v1 的 1600×900，画到 1920×1080 逻辑画布时整体乘 1.2。 */
import rough from 'roughjs';
import { gsap } from 'gsap';
import { clamp, eio, lin, poly, flattenOps, pointAt, tracePart, mapPath, circPts } from './geom.js';

export const W = 1600, H = 900, LW = 1920, LH = 1080, K = LW / W;
export const PAL = { ink: '#0A0503', orange: '#EF7226', lightorange: '#E9A67C', board: '#FBFBFB', grey: '#8a8a86' };
const COLORS = {
  ink: PAL.ink, orange: PAL.orange, lightorange: PAL.lightorange, 'light-orange': PAL.lightorange,
  gray: PAL.grey, grey: PAL.grey, green: '#3C9A5A', red: '#D9443F', blue: '#2F7FD0', dark: '#555', snow: '#9BB3C9',
  '#222': PAL.ink, '#F08A2C': PAL.orange, '#888': PAL.grey
};
export const col = (c, d) => (c ? (COLORS[c] || c) : (d || PAL.ink));
export const KAI = '"XZQ WenKai","LXGW WenKai","KaiTi","STKaiti","Kaiti SC","AR PL UKai CN",serif';
export const LATIN = '"XZQ WenKai","LXGW WenKai","Kalam","Helvetica Neue",Arial,sans-serif';
export const SLOTS = {
  C: { x: 565, y: 150, w: 470, h: 470, grid: 1 }, GL: { x: 230, y: 160, w: 470, h: 470, grid: 1 },
  L: { x: 120, y: 150, w: 660, h: 640 }, LL: { x: 110, y: 200, w: 330, h: 560 }, LR: { x: 450, y: 200, w: 330, h: 560 },
  R: { x: 900, y: 150, w: 600, h: 560 }, R1: { x: 900, y: 170, w: 600, h: 310 }, R2: { x: 900, y: 500, w: 600, h: 76 },
  R3: { x: 900, y: 610, w: 600, h: 76 }, TL: { x: 90, y: 120, w: 320, h: 180 }, BR: { x: 1180, y: 700, w: 360, h: 90 }
};
const isLatin = s => /^[\x00-\u024F\u1E00-\u1EFF\s·\-]+$/.test(s);
const PX_PER_MS = 2600 / 1000 / K;   // 笔速 2600 px/s（1920 画布）→ 1600 坐标里每毫秒的长度
const MIN_STROKE = 120;               // 每笔最短 0.12 s
const SEED = 20261030;
const TIPX = 3.3, TIPY = 18, HAND_W = 300, HAND_H = 302;

export function buildModel(data, opts = {}) {
  const S = data.script, TL = data.timeline, ART = data.art || {}, HZ = data.hz || {};
  const M = { warnings: [], report: [], boards: [] };
  const warn = m => { M.warnings.push(m); try { console.warn('[xzq-anim2] ' + m) } catch (e) { } };
  if (TL.length !== S.scenes.length) warn(`timeline 有 ${TL.length} 段，脚本有 ${S.scenes.length} 个场景`);
  const TOTAL = TL[TL.length - 1].start + TL[TL.length - 1].dur; M.total = TOTAL;
  const gen = rough.generator();
  let seed = SEED;
  const tl = gsap.timeline({ paused: true, defaults: { immediateRender: false } });
  const cam = { x: 0 }; M.cam = cam; M.tl = tl;
  const segs = [];           // 手要跟随的笔画（全局按开始时间排序）
  const scenes = TL.map((s, i) => ({ i, start: s.start, end: s.start + s.dur, items: [] }));
  M.scenes = scenes;
  let cur = null;            // 当前场景

  /* ---------- rough 笔画 ---------- */
  function roughItem(drawable, o) {
    const chunks = [], fill = [];
    for (const set of drawable.sets) {
      if (set.type === 'path') chunks.push(...flattenOps(set.ops));
      else if (set.type === 'fillSketch') fill.push(...flattenOps(set.ops));
    }
    // rough 每段画两遍：相邻两段是同一段线的两遍，按对推进
    const pairs = [];
    for (let i = 0; i < chunks.length; i += 2) pairs.push([chunks[i], chunks[i + 1] || null]);
    const total = pairs.reduce((a, p) => a + p[0].len, 0);
    return { type: 'rough', pairs, total, fill, color: o.color, w: o.w, fillColor: o.fillColor, fillW: o.fillW || 1.6 };
  }
  function rOpts(o) {
    const r = { seed: seed++, roughness: o.roughness ?? 0.9, bowing: o.bowing ?? 0.8, maxRandomnessOffset: o.maxOff ?? 1.6, strokeWidth: o.w || 6 };
    if (o.fillColor) Object.assign(r, { fill: o.fillColor, fillStyle: 'hachure', hachureGap: o.gap || 7, fillWeight: o.fillW || 1.6, hachureAngle: -41 });
    return r;
  }
  function strokeDur(L, o) {
    if (o.vk) return Math.max(o.vmin ?? 140, Math.min(o.vmax ?? 1300, L * o.vk));   // 脚本里写了 k：沿用 v1 的速度公式
    return Math.max(MIN_STROKE, L / PX_PER_MS);
  }
  function place(it, st, dur, ease) {
    it.start = st; it.dur = Math.max(1, dur); it.ease = ease || pen;
    cur.items.push(it);
    if (!it.nohand && it.total > 0) segs.push({ start: st, dur: it.dur, end: st + it.dur, ease: it.ease, it, p0: penPt(it, 0), p1: penPt(it, 1) });
    if (it.fill && it.fill.length) it.fillStart = st + it.dur;
    return st + it.dur;
  }
  /* 笔尖：沿第一遍描边走到进度 f */
  function penPt(it, f) {
    if (it.type === 'hz') { const q = pointAt(it.med, it.med.len * f); return { x: it.m[0] * q.x + it.m[4], y: it.m[3] * q.y + it.m[5] } }
    let P = it.total * f;
    for (const [a] of it.pairs) { if (P <= a.len) return pointAt(a, P); P -= a.len }
    const a = it.pairs[it.pairs.length - 1][0]; return pointAt(a, a.len);
  }
  const pen = q => 0.4 * q + 0.6 * eio(q);   // 接近匀速，起笔收笔略缓

  /* 一条线（d 已是 1600 坐标） */
  function ink(d, st, o = {}) {
    const it = roughItem(o.points ? gen.curve(o.points, rOpts(o)) : gen.path(d, rOpts(o)), { color: col(o.col), w: o.w || 6 });
    return place(it, st, strokeDur(it.total, o));
  }
  /* 一组线（线稿）：先算每笔时长，可整体压缩到 cap 毫秒以内 */
  function inkMany(list, st, o = {}) {
    const items = list.map(s => {
      const it = roughItem(gen.path(s.d, rOpts({ w: s.w || o.w || 6, fillColor: s.fill ? col(s.fill) : null, gap: o.hgap })), { color: col(s.col, col(o.col)), w: s.w || o.w || 6, fillColor: s.fill ? col(s.fill) : null });
      if (s.dash) it.dash = String(s.dash).split(/[ ,]+/).map(Number).filter(x => x > 0);
      const dur = o.vk ? Math.max(120, Math.min(1100, it.total * o.vk)) : strokeDur(it.total, {});
      return { it, dur };
    });
    let gap = o.gap ?? 40;
    const tot = items.reduce((a, b) => a + b.dur, 0) + gap * (items.length - 1);
    const cap = o.total || 4200;
    if (tot > cap) { const f = cap / tot; items.forEach(i => i.dur = Math.max(45, i.dur * f)); gap = Math.max(12, gap * f) }
    let t = st;
    items.forEach(({ it, dur }) => { place(it, t, dur); t += dur + gap });
    return t - gap;
  }
  /* 真实笔顺写一个字：笔画轮廓做 clip，沿中线按长度揭开 */
  function write(ch, x, y, size, st, o = {}) {
    const D = HZ[ch]; if (!D) { warn('缺少笔画数据：' + ch); return st }
    const k = size / 1024, m = [k, 0, 0, -k, x, y + 900 * k];
    let t = st;
    D.strokes.forEach((sd, i) => {
      const med = poly(D.medians[i].flat());
      const dur = Math.max(130, Math.min(520, med.len * k * (o.k || 3.2)));
      const it = { type: 'hz', clip: sd, med, m, color: col(o.col), total: med.len };
      place(it, t, dur, lin); t += dur + (o.gap ?? 70);
    });
    return t;
  }
  function word(s, x, y, size, st, o = {}) {
    let t = st;
    [...s].forEach((c, i) => { t = write(c, x + i * size * (o.sp || 1.02), y, size, t, o) + 120 });
    if (o.ul === true || (size >= 200 && o.ul !== false)) {
      const w = s.length * size * 1.02, uy = y + size + 14;
      t = ink(`M${x + 10} ${uy} Q${x + w / 2} ${uy + 16} ${x + w - 10} ${uy - 4}`, t + 80, { col: 'orange', w: 8 });
    }
    return t;
  }
  /* 淡入 + 轻弹：数值由 GSAP 暂停时间轴给出 */
  function popIn(st, d = 0.45, pop = true) {
    const v = { a: 0, s: pop ? 0.9 : 1 };
    tl.fromTo(v, { a: 0 }, { a: 1, duration: d, ease: 'power2.out' }, st / 1000);
    if (pop) tl.fromTo(v, { s: 0.9 }, { s: 1, duration: d + 0.1, ease: 'back.out(2.4)' }, st / 1000);
    return v;
  }
  /* 手写字：逐字之字形揭开（每个字分 3 行，左→右、右→左、左→右），时长按字数，最长 1.2 s */
  function label(x, y, s, size, st, c, ex = {}) {
    const n = [...s].length, dur = Math.min(1.2, 0.05 + 0.13 * n);
    const v = { a: 1, s: 1, r: 0 };
    tl.fromTo(v, { r: 0 }, { r: 1, duration: dur, ease: 'none' }, st / 1000);
    cur.items.push({ type: 'text', reveal: 1, start: st, x, y, text: s, size, color: col(c, '#555'), anchor: ex.anchor || 'middle', font: ex.font || (isLatin(s) ? LATIN : KAI), spacing: ex.spacing, v });
  }

  /* ---------- 时间 ---------- */
  function resolveAt(si, li, at) {
    const c = TL[si] && TL[si].cues[li]; if (!c) { warn(`场景 ${si} 第 ${li} 句在 timeline 里不存在`); return TL[si].start }
    const base = TL[si].start + c.t;
    if (at == null || at === 0) return base;
    if (typeof at === 'number') return base + at * 1000;
    const mm = String(at).match(/^(.*?)(?:([+-]\d+(?:\.\d+)?)s)?$/); const w = mm[1], off = mm[2] ? parseFloat(mm[2]) * 1000 : 0;
    if (w === '') return base + off; if (w === 'end') return base + c.d + off;
    let k = c.text.indexOf(w); if (k < 0) { warn(`第 ${si}.${li} 句找不到关键词「${w}」`); k = 0 }
    const ct = c.ct; return base + (ct && ct[k] != null ? ct[k] : c.d * k / c.text.length) + off;
  }

  /* ---------- 版位与引用（与 v1 完全一致，snap.py 的体检可以照用） ---------- */
  function boxOf(cue) {
    if (cue.box) { const [x, y, w, h] = cue.box; return { x, y, w, h } }
    if (cue.slot) { const b = SLOTS[cue.slot]; if (!b) { warn('未知版位 ' + cue.slot); return SLOTS.L } return { ...b } }
    if (cue.x != null) return { x: cue.x, y: cue.y, w: cue.w || 0, h: cue.h || 0 };
    return null;
  }
  const center = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  function edge(b, p, m) { const c = center(b), dx = p.x - c.x, dy = p.y - c.y; const hw = b.w / 2 + m, hh = b.h / 2 + m; const f = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : 1e9, 1); return { x: c.x + dx * f, y: c.y + dy * f } }
  function refPoint(ctx, r, toward) {
    if (Array.isArray(r)) return { x: r[0], y: r[1] };
    if (typeof r !== 'string') return { x: 800, y: 450 };
    const [n, a] = r.split('.'); const R = ctx.refs[n] || (SLOTS[n] && { box: SLOTS[n] });
    if (!R) { warn('找不到引用 ' + r); return { x: 800, y: 450 } }
    if (a) { const q = R.anchors && R.anchors[a]; if (!q) { warn('找不到锚点 ' + r); return center(R.box) } return { x: q[0], y: q[1], rx: q[2], ry: q[3] } }
    if (!toward) return center(R.box);
    return edge(R.box, toward, 18);
  }

  /* ---------- cue 动作 ---------- */
  const PENS = { write: 1, draw: 1, path: 1, circle: 1, arrow: 1 };
  const ACT = {
    grid(ctx, c, t) {
      const b = boxOf(c) || SLOTS.C;
      const rect = roughItem(gen.rectangle(b.x, b.y, b.w, b.h, rOpts({ w: 3, roughness: 0.5, maxOff: 1 })), { color: '#E7A19E', w: 3 });
      cur.items.push({ type: 'grid', start: t + 150, rect, b, v: popIn(t + 150, 0.4, false) });
      ctx.refs[c.id || 'grid'] = { box: b }; return t;
    },
    write(ctx, c, t) {
      const s = c.chars || ''; const n = [...s].length; const b = boxOf(c) || SLOTS.R1; let size, x, y;
      if (b.grid && !c.size) { size = b.w - 30; x = b.x + 15; y = b.y + 15 }
      else {
        size = c.size || (b.grid ? b.w - 30 : Math.min(280, b.h)); if (b.w) size = Math.min(size, b.w / (n * 1.02)); if (b.h) size = Math.min(size, b.h);
        const w = n * size * 1.02; x = b.x + (b.w - w) / 2 + size * 0.01; y = b.y + (b.h - size) / 2;
      }
      const end = word(s, x, y, size, t, { col: c.color, k: c.k || (size >= 400 ? 3.6 : 2.3), gap: c.gap ?? (size >= 400 ? 110 : 30), ul: c.underline != null ? c.underline : (b.grid ? false : undefined) });
      const R = { box: { x, y, w: n * size * 1.02, h: size + (size >= 200 && c.underline !== false ? 30 : 0) }, chars: [...s].map((_, i) => ({ x: x + i * size * 1.02, y, w: size, h: size })) };
      ctx.refs[c.id || s] = R; ctx.boxes.push({ ...R.box, what: 'write ' + s, line: c._line });
      return end;
    },
    draw(ctx, c, t) {
      const A = ART[c.art]; if (!A) { warn('缺少线稿 ' + c.art); return t }
      let b;
      if (c.on) { const p = refPoint(ctx, c.on); const sz = c.size || 120; b = { x: p.x - sz / 2 + (c.dx || 0), y: p.y - sz / 2 + (c.dy || 0), w: sz, h: sz } }
      else b = boxOf(c) || SLOTS.L;
      const s = Math.min(b.w, b.h) / 400 * (c.scale || 1), ox = b.x + (b.w - 400 * s) / 2, oy = b.y + (b.h - 400 * s) / 2;
      const mx = x => (c.flip ? ox + (400 - x) * s : ox + x * s), my = y => oy + y * s;
      const list = A.strokes.map(k => {
        const r = typeof k === 'string' ? { d: k } : { d: k.d, col: k.c || k.color, w: k.w, fill: k.fill, dash: k.dash };
        r.d = mapPath(r.d, (x, y) => [mx(x), my(y)]); return r;
      });
      const end = inkMany(list, t, { col: c.color, vk: c.k, total: c.dur ? c.dur * 1000 : 4200, gap: 40, hgap: Math.max(4, Math.min(8, 400 * s / 50)) });
      const anchors = {}; for (const k in (A.anchors || {})) { const q = A.anchors[k]; anchors[k] = [mx(q[0]), my(q[1]), q[2] != null ? q[2] * s : null, q[3] != null ? q[3] * s : null] }
      const bb = A.bbox || [0, 0, 400, 400];
      const bx = c.flip ? { x: mx(bb[2]), y: my(bb[1]), w: (bb[2] - bb[0]) * s, h: (bb[3] - bb[1]) * s } : { x: mx(bb[0]), y: my(bb[1]), w: (bb[2] - bb[0]) * s, h: (bb[3] - bb[1]) * s };
      ctx.refs[c.id || c.art] = { box: bx, anchors }; ctx.boxes.push({ ...bx, what: 'draw ' + (c.id || c.art), line: c._line, on: !!c.on });
      return end;
    },
    path(ctx, c, t) { const ds = Array.isArray(c.d) ? c.d : [c.d]; let e = t; ds.forEach(d => { e = ink(d, e, { col: c.color, w: c.width || 6, vk: c.k }) + 40 }); return e - 40 },
    circle(ctx, c, t) {
      let cx, cy, rx, ry;
      const hm = c.target && c.target.match(/^(.*)#(\d+)$/);
      if (hm) { const R = ctx.refs[hm[1]], b = R && R.chars && R.chars[+hm[2]]; if (!b) { warn('找不到 ' + c.target); return t } cx = b.x + b.w / 2; cy = b.y + b.h / 2; rx = b.w / 2 + (c.pad ?? 16); ry = b.h / 2 + (c.pad ?? 16) }
      else if (c.target) {
        const p = refPoint(ctx, c.target); const [n, a] = c.target.split('.');
        if (a) { cx = p.x; cy = p.y; rx = p.rx || 55; ry = p.ry || p.rx || 45 }
        else { const R = ctx.refs[n], b = (R && R.box) || SLOTS[n]; if (!b) { warn('圈注目标还没画出来：' + c.target); return t } cx = b.x + b.w / 2; cy = b.y + b.h / 2; rx = b.w / 2 + (c.pad ?? 24); ry = b.h / 2 + (c.pad ?? 24) }
      } else { cx = c.x; cy = c.y; rx = c.rx || 60; ry = c.ry || rx }
      if (c.rx) rx = c.rx; if (c.ry) ry = c.ry;
      ctx.boxes.push({ x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry, what: 'circle', line: c._line, mark: 1 });
      return ink(null, t, { points: circPts(cx, cy, rx, ry), col: col(c.color, 'orange'), w: c.width || 7, vk: c.k, roughness: 0.7 });
    },
    arrow(ctx, c, t) {
      const raw0 = refPoint(ctx, c.from), raw1 = refPoint(ctx, c.to);
      const p0 = typeof c.from === 'string' && !c.from.includes('.') ? refPoint(ctx, c.from, raw1) : raw0;
      const p1 = typeof c.to === 'string' && !c.to.includes('.') ? refPoint(ctx, c.to, raw0) : raw1;
      const bend = c.bend ?? 0.2, mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, dx = p1.x - p0.x, dy = p1.y - p0.y;
      const qx = mx - dy * bend, qy = my + dx * bend, h = 24, a = Math.atan2(p1.y - qy, p1.x - qx);
      const o = { col: col(c.color, 'orange'), w: c.width || 6, vk: c.k };
      const e = ink(`M${p0.x.toFixed(1)} ${p0.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`, t, o);
      const end = ink(`M${(p1.x - h * Math.cos(a - 0.5)).toFixed(1)} ${(p1.y - h * Math.sin(a - 0.5)).toFixed(1)} L${p1.x.toFixed(1)} ${p1.y.toFixed(1)} L${(p1.x - h * Math.cos(a + 0.5)).toFixed(1)} ${(p1.y - h * Math.sin(a + 0.5)).toFixed(1)}`, e, o);
      if (c.id) ctx.refs[c.id] = { box: { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(dx), h: Math.abs(dy) }, anchors: { mid: [qx * 0.5 + mx * 0.5, qy * 0.5 + my * 0.5] } };
      return end;
    },
    label(ctx, c, t) {
      const b = boxOf(c); let x, y;
      if (c.x != null) { x = c.x; y = c.y } else if (c.on) { const p = refPoint(ctx, c.on); x = p.x + (c.dx || 0); y = p.y + (c.dy || 0) } else { const bb = b || SLOTS.R2; x = bb.x + bb.w / 2; y = bb.y + bb.h / 2 }
      const size = c.size || (c.slot === 'R2' ? 44 : 46);
      const latin = isLatin(c.text);
      label(x, y, c.text, size, t, c.color || (c.slot === 'R2' || latin ? 'gray' : 'ink'), { font: c.font === 'sans' ? LATIN : undefined, anchor: c.anchor, spacing: c.spacing });
      const w = [...c.text].reduce((a, ch) => a + (/[\x00-\u024F]/.test(ch) ? 0.56 : 1.02), 0) * size; const lx = c.anchor === 'start' ? x : c.anchor === 'end' ? x - w : x - w / 2;
      const R = { box: { x: lx, y: y - size * 0.6, w, h: size * 1.2 } }; ctx.refs[c.id || c.text] = R; ctx.boxes.push({ ...R.box, what: 'label ' + c.text, line: c._line, on: !!c.on });
      return t;
    },
    note(ctx, c, t) {
      const size = c.size || 30;
      cur.items.push({ type: 'text', start: t, x: 1560, y: 866, text: c.text, size, color: '#999', anchor: 'end', font: KAI, v: popIn(t, 0.45, false) });
      const w = [...c.text].length * size; ctx.boxes.push({ x: 1560 - w, y: 848, w, h: 36, what: 'note', line: c._line, note: 1 }); return t;
    }
  };

  function recap(ctx, sc, t0) {
    const rc = sc.recap || S.recap || {}; const cx = 800, cy = 440; let t = t0;
    const centerTxt = rc.center || S.zi;
    t = ink(null, t, { points: circPts(cx, cy, 110, 85), col: 'orange', w: 7, roughness: 0.7 });
    label(cx, cy, centerTxt, centerTxt.length > 2 ? 52 : centerTxt.length > 1 ? 64 : 84, t - 200, 'ink');
    const nodes = (rc.nodes || []).map(n => { const s = S.scenes.find(x => x.sense === n || x.id === n); return s ? (s.recap || s.word || s.label || n) : n });
    const N = nodes.length;
    nodes.forEach((s, i) => {
      const d2 = rc.angles ? rc.angles[i] : 90 - i * 360 / N;
      const r = d2 * Math.PI / 180, x = cx + Math.cos(r) * 520, y = cy - Math.sin(r) * 268, x0 = cx + Math.cos(r) * 125, y0 = cy - Math.sin(r) * 95, x1 = cx + Math.cos(r) * 400, y1 = cy - Math.sin(r) * 200;
      t = ink(`M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`, t, {});
      label(x, y, s, 54, t - 100, i % 2 ? 'orange' : 'ink'); t += (rc.gap ?? 120);
      ctx.boxes.push({ x: x - s.length * 28, y: y - 32, w: s.length * 56, h: 64, what: 'recap ' + s });
    });
    return t;
  }

  /* ---------- 构建全部场景 ---------- */
  S.scenes.forEach((sc, si) => {
    if (!TL[si]) return; cur = scenes[si];
    const ctx = { refs: {}, boxes: [], si }; let penT = TL[si].start;
    const cues = [];
    (sc.lines || []).forEach((ln, li) => (ln.cues || []).forEach((c, ci) => cues.push({ c: { ...c, _line: li }, li, ci, t: resolveAt(si, li, c.at) })));
    if (sc.kind === 'recap') { const t0 = resolveAt(si, 0, sc.recapAt ?? 0) + 350; penT = recap(ctx, sc, t0) }
    cues.sort((a, b) => a.t - b.t || a.li - b.li || a.ci - b.ci);
    cues.forEach(({ c, li, ci, t }) => {
      const f = ACT[c.do]; if (!f) { warn('未知动作 ' + c.do); return }
      let st = t; if (PENS[c.do] && !c.parallel) st = Math.max(t, penT + 60);
      let end;
      try { end = f(ctx, c, st) } catch (e) { warn(`场景 ${sc.id} 第 ${li} 句 ${c.do} 出错：${e.message}`); end = st }
      if (PENS[c.do] && !c.parallel) penT = Math.max(penT, end);
      M.report.push({ scene: sc.id, line: li, cue: ci, do: c.do, at: c.at, want: Math.round(t), got: Math.round(st), late: Math.round(st - t), end: Math.round(end) });
    });
    const end = TL[si].start + TL[si].dur; if (penT > end - 200) warn(`场景 ${sc.id} 的画面 ${Math.round(penT)}ms 才画完，超过场景结束 ${end}ms`);
    M.boards.push({ id: sc.id, boxes: ctx.boxes, penEnd: Math.round(penT) });
  });
  /* 镜头：白板一块接一块向左推，600 ms */
  for (let i = 1; i < TL.length; i++) tl.fromTo(cam, { x: (i - 1) * W }, { x: i * W, duration: 0.6, ease: 'power2.inOut' }, TL[i].start / 1000);
  tl.set({}, {}, TOTAL / 1000 + 1);
  segs.sort((a, b) => a.start - b.start);
  M.segs = segs;
  M.chapters = TL.map((s, i) => ({ start: s.start, label: (S.scenes[i] && S.scenes[i].label) || s.id }));
  M.slides = TL.slice(1).map(s => s.start);

  /* 字幕关键词：每句里被 cue 的 at 引用到的词 */
  M.subs = TL.map((sc, si) => sc.cues.map((c, li) => {
    const kw = new Array([...c.text].length).fill(false);
    const ln = S.scenes[si] && S.scenes[si].lines && S.scenes[si].lines[li];
    ((ln && ln.cues) || []).forEach(q => {
      if (typeof q.at !== 'string') return; const w = q.at.replace(/[+-]\d+(\.\d+)?s$/, ''); if (!w || w === 'end') return;
      const k = c.text.indexOf(w); if (k >= 0) for (let j = k; j < k + w.length; j++) kw[j] = true;
    });
    return { start: sc.start + c.t, d: c.d, text: c.text, ct: c.ct, kw };
  }));

  /* ---------- 手 ---------- */
  const OFF = { x: 1750, y: 1050 };
  M.handAt = function (t) {
    let lo = 0, hi = segs.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (segs[m].start <= t) { k = m; lo = m + 1 } else hi = m - 1 }
    // 有并行笔画时，取最近开始且仍在画的一笔
    let curS = k >= 0 ? segs[k] : null;
    if (curS && t >= curS.end) for (let j = k - 1; j >= 0 && j > k - 6; j--) if (t < segs[j].end) { curS = segs[j]; break }
    const nx = segs[k + 1];
    if (curS && t < curS.end) { const p = penPt(curS.it, curS.ease(clamp((t - curS.start) / curS.dur))); return { x: p.x, y: p.y, d: true } }
    const lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    if (curS && nx && nx.start - curS.end < 1500) { const f = eio(clamp((t - curS.end) / (nx.start - curS.end))), q = lerp(curS.p1, nx.p0, f), dd = Math.hypot(nx.p0.x - curS.p1.x, nx.p0.y - curS.p1.y); q.y -= Math.sin(Math.PI * f) * Math.min(70, 12 + dd * 0.25); q.x += Math.sin(Math.PI * f) * Math.min(25, dd * 0.08); return q }
    if (curS && t - curS.end < 450) return lerp(curS.p1, OFF, eio((t - curS.end) / 450));
    if (nx && nx.start - t < 450) return lerp(OFF, nx.p0, eio(1 - (nx.start - t) / 450));
    return OFF;
  };
  M.sceneAt = t => { let si = 0; for (let i = 0; i < TL.length; i++) if (t >= TL[i].start) si = i; return si };

  /* ---------- 画一帧（纯函数：只依赖 t） ---------- */
  const p2d = new Map();
  const path2d = d => { let p = p2d.get(d); if (!p) { p = new Path2D(d); p2d.set(d, p) } return p };
  function drawRough(ctx, it, e) {
    ctx.strokeStyle = it.color; ctx.lineWidth = it.w * 0.72;
    if (it.dash) ctx.setLineDash(it.dash);
    ctx.beginPath();
    let P = it.total * e;
    for (const [a, b] of it.pairs) {
      if (P <= 0) break;
      if (P >= a.len) { tracePart(ctx, a, a.len); if (b) tracePart(ctx, b, b.len) }
      else { const f = P / a.len; tracePart(ctx, a, P); if (b) tracePart(ctx, b, b.len * f) }
      P -= a.len;
    }
    ctx.stroke();
    if (it.dash) ctx.setLineDash([]);
  }
  function drawItem(ctx, it, t) {
    if (t < it.start) return;
    if (it.type === 'rough') {
      const e = it.ease(clamp((t - it.start) / it.dur));
      if (it.fill.length && t > it.fillStart) {
        ctx.save(); ctx.globalAlpha = clamp((t - it.fillStart) / 300); ctx.strokeStyle = it.fillColor || it.color; ctx.lineWidth = it.fillW;
        ctx.beginPath(); for (const c of it.fill) tracePart(ctx, c, c.len); ctx.stroke(); ctx.restore();
      }
      drawRough(ctx, it, e);
    } else if (it.type === 'hz') {
      const e = clamp((t - it.start) / it.dur); if (e <= 0) return;
      ctx.save(); ctx.transform(...it.m); ctx.clip(path2d(it.clip));
      ctx.strokeStyle = it.color; ctx.lineWidth = 170; ctx.beginPath(); tracePart(ctx, it.med, it.med.len * e);
      ctx.stroke(); ctx.restore();
    } else if (it.type === 'text') {
      const v = it.v; if (v.a <= 0 || (it.reveal && v.r <= 0)) return;
      ctx.save(); ctx.globalAlpha = clamp(v.a); ctx.translate(it.x, it.y); if (v.s !== 1) ctx.scale(v.s, v.s);
      ctx.font = `${it.size}px ${it.font}`; ctx.fillStyle = it.color; ctx.textBaseline = 'middle';
      ctx.textAlign = it.anchor === 'start' ? 'left' : it.anchor === 'end' ? 'right' : 'center';
      if (it.spacing) try { ctx.letterSpacing = typeof it.spacing === 'number' ? it.spacing + 'px' : it.spacing } catch (e) { }
      if (it.reveal && v.r < 1) zigzagClip(ctx, it, v.r);
      ctx.fillText(it.text, 0, 0); ctx.restore();
    } else if (it.type === 'grid') {
      const v = it.v; if (v.a <= 0) return; const b = it.b;
      ctx.save(); ctx.globalAlpha = clamp(v.a);
      drawRough(ctx, it.rect, 1);
      ctx.strokeStyle = '#F0C4C2'; ctx.lineWidth = 2; ctx.setLineDash([12, 10]); ctx.beginPath();
      ctx.moveTo(b.x, b.y + b.h / 2); ctx.lineTo(b.x + b.w, b.y + b.h / 2); ctx.moveTo(b.x + b.w / 2, b.y); ctx.lineTo(b.x + b.w / 2, b.y + b.h);
      ctx.stroke(); ctx.restore();
    }
  }
  /* 之字形遮罩：按字的实际宽度（measureText，每帧现量，不缓存）切 3 行，揭开到进度 r */
  function zigzagClip(ctx, it, r) {
    const chars = [...it.text], n = chars.length, full = ctx.measureText(it.text).width;
    const x0 = it.anchor === 'start' ? 0 : it.anchor === 'end' ? -full : -full / 2;
    const top = -it.size * 0.62, hh = it.size * 1.24, rows = 3, rh = hh / rows;
    const P = r * n, ci = Math.min(n - 1, Math.floor(P)), f = P - ci;
    const lx = ctx.measureText(chars.slice(0, ci).join('')).width, rx = ctx.measureText(chars.slice(0, ci + 1).join('')).width;
    ctx.beginPath();
    if (lx > 0) ctx.rect(x0 - 2, top, lx + 2, hh);
    const cw = rx - lx, rp = f * rows, ri = Math.floor(rp), rf = rp - ri;
    for (let k = 0; k < rows; k++) {
      if (k < ri) ctx.rect(x0 + lx, top + k * rh, cw + 2, rh + 0.5);
      else if (k === ri) { const w = cw * rf; ctx.rect(k % 2 ? x0 + lx + cw - w : x0 + lx, top + k * rh, w, rh + 0.5) }
    }
    ctx.clip();
    ctx.textAlign = 'left';
    ctx.translate(x0, 0);
    // 改成左对齐后坐标已平移，fillText(…, 0, 0) 位置不变
  }
  M.reduced = !!opts.reducedMotion;
  /* ctx 的变换由调用方设成「1920×1080 逻辑画布」；这里再乘 1.2 进入 1600×900 数据坐标 */
  M.drawFrame = function (ctx, t, hand) {
    t = Math.max(0, Math.min(t, TOTAL));
    const si = M.sceneAt(t);
    ctx.save();
    ctx.fillStyle = PAL.board; ctx.fillRect(0, 0, LW, LH);
    ctx.scale(K, K);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (M.reduced) {
      const te = scenes[si].end + 5000; tl.time(te / 1000, true);   // 减少动画：直接画本场景全部画完的结果（含快结束时才出现的字）
      for (const it of scenes[si].items) drawItem(ctx, it, te);
    } else {
      tl.time(t / 1000, true);
      const cx = cam.x;
      for (const sc of scenes) {
        const ox = sc.i * W - cx; if (ox <= -W || ox >= W) continue;
        ctx.save(); ctx.translate(ox, 0);
        for (const it of sc.items) drawItem(ctx, it, t);
        ctx.restore();
      }
      if (hand && hand.complete !== false && hand.naturalWidth !== 0) {
        const h = M.handAt(t); if (h.x < W + 50) { const wob = h.d ? Math.sin(t / 45) * 1.5 : 0; ctx.drawImage(hand, h.x - TIPX + wob, h.y - TIPY + wob, HAND_W, HAND_H) }
      }
    }
    ctx.restore();
    return si;
  };
  return M;
}
