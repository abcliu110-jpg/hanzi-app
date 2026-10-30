/* build.mjs / embed.mjs 共用：esbuild 打包引擎、读一个字的数据、文楷子集、页面模板 */
import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../..');
export const ANIM = process.env.XZQ_ANIM_DIR || join(ROOT, 'anim');
const HZ_CDN = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0/';

export async function engineJS({ minify = true } = {}) {
  const r = await build({
    entryPoints: [join(HERE, 'engine/global.js')], bundle: true, format: 'iife', minify, write: false,
    target: 'es2020', loader: { '.css': 'text' }, legalComments: 'none',
    banner: { js: '/*! xzq-anim2 v2 — 识字星球白板动画引擎（Canvas + rough.js）。rough.js MIT · GSAP Standard License · path-data-parser MIT */' }
  });
  return r.outputFiles[0].text;
}
function needs(script) {
  const art = [], chars = [];
  for (const s of script.scenes) for (const l of s.lines || []) for (const c of l.cues || []) {
    if (c.do === 'draw' && c.art && !art.includes(c.art)) art.push(c.art);
    if (c.do === 'write' && c.chars) for (const ch of c.chars) if (!chars.includes(ch)) chars.push(ch);
  }
  return { art, chars };
}
async function hz(ch) {
  const p = join(ANIM, 'hz', ch + '.json');
  if (existsSync(p)) { const d = JSON.parse(readFileSync(p, 'utf8')); return { strokes: d.strokes, medians: d.medians } }
  const r = await fetch(HZ_CDN + encodeURIComponent(ch) + '.json'); if (!r.ok) throw new Error('缺少笔画数据 ' + ch);
  const d = await r.json(); return { strokes: d.strokes, medians: d.medians };
}
export async function charData(zi, { audio = true } = {}) {
  const script = JSON.parse(readFileSync(join(ANIM, zi + '.json'), 'utf8'));
  const timeline = JSON.parse(readFileSync(join(ANIM, zi + '.timeline.json'), 'utf8'));
  const n = needs(script), art = {}, H = {};
  for (const a of n.art) { const p = join(ANIM, 'art', a + '.json'); if (!existsSync(p)) throw new Error('缺少线稿 anim/art/' + a + '.json'); art[a] = JSON.parse(readFileSync(p, 'utf8')) }
  for (const c of n.chars) H[c] = await hz(c);
  const d = { script, timeline, art, hz: H, hand: 'data:image/png;base64,' + readFileSync(join(ANIM, 'hand.png')).toString('base64') };
  const mp3 = join(ANIM, zi + '.mp3');
  if (audio && existsSync(mp3)) d.audio = 'data:audio/mpeg;base64,' + readFileSync(mp3).toString('base64');
  return d;
}
export function fontSubset(args, out) {
  execFileSync('python3', [join(HERE, 'fonts.py'), ...args, '-o', out], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  return readFileSync(out);
}
export const esc = s => s.replace(/<\/(script)/gi, '<\\/$1');
export const BOOT = `(function(){var cap=location.hash.indexOf('cap')>=0,rm=location.hash.indexOf('reduced')>=0?true:undefined;
if(cap)document.body.classList.add('cap');
XZQAnim2.mount(document.getElementById('player'),__ZIJ__,{capture:cap,font:null,reducedMotion:cap&&rm===undefined?false:rm}).then(function(p){window.XZQ=p;window.render=p.render;window.XZQ_READY=true})
.catch(function(e){console.error(e);window.XZQ_ERROR=String(e)});})();`;
export function page({ title, fontB64, body, head = '' }) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${fontB64 ? `@font-face{font-family:"XZQ WenKai";src:url(data:font/woff2;base64,${fontB64}) format("woff2");font-display:block}` : ''}
html,body{margin:0}body{background:#ECE9E3;display:flex;justify-content:center;padding:20px;box-sizing:border-box}.wrap{width:min(1120px,100%)}
body.cap{padding:0;background:#000}body.cap .wrap{width:100%}</style>${head}</head>
<body>${body}</body></html>`;
}

