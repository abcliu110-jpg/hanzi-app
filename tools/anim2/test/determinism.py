#!/usr/bin/env python3
"""引擎 v2 验收：确定性 + 控制台 + 沙箱 iframe + 抽帧总览。
用法：python3 tools/anim2/test/determinism.py 人 [大 …] [--html-dir DIR] [--t 1000,5000] [--v1]
  1. node build.mjs <字> 生成单文件 HTML（无音频，快）
  2. #cap 模式：每个场景画到一半 / 画完各取一帧；同一 t 截两次（中间先跳到别处），逐像素比较
  3. 正常播放模式放进 <iframe sandbox="allow-scripts">（无 allow-same-origin：localStorage 会抛错），检查无报错、能播放、__seek 可用
  4. 输出 .cache/anim2/<字>/snaps.jpg（--v1 时同一组 t 再用 v1 引擎截一份 v1.jpg 做对比）
退出码：有不一致或报错时为 1
"""
import argparse, asyncio, io, json, subprocess, sys
from pathlib import Path
from playwright.async_api import async_playwright

HERE = Path(__file__).resolve().parent
A2 = HERE.parent
ROOT = A2.parents[1]


def build(zi, out, audio=False):
    cmd = ['node', str(A2 / 'build.mjs'), zi, str(out)] + ([] if audio else ['--no-audio'])
    subprocess.check_call(cmd, stdout=subprocess.DEVNULL)


def sheet(files, out, label=''):
    from PIL import Image, ImageDraw
    ims = [Image.open(f) for f in files]
    W, H = 640, 360; cols = 3
    rows = (len(ims) + cols - 1) // cols
    S = Image.new('RGB', (cols * W, rows * H), 'white')
    d = ImageDraw.Draw(S)
    for i, (im, f) in enumerate(zip(ims, files)):
        x, y = i % cols * W, i // cols * H
        S.paste(im.convert('RGB').resize((W, H)), (x, y))
        d.text((x + 8, y + 6), f'{label} t={int(Path(f).stem.split("_")[-1])}ms', fill=(200, 0, 0))
    S.save(out, quality=85)


