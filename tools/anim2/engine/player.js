/* 播放器外壳：Canvas、字幕、控件、时钟。画面全部来自 model.drawFrame(ctx, t)。 */
import { buildModel, LW, LH, PAL } from './model.js';
import { clamp } from './geom.js';
import CSS from './player.css';

const LS_MUTE = 'xzq_anim_mute', LS_SEEN = 'xzq_anim';
const lsGet = k => { try { return G().localStorage.getItem(k) } catch (e) { return null } };
const lsSet = (k, v) => { try { G().localStorage.setItem(k, v) } catch (e) { } };
const G = () => (typeof window !== 'undefined' ? window : globalThis);
let cssDone = false;
function injectCSS() {
  if (cssDone || typeof document === 'undefined') return; cssDone = true;
  try { const s = document.createElement('style'); s.setAttribute('data-xzq-anim2', ''); s.textContent = CSS; document.head.appendChild(s) } catch (e) { }
}
function el(tag, cls, p) { const e = document.createElement(tag); if (cls) e.className = cls; if (p) p.appendChild(e); return e }
const fmt = ms => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') };

export function Player(root, data, opts) {
  opts = opts || {}; injectCSS();
  let reduced = opts.reducedMotion;
  if (reduced == null) { try { reduced = !!(G().matchMedia && G().matchMedia('(prefers-reduced-motion: reduce)').matches) } catch (e) { reduced = false } }
  const M = buildModel(data, { reducedMotion: reduced });
  const P = this, S = data.script, TOTAL = M.total;
  Object.assign(P, { total: TOTAL, warnings: M.warnings, report: M.report, boards: M.boards, chapters: M.chapters, slides: M.slides, reduced: !!reduced, version: 2, model: M });
  P.segs = M.segs.map(s => [Math.round(s.start), Math.round(s.dur)]);
  P.layout = () => M.boards.map(b => ({ id: b.id, boxes: b.boxes }));
  P.subs = opts.subtitles !== false; P.chapter = 0;

  root.classList.add('xzq-anim', 'xzq-anim2'); root.innerHTML = '';
  if (opts.capture) root.classList.add('xzq-cap');
  const stage = el('div', 'xzq-stage xzq2-stage', root);
  const cv = el('canvas', 'xzq2-cv', stage); cv.width = LW; cv.height = LH;
  cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', '「' + S.zi + '」字义动画');
  const ctx = cv.getContext('2d');
  const sub = el('div', 'xzq-sub xzq2-sub', stage); sub.setAttribute('aria-live', 'off');
  const hand = data.handImg || null;

  /* 画布尺寸：导出模式固定 1920×1080；否则按显示宽度 × devicePixelRatio */
  function fit() {
    if (opts.capture) return;
    let w = LW; try { const r = stage.getBoundingClientRect(); const dpr = G().devicePixelRatio || 1; if (r.width) w = Math.round(Math.min(LW * 2, Math.max(480, r.width * dpr))) } catch (e) { }
    const h = Math.round(w * LH / LW); if (cv.width !== w) { cv.width = w; cv.height = h; dirty = true }
  }

  /* 字幕：已读的字变深，重点词读到时变橙 */
  let curCue = null;
  function subAt(t, si) {
    let cue = null;
    if (P.subs) for (const c of M.subs[si]) if (t >= c.start - 150 && t < c.start + c.d + 500) cue = c;
    if (cue !== curCue) {
      curCue = cue; sub.textContent = '';
      if (cue) [...cue.text].forEach((ch, i) => { const s = el('i', cue.kw[i] ? 'kw' : '', sub); s.textContent = ch });
    }
    if (!cue) return;
    const n = sub.children.length, rel = t - cue.start; let on;
    if (cue.ct) { on = 0; for (let i = 0; i < n; i++) if (cue.ct[i] <= rel) on = i + 1 } else on = Math.floor(clamp(rel / cue.d) * n + 0.5);
    for (let i = 0; i < n; i++) sub.children[i].classList.toggle('on', i < on);
  }
  let last = -1, dirty = true;
  function render(t) {
    t = Math.max(0, Math.min(+t || 0, TOTAL));
    ctx.setTransform(cv.width / LW, 0, 0, cv.height / LH, 0, 0);
    const si = M.drawFrame(ctx, t, hand); P.chapter = si; subAt(t, si); last = t; dirty = false;
    return si;
  }
  P.render = render;
  P.drawFrame = (c, t) => M.drawFrame(c, t, hand);
  if (opts.capture) { render(opts.t || 0); G().__seek = s => render(s * 1000); return }

  /* ---------- 时钟：播放中以音频为准；没有音频 / 音频被拦时用 performance.now ---------- */
  const au = data.audioEl || (typeof Audio !== 'undefined' ? new Audio() : null);
  let useAudio = false;
  if (au) { try { if (data.audio) au.src = data.audio; au.preload = 'auto'; useAudio = !!(au.src || au.currentSrc) } catch (e) { useAudio = false } }
  P.audio = au;
  let playing = false, tBase = 0, pBase = 0, rate = 1;
  const pnow = () => (G().performance ? performance.now() : Date.now());
  function now() {
    if (!playing) return tBase;
    if (useAudio && !au.paused && au.readyState >= 2 && !au.seeking) return au.currentTime * 1000;
    return tBase + (pnow() - pBase) * rate;
  }
  let muted = lsGet(LS_MUTE) === '1';
  if (au) try { au.muted = muted } catch (e) { }

  const start = el('button', 'xzq-start xzq2-start', stage); start.type = 'button'; start.innerHTML = '<span>▶ 播放</span>'; start.setAttribute('aria-label', '播放');
  const ctrl = el('div', 'xzq-ctrl xzq2-ctrl', root);
  const pp = el('button', 'xzq-pp', ctrl); pp.type = 'button'; pp.textContent = '▶'; pp.setAttribute('aria-label', '播放/暂停');
  const bar = el('div', 'xzq-bar xzq2-bar', ctrl); el('div', 'xzq-tr', bar); const fl = el('div', 'xzq-fl', bar); const knob = el('div', 'xzq2-knob', bar);
  bar.setAttribute('role', 'slider'); bar.setAttribute('aria-label', '进度'); bar.tabIndex = 0;
  const tm = el('div', 'xzq-tm', ctrl);
  const sp = el('div', 'xzq-speed', ctrl);
  [0.75, 1, 1.25].forEach(r => { const b = el('button', r === 1 ? 'on' : '', sp); b.type = 'button'; b.textContent = r + '×'; b.onclick = () => { setRate(r); [...sp.children].forEach(x => x.classList.toggle('on', x === b)) } });
  const cc = el('button', 'xzq-cc' + (P.subs ? ' on' : ''), ctrl); cc.type = 'button'; cc.textContent = '字幕';
  cc.onclick = () => { P.subs = !P.subs; cc.classList.toggle('on', P.subs); curCue = undefined; dirty = true };
  const mu = el('button', 'xzq2-mute', ctrl); mu.type = 'button';
  const showMute = () => { mu.textContent = muted ? '🔇' : '🔊'; mu.setAttribute('aria-label', muted ? '打开声音' : '静音') }; showMute();
  mu.onclick = () => { muted = !muted; if (au) try { au.muted = muted } catch (e) { } lsSet(LS_MUTE, muted ? '1' : '0'); showMute() };
  const marks = M.chapters.map(c => { const m = el('div', 'xzq-mk', bar); m.textContent = c.label; m.style.left = (c.start / TOTAL * 100) + '%'; m.onpointerdown = e => e.stopPropagation(); m.onclick = e => { e.stopPropagation(); seek(c.start) }; return m });

  function syncAudio(t) { if (useAudio) try { au.currentTime = t / 1000 } catch (e) { } }
  function play() {
    if (start.parentNode) start.remove();
    if (tBase >= TOTAL - 50) tBase = 0;
    playing = true; pBase = pnow(); pp.textContent = '❚❚';
    if (useAudio) { syncAudio(tBase); try { au.playbackRate = rate; const pr = au.play(); if (pr && pr.catch) pr.catch(() => { useAudio = false }) } catch (e) { useAudio = false } }
    return Promise.resolve();
  }
  function pause() { if (!playing) return; tBase = now(); playing = false; pp.textContent = '▶'; if (au) try { au.pause() } catch (e) { } dirty = true }
  function seek(ms) { tBase = Math.max(0, Math.min(ms, TOTAL)); pBase = pnow(); syncAudio(tBase); dirty = true; render(tBase) }
  function setRate(r) { tBase = now(); pBase = pnow(); rate = r; if (au) try { au.playbackRate = r } catch (e) { } }
  const toggle = () => (playing ? pause() : play());
  Object.assign(P, { play, pause, seek, setRate, toggle, time: now });
  start.onclick = e => { e.stopPropagation(); play() };
  pp.onclick = toggle;
  cv.addEventListener('click', toggle);
  if (au) { au.addEventListener('ended', () => { if (playing) { tBase = TOTAL; playing = false; pp.textContent = '▶' } }); au.addEventListener('error', () => { useAudio = false }) }

  /* 进度条：按下拖动 */
  let drag = false, wasPlaying = false;
  const posT = e => { const r = bar.getBoundingClientRect(); return clamp((e.clientX - r.left) / (r.width || 1)) * TOTAL };
  bar.addEventListener('pointerdown', e => { drag = true; wasPlaying = playing; pause(); try { bar.setPointerCapture(e.pointerId) } catch (x) { } seek(posT(e)) });
  bar.addEventListener('pointermove', e => { if (drag) seek(posT(e)) });
  const up = e => { if (!drag) return; drag = false; seek(posT(e)); if (wasPlaying) play() };
  bar.addEventListener('pointerup', up); bar.addEventListener('pointercancel', () => { drag = false });
  bar.addEventListener('keydown', e => { if (e.key === 'ArrowRight') seek(now() + 5000); else if (e.key === 'ArrowLeft') seek(now() - 5000); else return; e.preventDefault() });
  root.tabIndex = 0;
  root.addEventListener('keydown', e => { if (e.code === 'Space' && e.target === root) { e.preventDefault(); toggle() } });
  const onVis = () => { try { if (document.hidden) pause() } catch (e) { } };
  try { document.addEventListener('visibilitychange', onVis) } catch (e) { }
  G().__seek = s => { pause(); seek(s * 1000); return now() / 1000 };

  let ro = null; try { ro = new ResizeObserver(() => { fit(); render(now()) }); ro.observe(stage) } catch (e) { }
  let saved = false, alive = true, raf = 0;
  P.destroy = () => { alive = false; pause(); try { cancelAnimationFrame(raf); ro && ro.disconnect(); document.removeEventListener('visibilitychange', onVis) } catch (e) { } };
  function loop() {
    if (!alive) return;
    let t = now();
    if (playing && t >= TOTAL) { t = TOTAL; tBase = TOTAL; playing = false; pp.textContent = '▶'; if (au) try { au.pause() } catch (e) { } }
    if (t !== last || dirty) render(t);
    const f = (t / TOTAL * 100) + '%'; fl.style.width = f; knob.style.left = f; tm.textContent = fmt(t) + ' / ' + fmt(TOTAL);
    bar.setAttribute('aria-valuenow', Math.round(t / 1000));
    marks.forEach((m, i) => m.classList.toggle('on', i === P.chapter));
    if (!saved && t >= TOTAL * 0.9) { saved = true; try { const o = JSON.parse(lsGet(LS_SEEN) || '{}'); o[S.zi] = Date.now(); lsSet(LS_SEEN, JSON.stringify(o)) } catch (e) { } }
    raf = requestAnimationFrame(loop);
  }
  fit(); render(0); raf = requestAnimationFrame(loop);
}
