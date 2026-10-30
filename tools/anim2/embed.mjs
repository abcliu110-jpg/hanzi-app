/* 共享块嵌入模式：多个字放进一个 HTML，引擎 / 字体 / 图片只存一份。
 *   node tools/anim2/build.mjs --embed <out.html> 人 大 … [--no-audio]
 * 结构：
 *   <script type="text/plain" class="xzq-chunk" data-h="<hash>">  共享块：gzip+base64（引擎整段一份、字体、≥2 KB 的图片/音频按内容哈希去重）
 *   <script type="text/plain" class="xzq-zi" data-zi="人">         每字数据：JSON gzip+base64，里面的大块换成 "chunk:<hash>"
 * 运行时：点哪个字才解压哪个字（DecompressionStream），拼成单字页面放进 <iframe sandbox="allow-scripts" srcdoc>；
 * 解压过的块同页缓存。iframe 没有 allow-same-origin，所以页面里的数据全部内联，不依赖 blob: 或网络。
 */
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { engineJS, charData, fontSubset, BOOT } from './lib.mjs';

const MIN = 2048;
export async function embed(out, zis, { audio = !process.argv.includes('--no-audio') } = {}) {
  if (!out || !zis.length) throw new Error('用法：--embed <out.html> 字 …');
  const chunks = new Map();          // hash -> {b64gz, mime, size}
  const add = (buf, mime) => {
    const h = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    if (!chunks.has(h)) chunks.set(h, { b64: gzipSync(buf, { level: 9 }).toString('base64'), mime, size: buf.length });
    return h;
  };
  const engine = add(Buffer.from(await engineJS(), 'utf8'), 'text/javascript');
  // 字体：所有字合起来一份子集
  const tf = join(tmpdir(), `xzq2-embed-${process.pid}.txt`);
  const datas = {};
  for (const z of zis) datas[z] = await charData(z, { audio });
  writeFileSync(tf, zis.map(z => JSON.stringify(datas[z].script) + JSON.stringify(datas[z].timeline.map(s => s.cues.map(c => c.text)))).join(''));
  const font = add(fontSubset(['--text-file', tf], join(tmpdir(), `xzq2-embed-${process.pid}.woff2`)), 'font/woff2');
  const per = [];
  for (const z of zis) {
    const d = datas[z];
    // 大于 2 KB 的 data: URL 抽成共享块
    for (const k of ['hand', 'audio']) {
      const m = typeof d[k] === 'string' && d[k].match(/^data:([^;]+);base64,(.*)$/);
      if (m) { const buf = Buffer.from(m[2], 'base64'); if (buf.length >= MIN) d[k] = 'chunk:' + add(buf, m[1]) }
    }
    per.push(`<script type="text/plain" class="xzq-zi" data-zi="${z}">${gzipSync(Buffer.from(JSON.stringify(d)), { level: 9 }).toString('base64')}</script>`);
  }
  const chunkTags = [...chunks].map(([h, c]) => `<script type="text/plain" class="xzq-chunk" data-h="${h}" data-mime="${c.mime}">${c.b64}</script>`).join('\n');
  const boot = BOOT.replace(/__ZIJ__/g, '__ZI__');
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>字义动画（共享块）</title>
<style>body{margin:0;background:#ECE9E3;font-family:"PingFang SC","Microsoft YaHei",sans-serif;color:#0A0503}
.top{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:14px}
.top button{font-size:22px;border:0;border-radius:12px;padding:6px 14px;background:#FBFBFB;cursor:pointer}.top button.on{background:#EF7226;color:#fff}
#box{width:min(1160px,100%);margin:0 auto;aspect-ratio:16/10.2}#box iframe{width:100%;height:100%;border:0}</style></head>
<body><div class="top" id="top"></div><div id="box"></div>
${chunkTags}
${per.join('\n')}
<script>
(function(){
var ENGINE=${JSON.stringify(engine)},FONT=${JSON.stringify(font)},cache={};
function el(q){return document.querySelector(q)}
function gunzip(b64){var bin=atob(b64),u=new Uint8Array(bin.length);for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  if(typeof DecompressionStream==='undefined')return Promise.reject(new Error('浏览器不支持 DecompressionStream'));
  return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()}
function b64(buf){var u=new Uint8Array(buf),s='',n=0x8000;for(var i=0;i<u.length;i+=n)s+=String.fromCharCode.apply(null,u.subarray(i,i+n));return btoa(s)}
/* 共享块：解压一次，同页缓存（文本 or data: URL） */
function chunk(h,asText){var k=h+(asText?'t':'u');if(cache[k])return cache[k];var t=el('script.xzq-chunk[data-h="'+h+'"]');
  return cache[k]=gunzip(t.textContent).then(function(buf){return asText?new TextDecoder().decode(buf):'data:'+t.getAttribute('data-mime')+';base64,'+b64(buf)})}
function zi(z){var k='zi:'+z;if(cache[k])return cache[k];var t=el('script.xzq-zi[data-zi="'+z+'"]');
  return cache[k]=gunzip(t.textContent).then(function(buf){var d=JSON.parse(new TextDecoder().decode(buf));
    return Promise.all(['hand','audio'].map(function(f){if(typeof d[f]==='string'&&d[f].indexOf('chunk:')===0)return chunk(d[f].slice(6)).then(function(u){d[f]=u})})).then(function(){return d})})}
function esc(s){return s.replace(/<\\/(script)/gi,'<\\\\/$1')}
function show(z){
  [].forEach.call(document.querySelectorAll('#top button'),function(b){b.classList.toggle('on',b.textContent===z)});
  Promise.all([chunk(ENGINE,true),chunk(FONT),zi(z)]).then(function(r){
    var doc='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>@font-face{font-family:"XZQ WenKai";src:url('+r[1]+') format("woff2")}html,body{margin:0}body{padding:10px}</style></head><body><div id="player"></div>'
      +'<scr'+'ipt>'+esc(r[0])+'</scr'+'ipt><scr'+'ipt>window.XZQ_ANIM_DATA={};window.XZQ_ANIM_DATA['+JSON.stringify(z)+']='+esc(JSON.stringify(r[2]))+';</scr'+'ipt>'
      +'<scr'+'ipt>'+${JSON.stringify(boot)}.replace(/__ZI__/g,JSON.stringify(z))+'</scr'+'ipt></body></html>';
    var f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.setAttribute('allow','autoplay');f.title='字义动画「'+z+'」';f.srcdoc=doc;
    var box=el('#box');box.innerHTML='';box.appendChild(f);window.__frame=f;
  }).catch(function(e){console.error(e);el('#box').textContent='加载失败：'+e.message});
}
var zs=[].map.call(document.querySelectorAll('script.xzq-zi'),function(t){return t.getAttribute('data-zi')});
zs.forEach(function(z){var b=document.createElement('button');b.type='button';b.textContent=z;b.onclick=function(){show(z)};el('#top').appendChild(b)});
window.XZQ_EMBED={show:show,chars:zs};if(zs.length)show(zs[0]);
})();
</script></body></html>`;
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, html);
  const tot = [...chunks.values()].reduce((a, c) => a + c.b64.length, 0);
  console.log(out, Math.round(html.length / 1024), 'KB；共享块', chunks.size, '个', Math.round(tot / 1024), 'KB；字', zis.length, '个');
}