async def run(zi, a):
    d = ROOT / '.cache' / 'anim2' / zi; d.mkdir(parents=True, exist_ok=True)
    html = d / f'{zi}.html'
    build(zi, html)
    tl = json.loads((ROOT / 'anim' / f'{zi}.timeline.json').read_text())
    ts = [int(x) for x in a.t.split(',')] if a.t else []
    if not ts:
        for s in tl:
            ts += [s['start'] + s['dur'] // 2, s['start'] + s['dur'] - 300]
    probs = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width': 1280, 'height': 720})
        errs = []
        pg.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
        pg.on('console', lambda m: errs.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        await pg.goto(html.as_uri() + '#cap')
        await pg.wait_for_function('window.XZQ_READY||window.XZQ_ERROR', timeout=30000)
        if await pg.evaluate('window.XZQ_ERROR||null'):
            probs.append('加载失败 ' + await pg.evaluate('window.XZQ_ERROR'))
        info = await pg.evaluate('({w:XZQ.warnings,total:XZQ.total})')
        stage = await pg.query_selector('#player .xzq-stage')
        files, same = [], 0
        for t in ts:
            await pg.evaluate(f'XZQ.render({t})')
            s1 = await stage.screenshot(type='png')
            await pg.evaluate(f'XZQ.render({(t * 7919) % int(info["total"])});XZQ.render(0);XZQ.render({info["total"]});XZQ.render({t})')
            s2 = await stage.screenshot(type='png')
            if s1 != s2:
                from PIL import Image, ImageChops
                diff = ImageChops.difference(Image.open(io.BytesIO(s1)).convert('RGB'), Image.open(io.BytesIO(s2)).convert('RGB')).getbbox()
                probs.append(f't={t} 两次截图不一致 {diff}')
            else:
                same += 1
            fp = d / f'v2_{t:06d}.png'; fp.write_bytes(s1); files.append(fp)
        # 画布像素直接比较（不经过截图合成）
        eq = await pg.evaluate(f'''(()=>{{const c=document.querySelector('#player canvas');const g=c.getContext('2d');
          XZQ.render({ts[len(ts)//2]});const a=g.getImageData(0,0,c.width,c.height).data;
          XZQ.render({ts[-1]});XZQ.render({ts[0]});XZQ.render({ts[len(ts)//2]});const b=g.getImageData(0,0,c.width,c.height).data;
          let n=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])n++;return [n,c.width,c.height]}})()''')
        if eq[0]:
            probs.append(f'getImageData 不一致像素 {eq[0]}')
        sheet(files, d / 'snaps.jpg', 'v2')
        # 沙箱 iframe：正常播放模式
        host = d / 'iframe-host.html'
        host.write_text(f'<!doctype html><meta charset=utf-8><body style="margin:0"><iframe id=f sandbox="allow-scripts" src="{html.name}" style="width:1200px;height:800px;border:0"></iframe>')
        pg2 = await b.new_page(viewport={'width': 1280, 'height': 860})
        errs2 = []
        pg2.on('pageerror', lambda e: errs2.append('pageerror: ' + str(e)))
        pg2.on('console', lambda m: errs2.append(f'console.{m.type}: {m.text}') if m.type == 'error' else None)
        await pg2.goto(host.as_uri())
        fr = None
        for _ in range(100):
            fr = next((f for f in pg2.frames if f != pg2.main_frame and f.url.startswith('file:')), None)
            if fr:
                break
            await asyncio.sleep(0.1)
        await fr.wait_for_function('window.XZQ_READY||window.XZQ_ERROR', timeout=30000)
        ifr = await fr.evaluate('''async()=>{const p=window.XZQ;const r={err:window.XZQ_ERROR||null};
          document.querySelector('.xzq2-start').click(); await new Promise(z=>setTimeout(z,700)); r.t1=p.time();
          document.querySelector('.xzq2-mute').click(); r.muteLabel=document.querySelector('.xzq2-mute').textContent;
          document.querySelector('canvas').click(); const a=p.time(); await new Promise(z=>setTimeout(z,300)); r.pausedStill=Math.abs(p.time()-a)<1;
          r.seek=window.__seek(5); r.sub=document.querySelector('.xzq2-sub').textContent; return r}''')
        if ifr.get('err') or not ifr['t1'] > 100 or not ifr['pausedStill'] or abs(ifr['seek'] - 5) > 0.01:
            probs.append('iframe 播放检查失败 ' + json.dumps(ifr, ensure_ascii=False))
        await pg2.screenshot(path=str(d / 'iframe.png'))
        # 可选：v1 对比
        if a.v1:
            sys.path.insert(0, str(ROOT / 'tools' / 'anim'))
            from common import build_page
            v1 = build_page(zi, d / 'v1.html', audio=False)
            pg3 = await b.new_page(viewport={'width': 1280, 'height': 720})
            await pg3.goto(Path(v1).resolve().as_uri() + '#cap')
            await pg3.wait_for_function('window.XZQ_READY||window.XZQ_ERROR', timeout=30000)
            el = await pg3.query_selector('#player .xzq-stage'); f1 = []
            for t in ts:
                await pg3.evaluate(f'XZQ.render({t})'); fp = d / f'v1_{t:06d}.png'
                await el.screenshot(path=str(fp)); f1.append(fp)
            sheet(f1, d / 'v1.jpg', 'v1')
        await b.close()
    probs += errs + ['iframe ' + e for e in errs2]
    print(f'「{zi}」 {len(ts)} 帧，逐像素一致 {same}/{len(ts)}，画布 {eq[1]}×{eq[2]}，警告 {len(info["w"])} 条，iframe {json.dumps(ifr, ensure_ascii=False)}')
    for w in info['w']:
        print('  警告', w)
    for q in probs:
        print('  ✗', q)
    print('  总览', d / 'snaps.jpg')
    return not probs


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('zi', nargs='+')
    ap.add_argument('--t', default='')
    ap.add_argument('--v1', action='store_true')
    a = ap.parse_args()
    ok = True
    for z in a.zi:
        ok = await run(z, a) and ok
    sys.exit(0 if ok else 1)


asyncio.run(main())
