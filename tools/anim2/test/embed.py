#!/usr/bin/env python3
"""共享块模式验收：node build.mjs --embed 打包几个字 → 逐个切换，iframe(sandbox=allow-scripts) 里能加载、播放、跳转、字体就绪、无报错。
用法：python3 tools/anim2/test/embed.py 人 大
"""
import asyncio, subprocess, sys
from pathlib import Path
from playwright.async_api import async_playwright
A2 = Path(__file__).resolve().parents[1]; ROOT = A2.parents[1]


async def main(zs):
    out = ROOT / '.cache' / 'anim2' / 'embed.html'
    subprocess.check_call(['node', str(A2 / 'build.mjs'), '--embed', str(out), *zs])
    ok = True
    async with async_playwright() as p:
        b = await p.chromium.launch(); pg = await b.new_page(viewport={'width': 1280, 'height': 900})
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
        await pg.goto(out.as_uri())
        for z in zs:
            await pg.evaluate(f"XZQ_EMBED.show({z!r})")
            fr = None
            for _ in range(100):
                await asyncio.sleep(0.1)
                fs = [f for f in pg.frames if f != pg.main_frame]
                if fs:
                    try:
                        if await fs[-1].evaluate('!!(window.XZQ_READY||window.XZQ_ERROR)') and await fs[-1].evaluate(f'XZQ_ANIM_DATA[{z!r}]!=null'):
                            fr = fs[-1]; break
                    except Exception:
                        pass
            if not fr:
                print('✗', z, '没加载出来'); ok = False; continue
            r = await fr.evaluate('''async()=>{document.querySelector('.xzq2-start').click();await new Promise(z=>setTimeout(z,800));
              return {err:window.XZQ_ERROR||null,t:Math.round(XZQ.time()),font:document.fonts.check('40px "XZQ WenKai"','字'),seek:__seek(20)}}''')
            good = not r['err'] and r['t'] > 100 and r['seek'] == 20
            ok = ok and good
            print('✓' if good else '✗', z, r)
        await b.close()
    for e in errs:
        print('✗', e)
    return ok and not errs

sys.exit(0 if asyncio.run(main(sys.argv[1:] or ['人', '大'])) else 1)
