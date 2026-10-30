#!/usr/bin/env node
/* 引擎 v2 打包（esbuild）
 *   node tools/anim2/build.mjs <字> <out.html> [--no-audio]   单文件 HTML：引擎 + 文楷子集 + 该字数据 + mp3(base64)
 *   node tools/anim2/build.mjs --dist                         dist/anim2/xzq-anim2.js + xzq-anim2-font.woff2（App 里用）
 *   node tools/anim2/build.mjs --many <dir> 字 字 …              批量（无音频、无字体，给回归测试用）
 *   node tools/anim2/build.mjs --embed <out.html> 字 字 …     共享块模式（多个字一页，见 embed.mjs）
 * 单字 HTML 的页面协议与 v1 的 preview 相同：#cap 导出模式、window.XZQ、window.XZQ_READY，tools/anim/snap.py 的做法可以照用。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { HERE, ROOT, engineJS, charData, fontSubset, BOOT, page, esc } from './lib.mjs';
export { engineJS, charData, fontSubset, BOOT, page };

let jsCache = null;
async function single(zi, out, audio, withFont = true) {
  const [js, d] = await Promise.all([jsCache || (jsCache = engineJS()), charData(zi, { audio })]);
  const font = withFont ? fontSubset(['--zi', zi], join(tmpdir(), `xzq2-font-${process.pid}.woff2`)) : Buffer.alloc(0);
  const html = page({
    title: `字义动画 ·「${zi}」`, fontB64: font.length ? font.toString('base64') : '',
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
    else if (a[0] === '--many') { const dir = a[1]; mkdirSync(dir, { recursive: true }); for (const z of a.slice(2)) { try { await single(z, join(dir, z + '.html'), false, false) } catch (e) { console.error(z, e.message) } } }
    else if (a.length >= 2) await single(a[0], a[1], !a.includes('--no-audio'), !a.includes('--no-font'));
    else { console.error('用法：node tools/anim2/build.mjs <字> <out.html> [--no-audio] | --dist | --embed <out.html> 字…'); process.exit(2) }
  } catch (e) { console.error(e.message || e); process.exit(1) }
}
