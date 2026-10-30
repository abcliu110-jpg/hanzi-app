/*!
 * xzq-anim2 — 识字星球 字义白板动画引擎 v2（Canvas 2D + rough.js）
 * 数据与 v1 相同：anim/<字>.json + .timeline.json + .mp3；线稿 anim/art/；笔画 anim/hz/（hanzi-writer-data，Arphic PL）
 * API 与 v1 相同：XZQAnim.mount(el, '字', {base, capture, reducedMotion, subtitles})
 * 依赖：rough.js (MIT)，GSAP (Standard License)，path-data-parser (MIT)
 */
import { Player } from './player.js';
import { buildModel, SLOTS, PAL } from './model.js';

const G = typeof window !== 'undefined' ? window : globalThis;
const HZ_CDN = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/';
/* 引擎所在目录（用来找默认字体 xzq-anim2-font.woff2） */
let SELF = '';
try { const cs = document.currentScript; if (cs && cs.src) SELF = cs.src.replace(/[^/]*$/, '') } catch (e) { }

async function getJSON(u) { const r = await fetch(u); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json() }
export function needs(script) {
  const art = new Set(), chars = new Set();
  script.scenes.forEach(s => (s.lines || []).forEach(l => (l.cues || []).forEach(c => {
    if (c.do === 'draw' && c.art) art.add(c.art);
    if (c.do === 'write' && c.chars) [...c.chars].forEach(ch => chars.add(ch));
  })));
  return { art: [...art], chars: [...chars] };
}
export async function load(zi, o = {}) {
  if (G.XZQ_ANIM_DATA && G.XZQ_ANIM_DATA[zi]) return G.XZQ_ANIM_DATA[zi];
  if (G.XZQ_ANIM2_GET) { const d = await G.XZQ_ANIM2_GET(zi); if (d) return d }   // 共享块模式按需解压
  const base = o.base || 'anim/', e = encodeURIComponent;
  const [script, timeline] = await Promise.all([getJSON(base + e(zi) + '.json'), getJSON(base + e(zi) + '.timeline.json')]);
  const n = needs(script), art = {}, hz = {};
  await Promise.all([
    ...n.art.map(a => getJSON(base + 'art/' + e(a) + '.json').then(d => art[a] = d)),
    ...n.chars.map(c => getJSON(base + 'hz/' + e(c) + '.json').catch(() => getJSON(HZ_CDN + e(c) + '.json')).then(d => hz[c] = { strokes: d.strokes, medians: d.medians }))
  ]);
  return { script, timeline, art, hz, hand: base + 'hand.png', audio: o.audio === false ? null : base + e(zi) + '.mp3' };
}

/* 字体：单文件 HTML 里已用 @font-face 内嵌 "XZQ WenKai"；否则从 opts.font 或引擎旁边的 xzq-anim2-font.woff2 加载 */
const fontOnce = {};
async function loadFont(o) {
  try {
    if (!G.document || !document.fonts) return;
    let has = false; document.fonts.forEach(f => { if (f.family.replace(/"/g, '') === 'XZQ WenKai') has = true });
    const url = o.font === undefined ? (SELF ? SELF + 'xzq-anim2-font.woff2' : null) : o.font;
    if (!has && url && typeof FontFace !== 'undefined') {
      if (!fontOnce[url]) fontOnce[url] = new FontFace('XZQ WenKai', `url(${url})`).load().then(f => { document.fonts.add(f) }).catch(() => { });
      await fontOnce[url];
    }
    await Promise.race([document.fonts.load('48px "XZQ WenKai"', '字'), new Promise(r => setTimeout(r, 2500))]);
    await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]);
  } catch (e) { }
}
function loadImg(src) {
  return new Promise(res => {
    if (!src || typeof Image === 'undefined') return res(null);
    const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src;
  });
}
export async function mount(el, zi, o = {}) {
  const d = typeof zi === 'string' ? await load(zi, o) : zi;
  const [img] = await Promise.all([d.handImg ? d.handImg : loadImg(d.hand), loadFont(o)]);
  return new Player(el, { ...d, handImg: img }, o);
}
export { Player, buildModel, SLOTS, PAL };
export const version = 2;
