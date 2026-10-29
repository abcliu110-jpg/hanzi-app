/*!
 * xzq-anim.js — 识字星球 字义白板动画播放器 v1
 * 数据驱动：anim/<字>.json（脚本）+ anim/<字>.timeline.json（配音时间轴）+ anim/<字>.mp3（混音）
 * 线稿：anim/art/<名>.json；笔画：anim/hz/<字>.json（hanzi-writer-data，Arphic Public License）
 * 渲染是 t 的纯函数：player.render(t) 可任意跳转，也用于逐帧导出。
 */
(function (G) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const KAI = '"KaiTi","STKaiti","Kaiti SC","LXGW WenKai","AR PL UKai CN",serif';
  const SANS = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","WenQuanYi Zen Hei",sans-serif';
  const COLORS = { ink: '#222', orange: '#F08A2C', green: '#3C9A5A', red: '#D9443F', blue: '#2F7FD0', gray: '#888', grey: '#888', dark: '#555', snow: '#9BB3C9' };
  const INK = COLORS.ink, OR = COLORS.orange;
  const col = (c, d) => (c ? (COLORS[c] || c) : (d || INK));
  const W = 1600, H = 900;
  /* 版位（逻辑坐标 1600×900）。上方 0–110 预留给 App 顶栏，下方 >800 是字幕区。 */
  const SLOTS = {
    C: { x: 565, y: 150, w: 470, h: 470, grid: 1 },   // 居中田字格
    GL: { x: 230, y: 160, w: 470, h: 470, grid: 1 },  // 左侧田字格（右边要放老写法时）
    L: { x: 120, y: 150, w: 660, h: 640 },             // 左区线稿
    LL: { x: 110, y: 200, w: 330, h: 560 },            // 左区左半
    LR: { x: 450, y: 200, w: 330, h: 560 },            // 左区右半
    R: { x: 900, y: 150, w: 600, h: 560 },             // 整个右区
    R1: { x: 900, y: 170, w: 600, h: 310 },            // 右区第 1 行（大字）
    R2: { x: 900, y: 500, w: 600, h: 76 },             // 右区第 2 行（拼音）
    R3: { x: 900, y: 610, w: 600, h: 76 },             // 右区第 3 行（例词）
    TL: { x: 90, y: 120, w: 320, h: 180 },             // 左上小卡
    BR: { x: 1180, y: 700, w: 360, h: 90 }             // 右下
  };
  const clamp = x => x < 0 ? 0 : x > 1 ? 1 : x, eo = x => 1 - Math.pow(1 - x, 3), eio = x => x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2, lin = x => x;
  const isLatin = s => /^[\x00-\u024F\u1E00-\u1EFF\s·\-]+$/.test(s);
  function circ(cx, cy, rx, ry) { let s = ''; const n = 90; for (let i = 0; i <= n; i++) { const a = -2.1 + i / n * Math.PI * 2 * 1.08, j = 1 + Math.sin(i * .35) * .012; s += (i ? 'L' : 'M') + (cx + Math.cos(a) * rx * j).toFixed(1) + ' ' + (cy + Math.sin(a) * ry * j).toFixed(1) } return s }
  function arrowD(x1, y1, qx, qy, x2, y2, h = 24) { const a = Math.atan2(y2 - qy, x2 - qx); return [`M${x1} ${y1} Q${qx} ${qy} ${x2} ${y2}`, `M${(x2 - h * Math.cos(a - .5)).toFixed(1)} ${(y2 - h * Math.sin(a - .5)).toFixed(1)} L${x2} ${y2} L${(x2 - h * Math.cos(a + .5)).toFixed(1)} ${(y2 - h * Math.sin(a + .5)).toFixed(1)}`] }

  /* ---------- 播放器 ---------- */
  function Player(root, data, opts) {
    opts = opts || {};
    const S = data.script, TL = data.timeline, ART = data.art || {}, HZ = data.hz || {};
    const P = this; P.warnings = []; P.report = [];
    const warn = m => { P.warnings.push(m); if (G.console) console.warn('[xzq-anim] ' + m) };
    if (TL.length !== S.scenes.length) warn(`timeline 有 ${TL.length} 段，脚本有 ${S.scenes.length} 个场景`);
    const TOTAL = TL[TL.length - 1].start + TL[TL.length - 1].dur; P.total = TOTAL;
    const reduced = opts.reducedMotion != null ? !!opts.reducedMotion : !!(G.matchMedia && G.matchMedia('(prefers-reduced-motion: reduce)').matches);
    P.reduced = reduced;

    /* DOM */
    root.classList.add('xzq-anim'); root.innerHTML = '';
    if (opts.capture) root.classList.add('xzq-cap');
    const stage = el('div', 'xzq-stage', root);
    const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); stage.appendChild(svg);
    const fid = 'xzqrough' + Math.random().toString(36).slice(2, 7);
    svg.innerHTML = `<defs><filter id="${fid}" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter></defs><rect width="${W}" height="${H}" fill="#fff"/>`;
    const defs = svg.firstChild;
    const sub = el('div', 'xzq-sub', stage);
    function el(tag, cls, p) { const e = document.createElement(tag); if (cls) e.className = cls; p.appendChild(e); return e }
    function E(tag, a, p) { const e = document.createElementNS(NS, tag); for (const k in a) { if (k === 'text') e.textContent = a[k]; else e.setAttribute(k, a[k]) } (p || svg).appendChild(e); return e }

    /* 动画登记 */
    const tracks = [], segs = []; let curScene = 0;
    function track(start, dur, apply) { tracks.push({ start, dur: Math.max(1, dur), apply, sc: curScene }) }
    function fadeIn(e, st, d = 450) { track(st, d, p => e.setAttribute('opacity', eo(p))); return e }
    function ink(p, d, st, o = {}) {
      const e = E('path', { d, fill: o.fill || 'none', stroke: col(o.col), 'stroke-width': o.w || 6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...(o.attr || {}) }, p);
      const L = e.getTotalLength(), dur = o.dur || Math.max(140, Math.min(1300, L * (o.scale || 1) * (o.k || 2.1)));
      e.setAttribute('stroke-dasharray', L + ' ' + (L + 4)); const ease = o.ease || eio;
      if (o.fill && o.fill !== 'none') { e.setAttribute('fill-opacity', 0); track(st + dur, 300, q => e.setAttribute('fill-opacity', q)) }
      track(st, dur, q => e.setAttribute('stroke-dashoffset', L * (1 - ease(q))));
      if (!o.nohand) segs.push({ start: st, dur, el: e, L, ease }); return st + dur
    }
    /* 一组笔画：先量长度，可整体压缩到 total 毫秒以内 */
    function inkMany(p, list, st, o = {}) {
      const items = list.map(s => { const e = E('path', { d: s.d, fill: 'none', stroke: col(s.col, col(o.col)), 'stroke-width': (s.w || o.w || 6) / (o.scale || 1), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, p); if (s.dash) e.setAttribute('data-dash', s.dash); const L = e.getTotalLength(); return { e, L, dur: Math.max(120, Math.min(1100, L * (o.scale || 1) * (o.k || 1.5))), fill: s.fill } });
      let gap = o.gap ?? 40; const tot = items.reduce((a, b) => a + b.dur, 0) + gap * (items.length - 1);
      const cap = o.total || 4200; if (tot > cap) { const f = cap / tot; items.forEach(i => i.dur = Math.max(45, i.dur * f)); gap = Math.max(12, gap * f) }
      let t = st; items.forEach(({ e, L, dur, fill }) => {
        e.setAttribute('stroke-dasharray', L + ' ' + (L + 4)); const t0 = t;
        track(t0, dur, q => e.setAttribute('stroke-dashoffset', L * (1 - eio(q))));
        if (fill) { e.setAttribute('fill', col(fill)); e.setAttribute('fill-opacity', 0); track(t0 + dur, 300, q => e.setAttribute('fill-opacity', q)) }
        segs.push({ start: t0, dur, el: e, L, ease: eio }); t += dur + gap
      }); return t - gap
    }
    let cid = 0;
    function write(p, ch, x, y, size, st, o = {}) {
      const D = HZ[ch]; if (!D) { warn('缺少笔画数据：' + ch); return st }
      const g = E('g', { transform: `translate(${x},${y}) scale(${size / 1024}) translate(0,900) scale(1,-1)` }, p); let t = st;
      D.strokes.forEach((sd, i) => {
        const id = fid + 'c' + (cid++); const cp = E('clipPath', { id }, g); E('path', { d: sd }, cp);
        const md = 'M' + D.medians[i].map(q => q.join(' ')).join(' L');
        const e = E('path', { d: md, fill: 'none', stroke: col(o.col), 'stroke-width': 170, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'clip-path': `url(#${id})` }, g);
        const L = e.getTotalLength(), dur = Math.max(130, Math.min(520, L * size / 1024 * (o.k || 3.2))); e.setAttribute('stroke-dasharray', L + ' ' + (L + 200));
        track(t, dur, q => e.setAttribute('stroke-dashoffset', L * (1 - q))); segs.push({ start: t, dur, el: e, L, ease: lin }); t += dur + (o.gap ?? 70)
      }); return t
    }
    function word(p, s, x, y, size, st, o = {}) {
      let t = st; [...s].forEach((c, i) => { t = write(p, c, x + i * size * (o.sp || 1.02), y, size, t, o) + 120 });
      if ((o.ul === true) || (size >= 200 && o.ul !== false)) { const w = s.length * size * 1.02, uy = y + size + 14; t = ink(p, `M${x + 10} ${uy} Q${x + w / 2} ${uy + 16} ${x + w - 10} ${uy - 4}`, t + 80, { col: OR, w: 8, k: .9 }) }
      return t
    }
    function label(p, x, y, s, size, st, c, ex = {}) {
      const e = E('text', { x, y, 'font-size': size, fill: col(c, '#555'), 'text-anchor': ex.anchor || 'middle', 'dominant-baseline': 'central', 'font-family': ex.font || (isLatin(s) ? 'sans-serif' : KAI), ...(ex.attr || {}), text: s }, p);
      fadeIn(e, st, 450); return e
    }

    /* 时间：0 / 秒数 / "关键词" / "关键词+1.5s" / "+1s" / "end" */
    function lineAt(si, li) { const sc = TL[si], c = sc && sc.cues[li]; return c }
    function resolveAt(si, li, at) {
      const c = lineAt(si, li); if (!c) { warn(`场景 ${si} 第 ${li} 句在 timeline 里不存在`); return TL[si].start }
      const base = TL[si].start + c.t;
      if (at == null || at === 0) return base;
      if (typeof at === 'number') return base + at * 1000;
      const m = String(at).match(/^(.*?)(?:([+-]\d+(?:\.\d+)?)s)?$/); let w = m[1], off = m[2] ? parseFloat(m[2]) * 1000 : 0;
      if (w === '') return base + off; if (w === 'end') return base + c.d + off;
      let k = c.text.indexOf(w); if (k < 0) { warn(`第 ${si}.${li} 句找不到关键词「${w}」`); k = 0 }
      const ct = c.ct; return base + (ct && ct[k] != null ? ct[k] : c.d * k / c.text.length) + off
    }

    /* 版位与引用 */
    function boxOf(cue) {
      if (cue.box) { const [x, y, w, h] = cue.box; return { x, y, w, h } }
      if (cue.slot) { const b = SLOTS[cue.slot]; if (!b) { warn('未知版位 ' + cue.slot); return SLOTS.L } return { ...b } }
      if (cue.x != null) return { x: cue.x, y: cue.y, w: cue.w || 0, h: cue.h || 0 };
      return null
    }
    function refPoint(ctx, r, toward) {
      if (Array.isArray(r)) return { x: r[0], y: r[1] };
      if (typeof r !== 'string') return { x: 800, y: 450 };
      const [n, a] = r.split('.'); const R = ctx.refs[n] || (SLOTS[n] && { box: SLOTS[n] });
      if (!R) { warn('找不到引用 ' + r); return { x: 800, y: 450 } }
      if (a) { const q = R.anchors && R.anchors[a]; if (!q) { warn('找不到锚点 ' + r); return center(R.box) } return { x: q[0], y: q[1], rx: q[2], ry: q[3] } }
      if (!toward) return center(R.box);
      return edge(R.box, toward, 18)
    }
    const center = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    function edge(b, p, m) { const c = center(b), dx = p.x - c.x, dy = p.y - c.y; const hw = b.w / 2 + m, hh = b.h / 2 + m; const f = Math.min(Math.abs(dx) > 1e-6 ? hw / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-6 ? hh / Math.abs(dy) : 1e9, 1); return { x: c.x + dx * f, y: c.y + dy * f } }

    /* cue 动作 */
    const PEN = { write: 1, draw: 1, path: 1, circle: 1, arrow: 1 };
    const ACT = {
      grid(ctx, c, t) {
        const b = boxOf(c) || SLOTS.C; const g = E('g', {}, ctx.o);
        E('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: '#E7A19E', 'stroke-width': 3 }, g);
        [[b.x, b.y + b.h / 2, b.x + b.w, b.y + b.h / 2], [b.x + b.w / 2, b.y, b.x + b.w / 2, b.y + b.h]].forEach(([a, bb, cc, d]) => E('line', { x1: a, y1: bb, x2: cc, y2: d, stroke: '#F0C4C2', 'stroke-width': 2, 'stroke-dasharray': '12 10' }, g));
        fadeIn(g, t + 150, 400); ctx.refs[c.id || 'grid'] = { box: b }; return t
      },
      write(ctx, c, t) {
        const s = c.chars || ''; const n = [...s].length; let b = boxOf(c) || SLOTS.R1, size, x, y;
        if (b.grid && !c.size) { size = b.w - 30; x = b.x + 15; y = b.y + 15 }
        else {
          size = c.size || (b.grid ? b.w - 30 : Math.min(280, b.h)); if (b.w) size = Math.min(size, b.w / (n * 1.02)); if (b.h) size = Math.min(size, b.h);
          const w = n * size * 1.02; x = b.x + (b.w - w) / 2 + size * .01; y = b.y + (b.h - size) / 2
        }
        const end = word(ctx.o, s, x, y, size, t, { col: c.color, k: c.k || (size >= 400 ? 3.6 : 2.3), gap: c.gap ?? (size >= 400 ? 110 : 30), ul: c.underline != null ? c.underline : (b.grid ? false : undefined) });
        const R = { box: { x, y, w: n * size * 1.02, h: size + (size >= 200 && c.underline !== false ? 30 : 0) }, chars: [...s].map((_, i) => ({ x: x + i * size * 1.02, y, w: size, h: size })) }; ctx.refs[c.id || s] = R; ctx.boxes.push({ ...R.box, what: 'write ' + s, line: c._line });
        return end
      },
      draw(ctx, c, t) {
        const A = ART[c.art]; if (!A) { warn('缺少线稿 ' + c.art); return t }
        let b;
        if (c.on) { const p = refPoint(ctx, c.on); const sz = c.size || 120; b = { x: p.x - sz / 2 + (c.dx || 0), y: p.y - sz / 2 + (c.dy || 0), w: sz, h: sz } }
        else b = boxOf(c) || SLOTS.L;
        const s = Math.min(b.w, b.h) / 400 * (c.scale || 1), ox = b.x + (b.w - 400 * s) / 2, oy = b.y + (b.h - 400 * s) / 2, fl = c.flip ? -1 : 1;
        const g = E('g', { transform: `translate(${c.flip ? ox + 400 * s : ox},${oy}) scale(${s * fl},${s})` }, ctx.o);
        const list = A.strokes.map(k => typeof k === 'string' ? { d: k } : { d: k.d, col: k.c || k.color, w: k.w, fill: k.fill, dash: k.dash });
        const end = inkMany(g, list, t, { col: c.color, scale: s, k: c.k || 1.5, total: c.dur ? c.dur * 1000 : 4200, gap: 40 });
        const mx = x => c.flip ? ox + (400 - x) * s : ox + x * s;
        const anchors = {}; for (const k in (A.anchors || {})) { const q = A.anchors[k]; anchors[k] = [mx(q[0]), oy + q[1] * s, q[2] != null ? q[2] * s : null, q[3] != null ? q[3] * s : null] }
        const bb = A.bbox || [0, 0, 400, 400]; const bx = c.flip ? { x: mx(bb[2]), y: oy + bb[1] * s, w: (bb[2] - bb[0]) * s, h: (bb[3] - bb[1]) * s } : { x: mx(bb[0]), y: oy + bb[1] * s, w: (bb[2] - bb[0]) * s, h: (bb[3] - bb[1]) * s };
        const R = { box: bx, anchors }; ctx.refs[c.id || c.art] = R; ctx.boxes.push({ ...bx, what: 'draw ' + (c.id || c.art), line: c._line, on: !!c.on });
        return end
      },
      path(ctx, c, t) { const ds = Array.isArray(c.d) ? c.d : [c.d]; let e = t; ds.forEach(d => { e = ink(ctx.o, d, e, { col: c.color, w: c.width || 6, k: c.k || 1.4 }) + 40 }); return e - 40 },
      circle(ctx, c, t) {
        let cx, cy, rx, ry;
        const hm = c.target && c.target.match(/^(.*)#(\d+)$/);
        if (hm) { const R = ctx.refs[hm[1]], b = R && R.chars && R.chars[+hm[2]]; if (!b) { warn('找不到 ' + c.target); return t } cx = b.x + b.w / 2; cy = b.y + b.h / 2; rx = b.w / 2 + (c.pad ?? 16); ry = b.h / 2 + (c.pad ?? 16) }
        else if (c.target) { const p = refPoint(ctx, c.target); const [n, a] = c.target.split('.'); if (a) { cx = p.x; cy = p.y; rx = p.rx || 55; ry = p.ry || p.rx || 45 } else { const b = (ctx.refs[n] || {}).box || SLOTS[n]; cx = b.x + b.w / 2; cy = b.y + b.h / 2; rx = b.w / 2 + (c.pad ?? 24); ry = b.h / 2 + (c.pad ?? 24) } }
        else { cx = c.x; cy = c.y; rx = c.rx || 60; ry = c.ry || rx }
        if (c.rx) rx = c.rx; if (c.ry) ry = c.ry;
        ctx.boxes.push({ x: cx - rx, y: cy - ry, w: 2 * rx, h: 2 * ry, what: 'circle', line: c._line, mark: 1 });
        return ink(ctx.o, circ(cx, cy, rx, ry), t, { col: col(c.color, OR), w: c.width || 7, k: c.k || 1.1 })
      },
      arrow(ctx, c, t) {
        const raw0 = refPoint(ctx, c.from), raw1 = refPoint(ctx, c.to);
        const p0 = typeof c.from === 'string' && !c.from.includes('.') ? refPoint(ctx, c.from, raw1) : raw0;
        const p1 = typeof c.to === 'string' && !c.to.includes('.') ? refPoint(ctx, c.to, raw0) : raw1;
        const bend = c.bend ?? .2, mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2, dx = p1.x - p0.x, dy = p1.y - p0.y;
        const qx = mx - dy * bend, qy = my + dx * bend; const [a1, a2] = arrowD(p0.x.toFixed(1), p0.y.toFixed(1), qx.toFixed(1), qy.toFixed(1), +p1.x.toFixed(1), +p1.y.toFixed(1));
        const o = { col: col(c.color, OR), w: c.width || 6 }; const e = ink(ctx.o, a1, t, o); const end = ink(ctx.o, a2, e, o);
        if (c.id) ctx.refs[c.id] = { box: { x: Math.min(p0.x, p1.x), y: Math.min(p0.y, p1.y), w: Math.abs(dx), h: Math.abs(dy) }, anchors: { mid: [qx * .5 + mx * .5, qy * .5 + my * .5] } };
        return end
      },
      label(ctx, c, t) {
        const b = boxOf(c); let x, y; if (c.x != null) { x = c.x; y = c.y } else if (c.on) { const p = refPoint(ctx, c.on); x = p.x + (c.dx || 0); y = p.y + (c.dy || 0) } else { const bb = b || SLOTS.R2; x = bb.x + bb.w / 2; y = bb.y + bb.h / 2 }
        const size = c.size || (c.slot === 'R2' ? 44 : c.slot === 'R3' ? 46 : 46);
        const latin = isLatin(c.text);
        label(ctx.o, x, y, c.text, size, t, c.color || (c.slot === 'R2' || latin ? 'gray' : 'ink'), { font: c.font === 'sans' ? 'sans-serif' : undefined, anchor: c.anchor, attr: c.spacing ? { 'letter-spacing': c.spacing } : {} });
        const w = [...c.text].reduce((a, ch) => a + (/[\x00-\u024F]/.test(ch) ? .56 : 1.02), 0) * size; const lx = c.anchor === 'start' ? x : c.anchor === 'end' ? x - w : x - w / 2;
        const R = { box: { x: lx, y: y - size * .6, w, h: size * 1.2 } }; ctx.refs[c.id || c.text] = R; ctx.boxes.push({ ...R.box, what: 'label ' + c.text, line: c._line, on: !!c.on });
        return t
      },
      note(ctx, c, t) {
        const e = E('text', { x: 1560, y: 866, 'font-size': c.size || 30, fill: '#999', 'text-anchor': 'end', 'dominant-baseline': 'central', 'font-family': KAI, text: c.text }, ctx.o); fadeIn(e, t, 450);
        const w = [...c.text].length * (c.size || 30); ctx.boxes.push({ x: 1560 - w, y: 848, w, h: 36, what: 'note', line: c._line, note: 1 }); return t
      }
    };

    /* 回顾：中间本义，向外画出各个意思 */
    function recap(ctx, sc, t0) {
      const rc = sc.recap || S.recap || {}; const cx = 800, cy = 440; let t = t0;
      const centerTxt = rc.center || S.zi;
      t = ink(ctx.o, circ(cx, cy, 110, 85), t, { col: OR, w: 7, k: .8 }); label(ctx.o, cx, cy, centerTxt, centerTxt.length > 2 ? 52 : centerTxt.length > 1 ? 64 : 84, t - 200, 'ink');
      const nodes = (rc.nodes || []).map(n => { const s = S.scenes.find(x => x.sense === n || x.id === n); return s ? (s.recap || s.word || s.label || n) : n });
      const N = nodes.length;
      nodes.forEach((s, i) => {
        const d2 = rc.angles ? rc.angles[i] : 90 - i * 360 / N;   // 从正上方开始，顺时针均匀排开
        const r = d2 * Math.PI / 180, x = cx + Math.cos(r) * 520, y = cy - Math.sin(r) * 268, x0 = cx + Math.cos(r) * 125, y0 = cy - Math.sin(r) * 95, x1 = cx + Math.cos(r) * 400, y1 = cy - Math.sin(r) * 200;
        t = ink(ctx.o, `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`, t, { k: .7 }); label(ctx.o, x, y, s, 54, t - 100, i % 2 ? 'orange' : 'ink'); t += (rc.gap ?? 120);
        ctx.boxes.push({ x: x - s.length * 28, y: y - 32, w: s.length * 56, h: 64, what: 'recap ' + s })
      });
      return t
    }

    /* 构建全部场景 */
    const layers = TL.map((s, i) => { const L = E('g', { visibility: 'hidden' }); return { s, i, L, D: E('g', { filter: `url(#${fid})` }, L) } });
    P.boards = [];
    S.scenes.forEach((sc, si) => {
      if (!TL[si]) return; curScene = si;
      const ctx = { o: layers[si].D, refs: {}, boxes: [], si }; let pen = TL[si].start;
      const cues = [];
      (sc.lines || []).forEach((ln, li) => (ln.cues || []).forEach((c, ci) => cues.push({ c: { ...c, _line: li }, li, ci, t: resolveAt(si, li, c.at) })));
      if (sc.kind === 'recap') { const t0 = resolveAt(si, 0, sc.recapAt ?? 0) + 350; pen = recap(ctx, sc, t0) }
      cues.sort((a, b) => a.t - b.t || a.li - b.li || a.ci - b.ci);
      cues.forEach(({ c, li, ci, t }) => {
        const f = ACT[c.do]; if (!f) { warn('未知动作 ' + c.do); return }
        let st = t; if (PEN[c.do] && !c.parallel) st = Math.max(t, pen + 60);
        const end = f(ctx, c, st);
        if (PEN[c.do] && !c.parallel) pen = Math.max(pen, end);
        P.report.push({ scene: sc.id, line: li, cue: ci, do: c.do, at: c.at, want: Math.round(t), got: Math.round(st), late: Math.round(st - t), end: Math.round(end) });
      });
      const end = TL[si].start + TL[si].dur; if (pen > end - 200) warn(`场景 ${sc.id} 的画面 ${Math.round(pen)}ms 才画完，超过场景结束 ${end}ms`);
      P.boards.push({ id: sc.id, boxes: ctx.boxes, penEnd: Math.round(pen) });
    });

    /* 手 */
    const hand = E('image', { href: data.hand || '', width: 300, height: 302 }); const TIPX = 3.3, TIPY = 18;
    function ptAt(seg, f) { const p = seg.el.getPointAtLength(seg.L * f), m = seg.el.getCTM(); const q = svg.createSVGPoint(); q.x = p.x; q.y = p.y; return q.matrixTransform(m) }
    segs.sort((a, b) => a.start - b.start); segs.forEach(s => { s.p0 = ptAt(s, 0); s.p1 = ptAt(s, 1); s.end = s.start + s.dur });
    const OFF = { x: 1750, y: 1050 };
    function handAt(t) {
      let lo = 0, hi = segs.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (segs[m].start <= t) { k = m; lo = m + 1 } else hi = m - 1 }
      const cur = k >= 0 ? segs[k] : null, nx = segs[k + 1];
      if (cur && t < cur.end) { const p = ptAt(cur, cur.ease(clamp((t - cur.start) / cur.dur))); return { x: p.x, y: p.y, d: true } }
      const lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      if (cur && nx && nx.start - cur.end < 1500) { const f = eio(clamp((t - cur.end) / (nx.start - cur.end))), q = lerp(cur.p1, nx.p0, f), dd = Math.hypot(nx.p0.x - cur.p1.x, nx.p0.y - cur.p1.y); q.y -= Math.sin(Math.PI * f) * Math.min(70, 12 + dd * .25); q.x += Math.sin(Math.PI * f) * Math.min(25, dd * .08); return q }
      if (cur && t - cur.end < 450) return lerp(cur.p1, OFF, eio((t - cur.end) / 450));
      if (nx && nx.start - t < 450) return lerp(OFF, nx.p0, eio(1 - (nx.start - t) / 450));
      return OFF
    }

    /* 渲染（纯函数） */
    let curCue = null; P.chapter = 0; P.subs = opts.subtitles !== false;
    function sceneAt(t) { let si = 0; for (let i = 0; i < TL.length; i++)if (t >= TL[i].start) si = i; return si }
    function render(t) {
      t = Math.max(0, Math.min(t, TOTAL)); const si = sceneAt(t); P.chapter = si;
      layers.forEach(l => {
        const st = l.s.start, en = st + l.s.dur, last = l.i === layers.length - 1; let vis, x = 0;
        if (reduced) vis = l.i === si;
        else {
          vis = (t >= st || l.i === 0) && (t < en + 600 || last);
          if (l.i > 0 && t < st + 600) x = 1600 * (1 - eio(clamp((t - st) / 600))); if (!last && t >= en) x = -1600 * eio(clamp((t - en) / 600))
        }
        l.L.setAttribute('visibility', vis ? 'visible' : 'hidden'); l.L.setAttribute('transform', `translate(${x},0)`)
      });
      if (reduced) { const te = TL[si].start + TL[si].dur; for (const tr of tracks) if (tr.sc === si) tr.apply(clamp((te - tr.start) / tr.dur)); hand.setAttribute('visibility', 'hidden') }
      else {
        for (const tr of tracks) tr.apply(clamp((t - tr.start) / tr.dur));
        const h = handAt(t); const wob = h.d ? Math.sin(t / 45) * 1.5 : 0; hand.setAttribute('x', h.x - TIPX + wob); hand.setAttribute('y', h.y - TIPY + wob)
      }
      let cue = null, cs = 0; TL[si].cues.forEach(c => { if (t >= TL[si].start + c.t - 150 && t < TL[si].start + c.t + c.d + 500) { cue = c; cs = TL[si].start + c.t } });
      if (!P.subs) cue = null;
      if (cue !== curCue) { curCue = cue; sub.innerHTML = cue ? [...cue.text].map(ch => '<i>' + ch.replace(/[<&]/g, '') + '</i>').join('') : '' }
      if (cue) { const n = sub.children.length; let on; if (cue.ct) { on = 0; const rel = t - cs; for (let i = 0; i < n; i++)if (cue.ct[i] <= rel) on = i + 1 } else on = Math.floor(clamp((t - cs) / cue.d) * n + .5); for (let i = 0; i < n; i++)sub.children[i].className = i < on ? 'on' : '' }
      return si
    }
    P.render = render;
    P.segs = segs.map(s => [Math.round(s.start), Math.round(s.dur)]);
    P.slides = TL.slice(1).map(s => s.start);
    P.chapters = TL.map((s, i) => ({ start: s.start, label: (S.scenes[i] && S.scenes[i].label) || s.id }));
    P.layout = () => P.boards.map(b => ({ id: b.id, boxes: b.boxes }));

    /* 控件 */
    if (opts.capture) { render(opts.t || 0); return }
    const au = data.audioEl || new Audio(); if (data.audio) au.src = data.audio; au.preload = 'auto'; P.audio = au;
    const start = el('button', 'xzq-start', stage); start.type = 'button'; start.innerHTML = '<span>▶ 播放</span>'; start.setAttribute('aria-label', '播放');
    const ctrl = el('div', 'xzq-ctrl', root);
    const pp = el('button', 'xzq-pp', ctrl); pp.type = 'button'; pp.textContent = '▶'; pp.setAttribute('aria-label', '播放/暂停');
    const bar = el('div', 'xzq-bar', ctrl); el('div', 'xzq-tr', bar); const fl = el('div', 'xzq-fl', bar);
    const tm = el('div', 'xzq-tm', ctrl);
    const sp = el('div', 'xzq-speed', ctrl);[0.75, 1, 1.25].forEach(r => { const b = el('button', r === 1 ? 'on' : '', sp); b.type = 'button'; b.textContent = r + '×'; b.onclick = () => { au.playbackRate = r; [...sp.children].forEach(x => x.classList.toggle('on', x === b)) } });
    const cc = el('button', 'xzq-cc on', ctrl); cc.type = 'button'; cc.textContent = '字幕'; cc.onclick = () => { P.subs = !P.subs; cc.classList.toggle('on', P.subs); curCue = undefined };
    const marks = P.chapters.map((c, i) => { const m = el('div', 'xzq-mk', bar); m.textContent = c.label; m.style.left = (c.start / TOTAL * 100) + '%'; m.onclick = e => { e.stopPropagation(); seek(c.start) }; return m });
    const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') };
    function begin() { if (start.parentNode) start.remove(); return au.play().catch(() => { }) }
    function seek(ms) { au.currentTime = clamp(ms / TOTAL) * TOTAL / 1000; if (start.parentNode) begin() }
    P.play = begin; P.pause = () => au.pause(); P.seek = seek; P.setRate = r => au.playbackRate = r;
    start.onclick = begin;
    pp.onclick = () => { if (au.paused) { if (au.ended) au.currentTime = 0; begin() } else au.pause() };
    au.addEventListener('play', () => pp.textContent = '❚❚'); au.addEventListener('pause', () => pp.textContent = '▶');
    bar.onclick = e => { const r = bar.getBoundingClientRect(); seek(clamp((e.clientX - r.left) / r.width) * TOTAL) };
    root.tabIndex = 0; root.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); pp.onclick() } });
    let saved = false, alive = true; P.destroy = () => { alive = false; au.pause() };
    function loop() {
      if (!alive) return; const t = au.currentTime * 1000; render(t); fl.style.width = (t / TOTAL * 100) + '%'; tm.textContent = fmt(t) + ' / ' + fmt(TOTAL);
      marks.forEach((m, i) => m.classList.toggle('on', i === P.chapter));
      if (!saved && t >= TOTAL * .9) { saved = true; try { const k = 'xzq_anim', o = JSON.parse(localStorage.getItem(k) || '{}'); o[S.zi] = Date.now(); localStorage.setItem(k, JSON.stringify(o)) } catch (e) { } }
      requestAnimationFrame(loop)
    }
    render(0); requestAnimationFrame(loop);
  }

  /* ---------- 加载 ---------- */
  const HZ_CDN = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/';
  async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json() }
  function needs(script) {
    const art = new Set(), chars = new Set();
    script.scenes.forEach(s => (s.lines || []).forEach(l => (l.cues || []).forEach(c => { if (c.do === 'draw' && c.art) art.add(c.art); if (c.do === 'write' && c.chars) [...c.chars].forEach(ch => chars.add(ch)) })));
    return { art: [...art], chars: [...chars] }
  }
  async function load(zi, o = {}) {
    if (G.XZQ_ANIM_DATA && G.XZQ_ANIM_DATA[zi]) return G.XZQ_ANIM_DATA[zi];
    const base = o.base || 'anim/', e = encodeURIComponent;
    const [script, timeline] = await Promise.all([getJSON(base + e(zi) + '.json'), getJSON(base + e(zi) + '.timeline.json')]);
    const n = needs(script), art = {}, hz = {};
    await Promise.all([
      ...n.art.map(a => getJSON(base + 'art/' + e(a) + '.json').then(d => art[a] = d)),
      ...n.chars.map(c => getJSON(base + 'hz/' + e(c) + '.json').catch(() => getJSON(HZ_CDN + e(c) + '.json')).then(d => hz[c] = { strokes: d.strokes, medians: d.medians }))
    ]);
    return { script, timeline, art, hz, hand: base + 'hand.png', audio: o.audio === false ? null : base + e(zi) + '.mp3' }
  }
  async function mount(el, zi, o = {}) { const d = typeof zi === 'string' ? await load(zi, o) : zi; return new Player(el, d, o) }
  G.XZQAnim = { mount, load, needs, Player, SLOTS, version: 1 };
})(typeof window !== 'undefined' ? window : this);
