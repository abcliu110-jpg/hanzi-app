#!/usr/bin/env node
/* 引擎 v2 打包（esbuild）
 *   node tools/anim2/build.mjs <字> <out.html> [--no-audio]   单文件 HTML：引擎 + 文楷子集 + 该字数据 + mp3(base64)
 *   node tools/anim2/build.mjs --dist                         dist/anim2/xzq-anim2.js + xzq-anim2-font.woff2（App 里用）
 *   node tools/anim2/build.mjs --embed <out.html> 字 字 …     共享块模式（多个字一页，见 embed.mjs）
 * 单字 HTML 的页面协议与 v1 的 preview 相同：#cap 导出模式、window.XZQ、window.XZQ_READY，tools/anim/snap.py 的做法可以照用。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const ANIM = process.env.XZQ_ANIM_DIR || join(ROOT, 'anim');
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
const esc = s => s.replace(/<\/(script)/gi, '<\\/$1');
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

async function single(zi, out, audio) {
  const [js, d] = await Promise.all([engineJS(), charData(zi, { audio })]);
  const font = fontSubset(['--zi', zi], join(tmpdir(), `xzq2-font-${process.pid}.woff2`));
  const html = page({
    title: `字义动画 ·「${zi}」`, fontB64: font.toString('base64'),
    body: `<div class="wrap"><div id="player"></div></div>
<script>${esc(js)}</script>
<script>window.XZQ_ANIM_DATA={};window.XZQ_ANIM_DATA[${JSON.stringify(zi)}]=${esc(JSON.stringify(d))};</script>
<script>${BOOT.replace(/__ZIJ__/g, JSON.stringify(zi))}</script>`
  });
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, html);
  console.log(out, Math.round(html.length / 1024), 'KB（字体', Math.round(font.length / 1024), 'KB）');
}
async function dist() {
  const D = join(ROOT, 'dist', 'anim2'); mkdirSync(D, { recursive: true });
  writeFileSync(join(D, 'xzq-anim2.js'), await engineJS());
  fontSubset(['--all'], join(D, 'xzq-anim2-font.woff2'));
  const ofl = join(HERE, 'OFL-LXGW-WenKai.txt'); if (existsSync(ofl)) copyFileSync(ofl, join(D, 'OFL-LXGW-WenKai.txt'));
  for (const f of ['xzq-anim2.js', 'xzq-anim2-font.woff2']) console.log('dist/anim2/' + f, Math.round(readFileSync(join(D, f)).length / 1024), 'KB');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  try {
    if (a[0] === '--dist') await dist();
    else if (a[0] === '--embed') { const { embed } = await import('./embed.mjs'); await embed(a[1], a.slice(2).filter(x => !x.startsWith('--'))) }
    else if (a.length >= 2) await single(a[0], a[1], !a.includes('--no-audio'));
    else { console.error('用法：node tools/anim2/build.mjs <字> <out.html> [--no-audio] | --dist | --embed <out.html> 字…'); process.exit(2) }
  } catch (e) { console.error(e.message || e); process.exit(1) }
}
